import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateQuiz, type Difficulty } from "@/lib/quiz-gen";
import { NAMES_UNAVAILABLE, legacyDictionary } from "@/lib/auto-quiz";
import { isActive, isAdmin } from "@/lib/access";
import { readJsonCapped } from "@/lib/hardening/json-body";

export const dynamic = "force-dynamic";

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
  const body = jsonBody.value as {
    videoId?: string;
    sourceText?: string;
    count?: number;
    difficulty?: Difficulty;
  };

  const videoId = String(body.videoId ?? "").trim();
  const sourceText = String(body.sourceText ?? "");
  const count = Number(body.count ?? 5);
  const difficulty = (body.difficulty ?? "MEDIUM") as Difficulty;

  if (!videoId) {
    return NextResponse.json({ ok: false, error: "Choose a video first." }, { status: 400 });
  }
  if (!["EASY", "MEDIUM", "HARD", "MIXED"].includes(difficulty)) {
    return NextResponse.json({ ok: false, error: "Pick a difficulty: easy, medium, hard or mixed." }, { status: 400 });
  }

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, title: true, description: true },
  });
  if (!video) {
    return NextResponse.json({ ok: false, error: "That video wasn't found. Run a sync, then try again." }, { status: 404 });
  }

  // DPDP: the source text may name clients or staff. Mask them with the client master + staff name
  // dictionary, as SOP Builder and the automatic quiz do; if it cannot be loaded, send nothing.
  const dictionary = await legacyDictionary();
  if (!dictionary) return NextResponse.json({ ok: false, error: NAMES_UNAVAILABLE }, { status: 503 });
  const result = await generateQuiz({
    videoTitle: video.title,
    videoDescription: video.description,
    sourceText,
    count,
    difficulty,
    dictionary,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
