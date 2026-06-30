import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canStartAttempt, loadQuizForAttempt, toPublicQuestions } from "@/lib/quiz";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id: quizId } = await params;

  // Block quizzes whose video is in an unpublished course (admins exempt).
  const access = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { video: { select: { module: { select: { course: { select: { published: true } } } } } } },
  });
  if (!access || (session.user.role !== "ADMIN" && !access.video?.module?.course?.published)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const gate = await canStartAttempt(userId, quizId);
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  const quiz = await loadQuizForAttempt(quizId);
  if (!quiz) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });

  // Reuse an in-flight attempt rather than creating duplicates if user reloads.
  const inFlight = await prisma.quizAttempt.findFirst({
    where: { userId, quizId, submittedAt: null },
    orderBy: { startedAt: "desc" },
  });
  const attempt =
    inFlight ??
    (await prisma.quizAttempt.create({
      data: { userId, quizId, maxScore: quiz.questions.reduce((s, q) => s + q.points, 0) },
    }));

  const elapsed = Math.floor((Date.now() - attempt.startedAt.getTime()) / 1000);
  const remaining = Math.max(0, quiz.timeLimitSec - elapsed);

  return NextResponse.json({
    attemptId: attempt.id,
    quizTitle: quiz.title,
    timeLimitSec: quiz.timeLimitSec,
    remainingSec: remaining,
    passPercent: quiz.passPercent,
    questions: toPublicQuestions(quiz.questions),
  });
}
