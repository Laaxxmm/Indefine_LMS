import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { autoQuizFromVideo } from "@/lib/auto-quiz";
import { isActive, isAdmin } from "@/lib/access";
import { failureSentence } from "@/lib/errors";
import { readJsonCapped } from "@/lib/hardening/json-body";

export const dynamic = "force-dynamic";
// Transcription + generation can take a couple of minutes per video.
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !isActive(session.user) || !isAdmin(session.user)) {
    return NextResponse.json({ ok: false, error: "Only admins can do this. Sign in with an admin account, or ask an admin." }, { status: 401 });
  }

  // Re-audit NEW-6: the body is capped as it streams in (413 over 1 MB).
  const jsonBody = await readJsonCapped(req);
  if (!jsonBody.ok) return jsonBody.res;
  if (!jsonBody.value || typeof jsonBody.value !== "object") {
    return NextResponse.json({ ok: false, error: "The request could not be read. Reload the page and try again." }, { status: 400 });
  }
  const body = jsonBody.value as { videoId?: string };

  const videoId = String(body.videoId ?? "").trim();
  if (!videoId) {
    return NextResponse.json({ ok: false, error: "Choose a video first." }, { status: 400 });
  }

  try {
    const result = await autoQuizFromVideo(videoId, {
      fallbackUserId: session.user.id,
    });
    return NextResponse.json(result);
  } catch (e) {
    // Always return JSON — an unhandled throw here would send an empty body and
    // the client's res.json() fails with "Unexpected end of JSON input".
    return NextResponse.json(
      { ok: false, videoId, error: failureSentence(e, "The quiz could not be generated from this video.", "Try again in a few minutes.") },
      { status: 200 }
    );
  }
}
