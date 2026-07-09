// Trajectory — the live "growth OS" computation layer.
//
// Six tracks, each with a per-cycle / per-level target + weight:
//   MASTERY       — auto: % of assigned MODULE+VIDEO completed, plus avg best-quiz %
//   DELIVERY      — auto: % of assigned tasks completed on time
//   INITIATIVE    — self-log: count of FUNDED+SHIPPED initiatives + INITIATIVE endorsements
//   COLLABORATION — self-log: COLLABORATION+MENTORSHIP+CROSS_DEPT endorsements received
//   VISION        — self-set: % of approved Quests completed (milestones rolled up)
//   CRAFT         — manager-rated: avg of 1-5 ratings stored as endorsement.score (future)
//
// scorePct per track = clamp(actual / target * 100, 0, 100)
// totalScore = sum(scorePct * weight/100) across all six tracks
// tier = first band whose minPct <= totalScore

import { prisma } from "@/lib/prisma";
import type {
  EmployeeLevel,
  PerformanceCycle,
  TrackKind,
  TierKind,
  Prisma,
} from "@prisma/client";

export interface TrackResult {
  kind: TrackKind;
  label: string;
  emoji: string;
  actual: number;
  target: number;
  scorePct: number;
  weight: number;
  weighted: number;
  nextMove: string;
}

export interface TrajectorySummary {
  cycle: PerformanceCycle | null;
  quarter: number;
  level: EmployeeLevel;
  tracks: TrackResult[];
  totalScore: number;
  tier: TierKind;
  rings: {
    mastery: number;   // 0-100 daily/weekly closure
    delivery: number;
    growth: number;    // initiative + collaboration + vision rolled
  };
}

// Default targets per level, calibrated for a CA / financial firm.
// Articles + Executives are still learning, so Mastery/Delivery targets
// are gentler; Managers and Partners weigh Initiative + Vision higher.
const TARGETS_BY_LEVEL: Record<TrackKind, Record<EmployeeLevel, number>> = {
  MASTERY: {
    TRAINEE: 70, ASSOCIATE: 75, SENIOR: 80, LEAD: 80,
    ARTICLE: 70,
    EXECUTIVE: 75,
    SENIOR_EXECUTIVE: 80,
    ASSISTANT_MANAGER: 80,
    MANAGER: 75,
    SENIOR_MANAGER: 70,
    PARTNER: 65,
  },
  DELIVERY: {
    TRAINEE: 80, ASSOCIATE: 85, SENIOR: 90, LEAD: 90,
    ARTICLE: 80,
    EXECUTIVE: 85,
    SENIOR_EXECUTIVE: 90,
    ASSISTANT_MANAGER: 92,
    MANAGER: 92,
    SENIOR_MANAGER: 92,
    PARTNER: 92,
  },
  INITIATIVE: {
    TRAINEE: 1, ASSOCIATE: 2, SENIOR: 3, LEAD: 4,
    ARTICLE: 1,
    EXECUTIVE: 2,
    SENIOR_EXECUTIVE: 3,
    ASSISTANT_MANAGER: 4,
    MANAGER: 5,
    SENIOR_MANAGER: 6,
    PARTNER: 8,
  },
  COLLABORATION: {
    TRAINEE: 2, ASSOCIATE: 3, SENIOR: 4, LEAD: 5,
    ARTICLE: 2,
    EXECUTIVE: 3,
    SENIOR_EXECUTIVE: 4,
    ASSISTANT_MANAGER: 5,
    MANAGER: 6,
    SENIOR_MANAGER: 7,
    PARTNER: 8,
  },
  VISION: {
    TRAINEE: 70, ASSOCIATE: 75, SENIOR: 80, LEAD: 85,
    ARTICLE: 70,
    EXECUTIVE: 75,
    SENIOR_EXECUTIVE: 80,
    ASSISTANT_MANAGER: 85,
    MANAGER: 85,
    SENIOR_MANAGER: 90,
    PARTNER: 90,
  },
  CRAFT: {
    TRAINEE: 3.5, ASSOCIATE: 3.8, SENIOR: 4.0, LEAD: 4.2,
    ARTICLE: 3.5,
    EXECUTIVE: 3.8,
    SENIOR_EXECUTIVE: 4.0,
    ASSISTANT_MANAGER: 4.2,
    MANAGER: 4.3,
    SENIOR_MANAGER: 4.5,
    PARTNER: 4.7,
  },
};

