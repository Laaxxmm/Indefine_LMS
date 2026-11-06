import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessVideo } from "@/lib/assignments";
import { getAppOnlyToken, getStreamUrl, getUserGraphToken } from "@/lib/graph";
import { isActive, isAdmin } from "@/lib/access";
import { failureSentence } from "@/lib/errors";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user || !isActive(session.user)) return NextResponse.json({ error: "Sign in with an active account to continue. If you are signed in, ask an admin to check your account." }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const video = await prisma.video.findUnique({ where: { id } });
  // Assignment is the boundary (same rule the page enforces) — a guessed URL
  // must not stream a video the employee was never assigned. Admins: anything.
  if (
    !video ||
    !(await canAccessVideo(userId, id, isAdmin(session.user)))
  ) {
    return NextResponse.json({ error: "That video wasn't found. Go back to the dashboard and open it again." }, { status: 404 });
  }

  // App-only first: employees sign in with identity scopes only, so most have no
  // delegated token. getStreamUrl falls back to the /content redirect when an
  // app-only item lacks @microsoft.graph.downloadUrl.
  let token = await getAppOnlyToken();
  if (!token) token = await getUserGraphToken(userId);
  if (!token) return NextResponse.json({ error: "The connection to OneDrive is not set up on the server, so the video can't play. Tell IT." }, { status: 500 });

  try {
    const url = await getStreamUrl(video.graphDriveId, video.graphItemId, token);
    if (!url) return NextResponse.json({ error: "OneDrive did not return the video. Try again in a minute." }, { status: 502 });
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: failureSentence(e, "The video could not be loaded from OneDrive.", "Try again in a minute.") }, { status: 502 });
  }
}
