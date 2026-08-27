import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessVideo } from "@/lib/assignments";
import { getAppOnlyToken, getStreamUrl, getUserGraphToken } from "@/lib/graph";

// Download a video's handout. Same access boundary as streaming the video
// itself: the learner must have the video (or its module) assigned, so a
// guessed material id can't leak a file they were never allotted.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const material = await prisma.material.findUnique({ where: { id } });
  if (
    !material ||
    !(await canAccessVideo(userId, material.videoId, session.user.role === "ADMIN"))
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let token = await getUserGraphToken(userId);
  if (!token) token = await getAppOnlyToken();
  if (!token) return NextResponse.json({ error: "No Graph token" }, { status: 500 });

  try {
    // getStreamUrl returns a short-lived pre-authenticated Graph URL for any
    // drive item — redirect the browser straight at it.
    const url = await getStreamUrl(material.graphDriveId, material.graphItemId, token);
    if (!url) return NextResponse.json({ error: "No download URL" }, { status: 502 });
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