export const TRACK_META: Record<
  TrackKind,
  { label: string; emoji: string; defaultTarget: Record<EmployeeLevel, number>; defaultWeight: number }
> = {
  MASTERY: {
    label: "Mastery",
    emoji: "📚",
    defaultTarget: TARGETS_BY_LEVEL.MASTERY,
    defaultWeight: 25,
  },
  DELIVERY: {
    label: "Delivery",
    emoji: "💪",
    defaultTarget: TARGETS_BY_LEVEL.DELIVERY,
    defaultWeight: 25,
  },
  INITIATIVE: {
    label: "Initiative",
    emoji: "🌱",
    defaultTarget: TARGETS_BY_LEVEL.INITIATIVE,
    defaultWeight: 15,
  },
  COLLABORATION: {
    label: "Collaboration",
    emoji: "🤝",
    defaultTarget: TARGETS_BY_LEVEL.COLLABORATION,
    defaultWeight: 10,
  },
  VISION: {
    label: "Vision",
    emoji: "🎯",
    defaultTarget: TARGETS_BY_LEVEL.VISION,
    defaultWeight: 15,
  },
  CRAFT: {
    label: "Craft",
    emoji: "⭐",
    defaultTarget: TARGETS_BY_LEVEL.CRAFT,
    defaultWeight: 10,
  },
};

export const TIER_META: Record<
  TierKind,
  {
    label: string;
    minPct: number;
    color: string;
    bg: string;
    fg: string;
    glow: string;
    blurb: string;
  }
> = {
  STELLAR: {
    label: "Stellar",
    minPct: 90,
    color: "gold",
    bg: "bg-card",
    fg: "text-amber-700",
    glow: "shadow-soft",
    blurb: "Top of the class. You're setting the bar.",
  },
  SOARING: {
    label: "Soaring",
    minPct: 80,
    color: "brand",
    bg: "bg-card",
    fg: "text-brand-700",
    glow: "shadow-soft",
    blurb: "Exceeding expectations — keep flying.",
  },
  SOLID: {
    label: "Solid",
    minPct: 70,
    color: "emerald",
    bg: "bg-card",
    fg: "text-emerald-700",
    glow: "shadow-soft",
    blurb: "Strong performer. You're delivering.",
  },
  GROWING: {
    label: "Growing",
    minPct: 60,
    color: "sky",
    bg: "bg-card",
    fg: "text-sky-700",
    glow: "shadow-soft",
    blurb: "Building momentum — you're on track.",
  },
  FOCUSED: {
    label: "Focused",
    minPct: 50,
    color: "amber",
    bg: "bg-card",
    fg: "text-amber-700",
    glow: "shadow-soft",
    blurb: "A few areas need attention. You've got this.",
  },
  RECALIBRATING: {
    label: "Recalibrating",
    minPct: 0,
    color: "rose",
    bg: "bg-card",
    fg: "text-rose-700",
    glow: "shadow-soft",
    blurb: "Reset and rebuild — support is on the way.",
  },
};

export function tierForScore(totalScore: number): TierKind {
  const order: TierKind[] = [
    "STELLAR",
    "SOARING",
    "SOLID",
    "GROWING",
    "FOCUSED",
    "RECALIBRATING",
  ];
  for (const t of order) {
    if (totalScore >= TIER_META[t].minPct) return t;
  }
  return "RECALIBRATING";
}

// -------------------- Setup helpers --------------------

