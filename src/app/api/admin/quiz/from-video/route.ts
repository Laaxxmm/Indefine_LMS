import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { autoQuizFromVideo } from "@/lib/auto-quiz";

export const dynamic = "force-dynamic";
// Transcription + generation can take a couple of minutes per video.
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: { videoId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const videoId = String(body.videoId ?? "").trim();
  if (!videoId) {
    return NextResponse.json({ ok: false, error: "videoId required" }, { status: 400 });
  }

  const result = await autoQuizFromVideo(videoId, { fallbackUserId: session.user.id });
  return NextResponse.json(result, { status: result.ok ? 200 : 200 });
}
