// Quarterly Recap — computes a personal "Spotify Wrapped" payload
// for the active cycle's current (or previous) quarter.

import { prisma } from "@/lib/prisma";
import {
  computeTrajectory,
  ensureDefaultCycle,
  TIER_META,
  TRACK_META,
  type TrajectorySummary,
} from "@/lib/trajectory";
import type { TierKind, TrackKind } from "@prisma/client";

export interface RecapPayload {
  cycleName: string;
  quarter: number;
  range: { start: Date; end: Date };
  user: { id: string; name: string };
  trajectory: TrajectorySummary;
  topTrack: { kind: TrackKind; emoji: string; label: string; scorePct: number };
  videosCompleted: number;
  hoursLearned: number; // sum of durationSeconds for completed videos / 3600
  quizzesPassed: number;
  bestQuiz: { percent: number; videoTitle: string } | null;
  bestStreak: number;
  questsApproved: number;
  questsCompleted: number;
  milestonesCompleted: number;
  initiativesPitched: number;
  initiativesShipped: number;
  endorsementsReceived: number;
  checkinsSubmitted: number;
  tier: TierKind;
}

export function quarterRange(cycleStart: Date, quarter: number) {
  const start = new Date(cycleStart);
  start.setUTCMonth(start.getUTCMonth() + (quarter - 1) * 3);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 3);
  return { start, end };
}

export async function loadRecap(
  userId: string,
  preferQuarter?: number
): Promise<RecapPayload | null> {
  const cycle = await ensureDefaultCycle();

  const trajectory = await computeTrajectory(userId);
  const quarter = preferQuarter ?? trajectory.quarter;
  const range = quarterRange(cycle.startDate, quarter);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  if (!user) return null;

  const within = { gte: range.start, lte: range.end };

  const [
    completedProgresses,
    attempts,
    quests,
    milestones,
    initiatives,
    initiativesShipped,
    endorsements,
    checkins,
  ] = await Promise.all([
    prisma.videoProgress.findMany({
      where: { userId, completed: true, completedAt: within },
      include: { video: true },
    }),
    prisma.quizAttempt.findMany({
      where: { userId, submittedAt: { not: null, ...within } },
      include: { quiz: { include: { video: true } } },
    }),
    prisma.quest.findMany({
      where: {
        userId,
        cycleId: cycle.id,
        status: { in: ["APPROVED", "ACTIVE", "COMPLETED"] },
      },
      include: { milestones: true },
    }),
    prisma.questMilestone.findMany({
      where: {
        completed: true,
        completedAt: within,
        quest: { userId },
      },
    }),
    prisma.initiative.count({
      where: { userId, cycleId: cycle.id, createdAt: within },
    }),
    prisma.initiative.count({
      where: { userId, cycleId: cycle.id, shippedAt: within },
    }),
    prisma.endorsement.count({
      where: { toId: userId, createdAt: within },
    }),
    prisma.weeklyCheckin.count({
      where: { userId, weekStart: within },
    }),
  ]);

  const videosCompleted = completedProgresses.length;
  const hoursLearned =
    completedProgresses.reduce(
      (s, p) => s + (p.video.durationSeconds ?? 0),
      0
    ) / 3600;

  const passedAttempts = attempts.filter((a) => a.passed);
  const quizzesPassed = new Set(passedAttempts.map((a) => a.quizId)).size;
  let bestQuiz: RecapPayload["bestQuiz"] = null;
  for (const a of attempts) {
    if (!bestQuiz || a.percent > bestQuiz.percent) {
      bestQuiz = {
        percent: a.percent,
        videoTitle: a.quiz.video.title,
      };
    }
  }

  // Best streak (any time, not just this quarter — celebratory framing)
  const allActivity = await prisma.videoProgress.findMany({
    where: { userId },
    select: { updatedAt: true },
  });
  const days = new Set(
    allActivity.map((a) => a.updatedAt.toISOString().slice(0, 10))
  );
  const sorted = Array.from(days).sort();
  let bestStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev) {
      const a = new Date(prev + "T00:00:00Z");
      const b = new Date(d + "T00:00:00Z");
      const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
      run = diff === 1 ? run + 1 : 1;
    } else {
      run = 1;
    }
    if (run > bestStreak) bestStreak = run;
    prev = d;
  }

  const questsApproved = quests.length;
  const questsCompleted = quests.filter((q) => q.status === "COMPLETED").length;
  const milestonesCompleted = milestones.length;

  // Top track this quarter — pick the highest scorePct from trajectory.
  const topTrackData = [...trajectory.tracks].sort(
    (a, b) => b.scorePct - a.scorePct
  )[0];

  return {
    cycleName: cycle.name,
    quarter,
    range,
    user: { id: userId, name: user.name ?? user.email },
    trajectory,
    topTrack: topTrackData
      ? {
          kind: topTrackData.kind,
          emoji: topTrackData.emoji,
          label: topTrackData.label,
          scorePct: topTrackData.scorePct,
        }
      : { kind: "MASTERY", emoji: "📚", label: "Mastery", scorePct: 0 },
    videosCompleted,
    hoursLearned,
    quizzesPassed,
    bestQuiz,
    bestStreak,
    questsApproved,
    questsCompleted,
    milestonesCompleted,
    initiativesPitched: initiatives,
    initiativesShipped,
    endorsementsReceived: endorsements,
    checkinsSubmitted: checkins,
    tier: trajectory.tier,
  };
}

// Avoid tree-shaking complaints
void TIER_META;
void TRACK_META;