/** Create a default cycle + targets if none exist. Idempotent. */
export async function ensureDefaultCycle(): Promise<PerformanceCycle> {
  const existing = await prisma.performanceCycle.findFirst({
    where: { isActive: true },
  });
  if (existing) return existing;

  const now = new Date();
  // Indian financial year — Apr 1 to Mar 31
  const fyStart = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  const start = new Date(fyStart, 3, 1);
  const end = new Date(fyStart + 1, 2, 31, 23, 59, 59);
  const name = `FY ${fyStart}-${String(fyStart + 1).slice(-2)}`;

  const cycle = await prisma.performanceCycle.create({
    data: { name, startDate: start, endDate: end, isActive: true },
  });

  // Seed default targets for every track × level combination.
  // Includes legacy values (TRAINEE/ASSOCIATE/SENIOR/LEAD) so users on
  // those still get sensible targets while admins migrate them.
  const levels: EmployeeLevel[] = [
    "ARTICLE",
    "EXECUTIVE",
    "SENIOR_EXECUTIVE",
    "ASSISTANT_MANAGER",
    "MANAGER",
    "SENIOR_MANAGER",
    "PARTNER",
    "TRAINEE",
    "ASSOCIATE",
    "SENIOR",
    "LEAD",
  ];
  const trackKinds: TrackKind[] = [
    "MASTERY",
    "DELIVERY",
    "INITIATIVE",
    "COLLABORATION",
    "VISION",
    "CRAFT",
  ];

  const data: Prisma.TrackTargetCreateManyInput[] = [];
  for (const trackKind of trackKinds) {
    const meta = TRACK_META[trackKind];
    for (const level of levels) {
      data.push({
        cycleId: cycle.id,
        trackKind,
        level,
        target: meta.defaultTarget[level],
        weight: meta.defaultWeight,
      });
    }
  }
  await prisma.trackTarget.createMany({ data });

  return cycle;
}

// -------------------- Quarter helper --------------------

export function currentQuarter(cycle: PerformanceCycle, now: Date = new Date()): number {
  const ms = now.getTime() - cycle.startDate.getTime();
  const totalMs = cycle.endDate.getTime() - cycle.startDate.getTime();
  if (ms <= 0) return 1;
  if (ms >= totalMs) return 4;
  return Math.min(4, Math.floor((ms / totalMs) * 4) + 1);
}

// -------------------- Per-track scoring --------------------

interface ScoringContext {
  userId: string;
  cycle: PerformanceCycle;
  level: EmployeeLevel;
}

async function scoreMastery(ctx: ScoringContext): Promise<{ actual: number; nextMove: string }> {
  const userId = ctx.userId;

  // % of assigned MODULE/VIDEO assignments completed
  const assigned = await prisma.assignment.findMany({
    where: {
      userId,
      kind: { in: ["MODULE", "VIDEO"] },
      createdAt: { gte: ctx.cycle.startDate, lte: ctx.cycle.endDate },
    },
    select: { status: true },
  });
  const compliance =
    assigned.length === 0
      ? 100
      : (assigned.filter((a) => a.status === "COMPLETED").length / assigned.length) * 100;

  // Avg best quiz %
  const attempts = await prisma.quizAttempt.findMany({
    where: {
      userId,
      submittedAt: {
        not: null,
        gte: ctx.cycle.startDate,
        lte: ctx.cycle.endDate,
      },
    },
    select: { quizId: true, percent: true },
  });
  const bestPerQuiz = new Map<string, number>();
  for (const a of attempts) {
    const cur = bestPerQuiz.get(a.quizId) ?? 0;
    if (a.percent > cur) bestPerQuiz.set(a.quizId, a.percent);
  }
  const avgQuiz =
    bestPerQuiz.size === 0
      ? null
      : Array.from(bestPerQuiz.values()).reduce((s, p) => s + p, 0) / bestPerQuiz.size;

  const actual = avgQuiz === null ? compliance : (compliance + avgQuiz) / 2;

  let nextMove = "Watch a video to start your Mastery streak";
  if (assigned.length > 0 && compliance < 100) {
    const pending = assigned.length - assigned.filter((a) => a.status === "COMPLETED").length;
    nextMove = `Finish ${pending} more assignment${pending === 1 ? "" : "s"} to lift Mastery`;
  } else if (avgQuiz !== null && avgQuiz < 80) {
    nextMove = "Retake a quiz — your average can climb";
  } else if (actual >= 90) {
    nextMove = "You're crushing Mastery — share a tip with a teammate";
  }

  return { actual, nextMove };
}

