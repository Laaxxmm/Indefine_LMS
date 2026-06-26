import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateQuiz, type Difficulty } from "@/lib/quiz-gen";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const videoId = String(body.videoId ?? "").trim();
  const sourceText = String(body.sourceText ?? "");
  const count = Number(body.count ?? 5);
  const difficulty = (body.difficulty ?? "MEDIUM") as Difficulty;

  if (!videoId) {
    return NextResponse.json({ ok: false, error: "videoId required" }, { status: 400 });
  }
  if (!["EASY", "MEDIUM", "HARD", "MIXED"].includes(difficulty)) {
    return NextResponse.json({ ok: false, error: "Bad difficulty" }, { status: 400 });
  }

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { id: true, title: true, description: true },
  });
  if (!video) {
    return NextResponse.json({ ok: false, error: "Video not found" }, { status: 404 });
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
