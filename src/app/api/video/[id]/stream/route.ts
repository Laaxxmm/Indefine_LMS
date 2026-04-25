import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAppOnlyToken, getStreamUrl, getUserGraphToken } from "@/lib/graph";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { id } = await params;
  const video = await prisma.video.findUnique({ where: { id } });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Prefer the user's delegated token for streaming — app-only tokens
  // sometimes omit @microsoft.graph.downloadUrl on SharePoint items.
  let token = await getUserGraphToken(userId);
  if (!token) token = await getAppOnlyToken();
  if (!token) return NextResponse.json({ error: "No Graph token" }, { status: 500 });

  try {
    const url = await getStreamUrl(video.graphDriveId, video.graphItemId, token);
    if (!url) return NextResponse.json({ error: "No stream URL" }, { status: 502 });
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