async function scoreDelivery(ctx: ScoringContext): Promise<{ actual: number; nextMove: string }> {
  const userId = ctx.userId;

  // % of assigned TASK + VIDEO + MODULE done before dueAt (or done at all if no due)
  const assigned = await prisma.assignment.findMany({
    where: {
      userId,
      createdAt: { gte: ctx.cycle.startDate, lte: ctx.cycle.endDate },
    },
    select: { status: true, dueAt: true, completedAt: true },
  });
  if (assigned.length === 0) return { actual: 100, nextMove: "No tasks yet — Delivery is fresh" };

  const onTime = assigned.filter((a) => {
    if (a.status !== "COMPLETED") return false;
    if (!a.dueAt) return true;
    return a.completedAt && a.completedAt <= a.dueAt;
  }).length;
  const actual = (onTime / assigned.length) * 100;

  const overdue = assigned.filter(
    (a) => a.status === "PENDING" && a.dueAt && a.dueAt < new Date()
  ).length;
  let nextMove = "Stay on top of due dates";
  if (overdue > 0) {
    nextMove = `Clear ${overdue} overdue item${overdue === 1 ? "" : "s"} ASAP`;
  } else if (actual >= 95) {
    nextMove = "Delivery is rock solid";
  }

  return { actual, nextMove };
}

async function scoreInitiative(ctx: ScoringContext): Promise<{ actual: number; nextMove: string }> {
  const initiatives = await prisma.initiative.count({
    where: {
      userId: ctx.userId,
      cycleId: ctx.cycle.id,
      status: { in: ["FUNDED", "ACTIVE", "SHIPPED"] },
    },
  });
  const endorsements = await prisma.endorsement.count({
    where: {
      toId: ctx.userId,
      kind: "INITIATIVE",
      createdAt: { gte: ctx.cycle.startDate, lte: ctx.cycle.endDate },
    },
  });
  const actual = initiatives + endorsements;

  let nextMove = "Pitch a new initiative on the board";
  if (actual === 0) nextMove = "Pitch your first initiative — bold ideas welcome";
  else if (actual < 3) nextMove = "Keep the ideas flowing — pitch another";
  else nextMove = "You're an initiative machine 🌱";

  return { actual, nextMove };
}

async function scoreCollaboration(ctx: ScoringContext): Promise<{ actual: number; nextMove: string }> {
  const count = await prisma.endorsement.count({
    where: {
      toId: ctx.userId,
      kind: { in: ["COLLABORATION", "MENTORSHIP", "CROSS_DEPT"] },
      createdAt: { gte: ctx.cycle.startDate, lte: ctx.cycle.endDate },
    },
  });

  let nextMove = "Help a teammate this week";
  if (count === 0) nextMove = "Log your first cross-team assist";
  else if (count < 3) nextMove = "Keep helping — endorsements add up";
  else nextMove = "You're the team's connector 🤝";

  return { actual: count, nextMove };
}

async function scoreVision(ctx: ScoringContext): Promise<{ actual: number; nextMove: string }> {
  const quests = await prisma.quest.findMany({
    where: { userId: ctx.userId, cycleId: ctx.cycle.id, status: { in: ["APPROVED", "ACTIVE", "COMPLETED"] } },
    include: { milestones: true },
  });
  if (quests.length === 0) {
    return { actual: 0, nextMove: "Set your quarterly quests in the Growth Wizard" };
  }

  let totalMilestones = 0;
  let doneMilestones = 0;
  let questCompleteCount = 0;
  for (const q of quests) {
    if (q.status === "COMPLETED") {
      questCompleteCount++;
      totalMilestones += q.milestones.length || 1;
      doneMilestones += q.milestones.length || 1;
      continue;
    }
    if (q.milestones.length === 0) continue;
    totalMilestones += q.milestones.length;
    doneMilestones += q.milestones.filter((m) => m.completed).length;
  }
  const actual = totalMilestones === 0 ? questCompleteCount * 100 : (doneMilestones / totalMilestones) * 100;

  let nextMove = "Tick off your next quest milestone";
  if (actual >= 80) nextMove = "Vision on point — you're shipping your goals";
  else if (actual < 30) nextMove = "Pick a milestone you can finish this week";

  return { actual, nextMove };
}

