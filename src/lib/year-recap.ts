// Year-in-Review — full cycle summary using frozen TrackSnapshot +
// TierAssignment data (with live fallback for the current quarter if it
// hasn't been snapshotted yet).

import { prisma } from "@/lib/prisma";
import {
  computeTrajectory,
  currentQuarter,
  ensureDefaultCycle,
  TIER_META,
  TRACK_META,
} from "@/lib/trajectory";
import { quarterRange } from "@/lib/recap";
import type { TierKind, TrackKind } from "@prisma/client";

export interface QuarterEntry {
  quarter: number;
  frozen: boolean;
  tier: TierKind;
  totalScore: number;
  tracks: { kind: TrackKind; emoji: string; label: string; scorePct: number }[];
}

export interface YearRecapPayload {
  cycleName: string;
  cycleId: string;
  user: { id: string; name: string };
  current: QuarterEntry;
  history: QuarterEntry[]; // up to 4 entries
  tierProgression: TierKind[];
  topMomentEmoji: string;
  totals: {
    videos: number;
    quizzesPassed: number;
    initiativesPitched: number;
    initiativesShipped: number;
    endorsements: number;
    bestStreak: number;
    hours: number;
  };
}

export async function loadYearRecap(
  userId: string
): Promise<YearRecapPayload | null> {
  const cycle = await ensureDefaultCycle();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  if (!user) return null;

  const liveQ = currentQuarter(cycle);
  const live = await computeTrajectory(userId);

  const tierAssignments = await prisma.tierAssignment.findMany({
    where: { userId, cycleId: cycle.id },
    orderBy: { quarter: "asc" },
  });
  const snapshots = await prisma.trackSnapshot.findMany({
    where: { userId, cycleId: cycle.id },
  });

  const history: QuarterEntry[] = [];
  for (let q = 1; q <= 4; q++) {
    const ta = tierAssignments.find((t) => t.quarter === q);
    if (ta) {
      const qSnaps = snapshots.filter((s) => s.quarter === q);
      history.push({
        quarter: q,
        frozen: true,
        tier: ta.tier,
        totalScore: ta.totalScore,
        tracks: qSnaps.map((s) => ({
          kind: s.trackKind,
          emoji: TRACK_META[s.trackKind].emoji,
          label: TRACK_META[s.trackKind].label,
          scorePct: s.scorePct,
        })),
      });
    } else if (q === liveQ) {
      history.push({
        quarter: q,
        frozen: false,
        tier: live.tier,
        totalScore: live.totalScore,
        tracks: live.tracks.map((t) => ({
          kind: t.kind,
          emoji: t.emoji,
          label: t.label,
          scorePct: t.scorePct,
        })),
      });
    }
  }

  const current =
    history.find((h) => h.quarter === liveQ) ??
    history[history.length - 1] ?? {
      quarter: liveQ,
      frozen: false,
      tier: live.tier,
      totalScore: live.totalScore,
      tracks: live.tracks.map((t) => ({
        kind: t.kind,
        emoji: t.emoji,
        label: t.label,
        scorePct: t.scorePct,
      })),
    };

  const tierProgression = history.map((h) => h.tier);

  // Aggregate stats across the full cycle
  const within = { gte: cycle.startDate, lte: cycle.endDate };

  const [
    completedProgresses,
    attemptsPassed,
    initsPitched,
    initsShipped,
    endorsements,
  ] = await Promise.all([
    prisma.videoProgress.findMany({
      where: { userId, completed: true, completedAt: within },
      include: { video: { select: { durationSeconds: true } } },
    }),
    prisma.quizAttempt.findMany({
      where: { userId, passed: true, submittedAt: { not: null, ...within } },
      select: { quizId: true },
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
  ]);

  // Best streak across the full cycle window
  const days = new Set(
    completedProgresses.map((p) =>
      (p.completedAt ?? new Date()).toISOString().slice(0, 10)
    )
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

  const hours =
    completedProgresses.reduce(
      (s, p) => s + (p.video.durationSeconds ?? 0),
      0
    ) / 3600;

  // Pick a "top moment" emoji — most distinctive thing about the year
  let topMomentEmoji = "🌟";
  if (initsShipped > 0) topMomentEmoji = "🚀";
  else if (bestStreak >= 14) topMomentEmoji = "🔥";
  else if (current.tier === "STELLAR" || current.tier === "SOARING") topMomentEmoji = "🏆";
  else if (completedProgresses.length >= 30) topMomentEmoji = "📚";

  void quarterRange;
  void TIER_META;

  return {
    cycleName: cycle.name,
    cycleId: cycle.id,
    user: { id: userId, name: user.name ?? user.email },
    current,
    history,
    tierProgression,
    topMomentEmoji,
    totals: {
      videos: completedProgresses.length,
      quizzesPassed: new Set(attemptsPassed.map((a) => a.quizId)).size,
      initiativesPitched: initsPitched,
      initiativesShipped: initsShipped,
      endorsements,
      bestStreak,
      hours,
    },
  };
}
