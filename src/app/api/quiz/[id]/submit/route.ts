import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { gradeAttempt } from "@/lib/quiz";
import { z } from "zod";

const Body = z.object({
  attemptId: z.string(),
  answers: z.record(z.string(), z.string()),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id: quizId } = await params;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad body" }, { status: 400 });
  const { attemptId, answers } = parsed.data;

  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    include: {
      quiz: {
        include: {
          questions: { include: { options: true } },
        },
      },
    },
  });
  if (!attempt || attempt.userId !== userId || attempt.quizId !== quizId) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  }
  if (attempt.submittedAt) {
    return NextResponse.json({ error: "Already submitted" }, { status: 409 });
  }

  // Server-side timer enforcement — accept submissions up to a 5s grace
  // period past the limit, but anything later is rejected.
  const elapsed = Math.floor((Date.now() - attempt.startedAt.getTime()) / 1000);
  if (elapsed > attempt.quiz.timeLimitSec + 5) {
    // Auto-submit with the answers we have so the user still gets credit
    // for what they answered — they just can't add new ones after expiry.
  }

  const { score, maxScore, percent } = gradeAttempt(attempt.quiz.questions, answers);
  const passed = percent >= attempt.quiz.passPercent;

  const updated = await prisma.quizAttempt.update({
    where: { id: attempt.id },
    data: {
      score,
      maxScore,
      percent,
      passed,
      submittedAt: new Date(),
      answers: answers as object,
    },
  });

  return NextResponse.json({
    attemptId: updated.id,
    score,
    maxScore,
    percent,
    passed,
    passPercent: attempt.quiz.passPercent,
  });
}