async function scoreCraft(ctx: ScoringContext): Promise<{ actual: number; nextMove: string }> {
  const ratings = await prisma.endorsement.findMany({
    where: {
      toId: ctx.userId,
      kind: "CRAFT",
      createdAt: { gte: ctx.cycle.startDate, lte: ctx.cycle.endDate },
    },
    select: { score: true },
  });
  if (ratings.length === 0) {
    return {
      actual: 3.0,
      nextMove: "Ask your manager for craft feedback in your next 1:1",
    };
  }
  const valid = ratings.filter((r): r is { score: number } => typeof r.score === "number");
  if (valid.length === 0) {
    return {
      actual: 3.0,
      nextMove: "Manager hasn't rated craft yet this cycle",
    };
  }
  const avg = valid.reduce((s, r) => s + r.score, 0) / valid.length;
  let nextMove = "Solid craft rating — keep refining";
  if (avg < 3) nextMove = "Pair with a senior on a piece of work this week";
  else if (avg < 4) nextMove = "You're consistent — push for one stretch piece";
  else nextMove = "Stellar craft 🌟 — share what works in a team session";
  return { actual: avg, nextMove };
}

// -------------------- Compose --------------------

export async function computeTrajectory(userId: string): Promise<TrajectorySummary> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { level: true },
  });
  const level: EmployeeLevel = user?.level ?? "ASSOCIATE";

  const cycle = await prisma.performanceCycle.findFirst({
    where: { isActive: true },
  });
  if (!cycle) {
    return {
      cycle: null,
      quarter: 1,
      level,
      tracks: [],
      totalScore: 0,
      tier: "RECALIBRATING",
      rings: { mastery: 0, delivery: 0, growth: 0 },
    };
  }

  const targets = await prisma.trackTarget.findMany({
    where: { cycleId: cycle.id, level },
  });
  const targetByKind = new Map(targets.map((t) => [t.trackKind, t]));

  const ctx: ScoringContext = { userId, cycle, level };
  const [mastery, delivery, initiative, collaboration, vision, craft] =
    await Promise.all([
      scoreMastery(ctx),
      scoreDelivery(ctx),
      scoreInitiative(ctx),
      scoreCollaboration(ctx),
      scoreVision(ctx),
      scoreCraft(ctx),
    ]);

  const raw: { kind: TrackKind; result: { actual: number; nextMove: string } }[] = [
    { kind: "MASTERY", result: mastery },
    { kind: "DELIVERY", result: delivery },
    { kind: "INITIATIVE", result: initiative },
    { kind: "COLLABORATION", result: collaboration },
    { kind: "VISION", result: vision },
    { kind: "CRAFT", result: craft },
  ];

  const tracks: TrackResult[] = raw.map(({ kind, result }) => {
    const meta = TRACK_META[kind];
    const tgt = targetByKind.get(kind);
    const target = tgt?.target ?? meta.defaultTarget[level];
    const weight = tgt?.weight ?? meta.defaultWeight;
    const scorePct = target > 0 ? Math.min(100, (result.actual / target) * 100) : 0;
    const weighted = (scorePct * weight) / 100;
    return {
      kind,
      label: meta.label,
      emoji: meta.emoji,
      actual: result.actual,
      target,
      scorePct,
      weight,
      weighted,
      nextMove: result.nextMove,
    };
  });

  const totalScore = tracks.reduce((s, t) => s + t.weighted, 0);
  const tier = tierForScore(totalScore);

  // Rings — daily/weekly closure metric, not raw track scores.
  const masteryRing = Math.min(100, mastery.actual);
  const deliveryRing = Math.min(100, delivery.actual);
  const growthRing = Math.min(
    100,
    ((initiative.actual / Math.max(1, TRACK_META.INITIATIVE.defaultTarget[level])) * 33 +
      (collaboration.actual / Math.max(1, TRACK_META.COLLABORATION.defaultTarget[level])) * 33 +
      (vision.actual / 100) * 34) // vision is already a %
  );

  return {
    cycle,
    quarter: currentQuarter(cycle),
    level,
    tracks,
    totalScore,
    tier,
    rings: {
      mastery: masteryRing,
      delivery: deliveryRing,
      growth: growthRing,
    },
  };
}
