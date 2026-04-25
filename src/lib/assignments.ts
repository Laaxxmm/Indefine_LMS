// Assignment auto-completion.
//
// VIDEO assignments complete when the user has finished the video
// (VideoProgress.completed=true) AND, if the video has a quiz, has at
// least one passing attempt. We re-check after every video heartbeat
// that flips completed=true and after every quiz submission.

import { prisma } from "@/lib/prisma";

export async function refreshVideoAssignments(userId: string, videoId: string) {
  const pending = await prisma.assignment.findMany({
    where: {
      userId,
      videoId,
      kind: "VIDEO",
      status: "PENDING",
    },
    include: { video: { include: { quiz: true } } },
  });
  if (pending.length === 0) return;

  const progress = await prisma.videoProgress.findUnique({
    where: { userId_videoId: { userId, videoId } },
  });
  if (!progress?.completed) return;

  for (const a of pending) {
    // If the video has a quiz, the assignment also requires a passing attempt.
    if (a.video?.quiz) {
      const passed = await prisma.quizAttempt.findFirst({
        where: { userId, quizId: a.video.quiz.id, passed: true },
      });
      if (!passed) continue;
    }
    await prisma.assignment.update({
      where: { id: a.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }
}

export async function refreshQuizAssignments(userId: string, quizId: string) {
  // After a passing quiz attempt, any VIDEO assignment for the parent video
  // may now be eligible for completion.
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { videoId: true },
  });
  if (!quiz) return;
  await refreshVideoAssignments(userId, quiz.videoId);
}
