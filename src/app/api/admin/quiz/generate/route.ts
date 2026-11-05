import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateQuiz, type Difficulty } from "@/lib/quiz-gen";
import { isActive, isAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !isActive(session.user) || !isAdmin(session.user)) {
    return NextResponse.json({ ok: false, error: "Only admins can do this. Sign in with an admin account, or ask an admin." }, { status: 401 });
  }

  let body: {
    videoId?: string;
    sourceText?: string;
    count?: number;
    difficulty?: Difficulty;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "The request could not be read. Reload the page and try again." }, { status: 400 });
  }

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

  const result = await generateQuiz({
    videoTitle: video.title,
    videoDescription: video.description,
    sourceText,
    count,
    difficulty,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
