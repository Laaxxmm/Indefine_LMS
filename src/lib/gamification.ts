// Gamification: streaks, levels, and achievements.
//
// Everything is computed dynamically from existing data
// (VideoProgress.updatedAt, QuizAttempt.submittedAt, etc.) so we
// don't need new tables. Cheap, idempotent, and always in sync.

import { prisma } from "@/lib/prisma";
import { istDayKey } from "@/lib/ist";

export interface StreakInfo {
  current: number;
  best: number;
  activeToday: boolean;
}

/** Days where the user did *anything* (heartbeat or quiz). */
async function activityDates(userId: string): Promise<Set<string>> {
  const [progresses, attempts, active] = await Promise.all([
    prisma.videoProgress.findMany({
      where: { userId },
      select: { updatedAt: true },
    }),
    prisma.quizAttempt.findMany({
      where: { userId, submittedAt: { not: null } },
      select: { submittedAt: true },
    }),
    // Days the user simply showed up (logged in / opened the app).
    prisma.dailyActivity.findMany({ where: { userId }, select: { day: true } }),
  ]);
  const set = new Set<string>();
  for (const p of progresses) set.add(toYMD(p.updatedAt));
  for (const a of attempts) {
    if (a.submittedAt) set.add(toYMD(a.submittedAt));
  }
  for (const a of active) set.add(a.day);
  return set;
}

// IST calendar date (the firm's timezone) — the streak "day" must roll over at
// IST midnight, not UTC (which is 5:30 AM IST and split evenings across days).
function toYMD(d: Date): string {
  return istDayKey(d);
}

/** Record that the user was active today (logged in / opened the app), so the
 *  streak counts showing up — not only watching a video or taking a quiz. */
export async function recordDailyActive(userId: string): Promise<void> {
  const day = toYMD(new Date());
  await prisma.dailyActivity
    .upsert({
      where: { userId_day: { userId, day } },
      create: { userId, day },
      update: {},
    })
    .catch(() => {});
}

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return toYMD(d);
}

export async function computeStreak(userId: string): Promise<StreakInfo> {
  const dates = await activityDates(userId);
  if (dates.size === 0) return { current: 0, best: 0, activeToday: false };

  const today = toYMD(new Date());
  const yesterday = addDays(today, -1);
  const activeToday = dates.has(today);

  // Current streak: count back from today (or yesterday if not active today).
  let current = 0;
  let cursor = activeToday ? today : yesterday;
  while (dates.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  // Best streak: walk all dates sorted, accumulate longest consecutive run.
  const sorted = Array.from(dates).sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev === null || d === addDays(prev, 1)) {
      run++;
    } else {
      run = 1;
    }
    if (run > best) best = run;
    prev = d;
  }

  return { current, best, activeToday };
}

// -------------------- Levels (XP curve) --------------------
//
// Total points required to *reach* level N: 50 * N * (N - 1) / 2
// Level 1: 0      (start)
// Level 2: 50
// Level 3: 150
// Level 4: 300
// Level 5: 500   etc.

export interface LevelInfo {
  level: number;
  pointsIntoLevel: number;
  pointsForNextLevel: number;
  pctToNext: number;
  totalPoints: number;
}

export function computeLevel(totalPoints: number): LevelInfo {
  let level = 1;
  while (50 * level * (level + 1) / 2 <= totalPoints) level++;
  const cumPrev = (50 * (level - 1) * level) / 2;
  const cumNext = (50 * level * (level + 1)) / 2;
  const pointsIntoLevel = totalPoints - cumPrev;
  const pointsForNextLevel = cumNext - cumPrev;
  const pctToNext = (pointsIntoLevel / pointsForNextLevel) * 100;
  return {
    level,
    pointsIntoLevel,
    pointsForNextLevel,
    pctToNext,
    totalPoints,
  };
}

// -------------------- Achievements --------------------

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string; // lucide icon name (resolved in UI)
  unlocked: boolean;
  progress?: { current: number; target: number };
  color: "brand" | "gold" | "mint" | "rose" | "violet";
}

export async function computeAchievements(
  userId: string,
  precomputedStreak?: StreakInfo
): Promise<Achievement[]> {
  const [
    completedVideos,
    quizzesPassed,
    perfectQuiz,
    streak,
    progressesToday,
    moduleStats,
  ] = await Promise.all([
    prisma.videoProgress.count({ where: { userId, completed: true } }),
    prisma.quizAttempt.count({ where: { userId, passed: true } }),
    prisma.quizAttempt.findFirst({
      where: { userId, percent: { gte: 100 } },
      select: { id: true },
    }),
    precomputedStreak ?? computeStreak(userId),
    prisma.videoProgress.count({
      where: {
        userId,
        completed: true,
        completedAt: {
          gte: new Date(new Date().setUTCHours(0, 0, 0, 0)),
        },
      },
    }),
    prisma.module.findMany({
      include: {
        videos: {
          include: { progresses: { where: { userId } } },
        },
      },
    }),
  ]);

  const fullModules = moduleStats.filter(
    (m) =>
      m.videos.length > 0 &&
      m.videos.every((v) => v.progresses[0]?.completed)
  ).length;

  const list: Achievement[] = [
    {
      id: "first-step",
      title: "First Steps",
      description: "Complete your first video",
      icon: "Footprints",
      color: "brand",
      unlocked: completedVideos >= 1,
      progress: { current: Math.min(completedVideos, 1), target: 1 },
    },
    {
      id: "quick-learner",
      title: "Quick Learner",
      description: "Complete 5 videos",
      icon: "Sparkles",
      color: "brand",
      unlocked: completedVideos >= 5,
      progress: { current: Math.min(completedVideos, 5), target: 5 },
    },
    {
      id: "dedicated",
      title: "Dedicated",
      description: "Complete 10 videos",
      icon: "Award",
      color: "violet",
      unlocked: completedVideos >= 10,
      progress: { current: Math.min(completedVideos, 10), target: 10 },
    },
    {
      id: "binge",
      title: "Binge Watcher",
      description: "Complete 3 videos in one day",
      icon: "Zap",
      color: "gold",
      unlocked: progressesToday >= 3,
      progress: { current: Math.min(progressesToday, 3), target: 3 },
    },
    {
      id: "quiz-master",
      title: "Quiz Master",
      description: "Pass your first quiz",
      icon: "GraduationCap",
      color: "mint",
      unlocked: quizzesPassed >= 1,
      progress: { current: Math.min(quizzesPassed, 1), target: 1 },
    },
    {
      id: "perfectionist",
      title: "Perfectionist",
      description: "Score 100% on a quiz",
      icon: "Target",
      color: "gold",
      unlocked: !!perfectQuiz,
    },
    {
      id: "streak-3",
      title: "Hot Streak",
      description: "3-day learning streak",
      icon: "Flame",
      color: "rose",
      unlocked: streak.best >= 3,
      progress: { current: Math.min(streak.best, 3), target: 3 },
    },
    {
      id: "streak-7",
      title: "On Fire",
      description: "7-day learning streak",
      icon: "Flame",
      color: "gold",
      unlocked: streak.best >= 7,
      progress: { current: Math.min(streak.best, 7), target: 7 },
    },
    {
      id: "module-mastery",
      title: "Module Mastery",
      description: "Complete every video in a module",
      icon: "Trophy",
      color: "gold",
      unlocked: fullModules >= 1,
      progress: { current: Math.min(fullModules, 1), target: 1 },
    },
  ];

  return list;
}
