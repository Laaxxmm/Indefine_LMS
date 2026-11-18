import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessVideo } from "@/lib/assignments";
import { getAppOnlyToken, getStreamUrl, getUserGraphToken } from "@/lib/graph";
import { isActive, isAdmin } from "@/lib/access";
import { failureSentence } from "@/lib/errors";

// Download a video's handout. Same access boundary as streaming the video
// itself: the learner must have the video (or its module) assigned, so a
// guessed material id can't leak a file they were never allotted.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !isActive(session.user)) return NextResponse.json({ error: "Sign in with an active account to continue. If you are signed in, ask an admin to check your account." }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const material = await prisma.material.findUnique({ where: { id } });
  if (
    !material ||
    !(await canAccessVideo(userId, material.videoId, isAdmin(session.user)))
  ) {
    return NextResponse.json({ error: "That material wasn't found. Go back to the video and try again." }, { status: 404 });
  }

  let token = await getAppOnlyToken();
  if (!token) token = await getUserGraphToken(userId);
  if (!token) return NextResponse.json({ error: "The connection to OneDrive is not set up on the server, so the file can't be opened. Tell IT." }, { status: 500 });

  try {
    // getStreamUrl returns a short-lived pre-authenticated Graph URL for any
    // drive item — redirect the browser straight at it.
    const url = await getStreamUrl(material.graphDriveId, material.graphItemId, token);
    if (!url) return NextResponse.json({ error: "OneDrive did not return the file. Try again in a minute." }, { status: 502 });
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json({ error: failureSentence(e, "The file could not be loaded from OneDrive.", "Try again in a minute.") }, { status: 502 });
  }
}
