// Assignment auto-completion.
//
// VIDEO assignments complete when the user has finished the video
// (VideoProgress.completed=true) AND, if the video has a quiz, has at
// least one passing attempt.
//
// MODULE assignments complete when *every* video in the module is done
// AND every quiz attached to those videos has been passed.
//
// We re-check on every video heartbeat that flips completed=true and
// after every quiz submission.

import { prisma } from "@/lib/prisma";

export async function refreshVideoAssignments(userId: string, videoId: string) {
  const pending = await prisma.assignment.findMany({
    where: { userId, videoId, kind: "VIDEO", status: "PENDING" },
    include: { video: { include: { quiz: true } } },
  });

  const progress = await prisma.videoProgress.findUnique({
    where: { userId_videoId: { userId, videoId } },
  });
  if (!progress?.completed) return;

  for (const a of pending) {
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

  // Touching this video may also complete a MODULE assignment.
  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: { moduleId: true },
  });
  if (video) {
    await refreshModuleAssignments(userId, video.moduleId);
  }
}

export async function refreshQuizAssignments(userId: string, quizId: string) {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { videoId: true, video: { select: { moduleId: true } } },
  });
  if (!quiz) return;
  await refreshVideoAssignments(userId, quiz.videoId);
  if (quiz.video?.moduleId) {
    await refreshModuleAssignments(userId, quiz.video.moduleId);
  }
}

export async function refreshModuleAssignments(userId: string, moduleId: string) {
  const pending = await prisma.assignment.findMany({
    where: { userId, moduleId, kind: "MODULE", status: "PENDING" },
  });
  if (pending.length === 0) return;

  const mod = await prisma.module.findUnique({
    where: { id: moduleId },
    include: {
      videos: {
        include: {
          progresses: { where: { userId } },
          quiz: {
            include: {
              attempts: { where: { userId, passed: true }, take: 1 },
            },
          },
        },
      },
    },
  });
  if (!mod || mod.videos.length === 0) return;

  const allDone = mod.videos.every((v) => {
    if (!v.progresses[0]?.completed) return false;
    if (v.quiz && v.quiz.attempts.length === 0) return false;
    return true;
  });
  if (!allDone) return;

  for (const a of pending) {
    await prisma.assignment.update({
      where: { id: a.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }
}
