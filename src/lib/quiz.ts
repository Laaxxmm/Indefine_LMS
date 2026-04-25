// Quiz domain logic shared between API routes and UI loaders.

import { prisma } from "@/lib/prisma";

export interface PublicOption {
  id: string;
  text: string;
}
export interface PublicQuestion {
  id: string;
  text: string;
  points: number;
  options: PublicOption[];
}

// Strip `isCorrect` so we never leak answers to the client.
export function toPublicQuestions(
  questions: {
    id: string;
    text: string;
    points: number;
    options: { id: string; text: string; order: number }[];
  }[]
): PublicQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    text: q.text,
    points: q.points,
    options: q.options
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((o) => ({ id: o.id, text: o.text })),
  }));
}

export async function loadQuizForAttempt(quizId: string) {
  return prisma.quiz.findUnique({
    where: { id: quizId },
    include: {
      video: { include: { progresses: true } },
      questions: {
        orderBy: { order: "asc" },
        include: { options: true },
      },
    },
  });
}

export interface CanStartResult {
  ok: boolean;
  reason?: string;
}

export async function canStartAttempt(
  userId: string,
  quizId: string
): Promise<CanStartResult> {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { video: { include: { progresses: { where: { userId } } } } },
  });
  if (!quiz) return { ok: false, reason: "Quiz not found" };

  const watched = quiz.video.progresses[0]?.percent ?? 0;
  if (watched < quiz.unlockAtPercent) {
    return {
      ok: false,
      reason: `Watch at least ${quiz.unlockAtPercent}% of the video first`,
    };
  }

  if (quiz.maxAttempts != null) {
    const submitted = await prisma.quizAttempt.count({
      where: { userId, quizId, submittedAt: { not: null } },
    });
    if (submitted >= quiz.maxAttempts) {
      return { ok: false, reason: "Maximum attempts reached" };
    }
  }
  return { ok: true };
}

export function gradeAttempt(
  questions: {
    id: string;
    points: number;
    options: { id: string; isCorrect: boolean }[];
  }[],
  answers: Record<string, string>
): { score: number; maxScore: number; percent: number } {
  let score = 0;
  let maxScore = 0;
  for (const q of questions) {
    maxScore += q.points;
    const picked = answers[q.id];
    if (!picked) continue;
    const opt = q.options.find((o) => o.id === picked);
    if (opt?.isCorrect) score += q.points;
  }
  const percent = maxScore > 0 ? (score / maxScore) * 100 : 0;
  return { score, maxScore, percent };
}
