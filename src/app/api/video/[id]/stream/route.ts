import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessVideo } from "@/lib/assignments";
import { getAppOnlyToken, getStreamUrl, getUserGraphToken } from "@/lib/graph";
import { isAdmin } from "@/lib/access";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const video = await prisma.video.findUnique({ where: { id } });
  // Assignment is the boundary (same rule the page enforces) — a guessed URL
  // must not stream a video the employee was never assigned. Admins: anything.
  if (
    !video ||
    !(await canAccessVideo(userId, id, isAdmin(session.user)))
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // App-only first: employees sign in with identity scopes only, so most have no
  // delegated token. getStreamUrl falls back to the /content redirect when an
  // app-only item lacks @microsoft.graph.downloadUrl.
  let token = await getAppOnlyToken();
  if (!token) token = await getUserGraphToken(userId);
  if (!token) return NextResponse.json({ error: "No Graph token" }, { status: 500 });

  try {
    const url = await getStreamUrl(video.graphDriveId, video.graphItemId, token);
    if (!url) return NextResponse.json({ error: "No stream URL" }, { status: 502 });
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
