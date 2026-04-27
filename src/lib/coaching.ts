// Coaching prompts — auto-generated suggestions for managers based on
// trends in their reports' data. The aim is to point them at the
// 1-2 highest-leverage things they can do this week.

import { prisma } from "@/lib/prisma";
import {
  computeTrajectory,
  type TrajectorySummary,
} from "@/lib/trajectory";
import { computeCheckinStreak, currentWeekStart, previousWeekStart } from "@/lib/checkins";

export type PromptSeverity = "info" | "warn" | "alert";

export interface CoachingPrompt {
  id: string;
  severity: PromptSeverity;
  emoji: string;
  title: string;
  detail: string;
  cta?: { label: string; href: string };
}

export interface ReportSummary {
  userId: string;
  name: string;
  email: string;
  level: string;
  trajectory: TrajectorySummary;
  thisWeekCheckin: { whatBlocked: string | null } | null;
  lastWeekCheckin: { whatBlocked: string | null } | null;
  prompts: CoachingPrompt[];
  weekStreak: number;
}

export async function loadTeam(managerId: string): Promise<ReportSummary[]> {
  const reports = await prisma.user.findMany({
    where: { managerId, active: true },
    orderBy: { name: "asc" },
  });

  const ws = currentWeekStart();
  const lastWs = previousWeekStart();

  return Promise.all(
    reports.map(async (u) => {
      const [trajectory, thisCheckin, lastCheckin, streak] = await Promise.all([
        computeTrajectory(u.id),
        prisma.weeklyCheckin.findUnique({
          where: { userId_weekStart: { userId: u.id, weekStart: ws } },
        }),
        prisma.weeklyCheckin.findUnique({
          where: { userId_weekStart: { userId: u.id, weekStart: lastWs } },
        }),
        computeCheckinStreak(u.id),
      ]);

      const prompts = derivePrompts(trajectory, thisCheckin, lastCheckin);

      return {
        userId: u.id,
        name: u.name ?? u.email,
        email: u.email,
        level: u.level,
        trajectory,
        thisWeekCheckin: thisCheckin,
        lastWeekCheckin: lastCheckin,
        prompts,
        weekStreak: streak.current,
      };
    })
  );
}

function derivePrompts(
  traj: TrajectorySummary,
  thisCheckin: { whatBlocked: string | null } | null,
  lastCheckin: { whatBlocked: string | null } | null
): CoachingPrompt[] {
  const list: CoachingPrompt[] = [];

  // 1. Two consecutive weeks blocked → suggest 1:1
  if (
    thisCheckin?.whatBlocked &&
    thisCheckin.whatBlocked.trim() &&
    lastCheckin?.whatBlocked &&
    lastCheckin.whatBlocked.trim()
  ) {
    list.push({
      id: "blocked-2w",
      severity: "alert",
      emoji: "🚩",
      title: "Blocked two weeks running",
      detail:
        "They flagged blockers in both this week's and last week's check-in. Worth a focused 1:1.",
    });
  }

  // 2. No check-in this week (after Wednesday)
  const day = new Date().getUTCDay();
  if (!thisCheckin && (day === 5 || day === 6 || day === 0 || day === 4)) {
    list.push({
      id: "no-checkin",
      severity: "info",
      emoji: "💬",
      title: "No check-in this week",
      detail:
        "Send a friendly nudge — the weekly reflection takes 90 seconds.",
    });
  }

  // 3. Tier is RECALIBRATING
  if (traj.tier === "RECALIBRATING") {
    list.push({
      id: "tier-low",
      severity: "alert",
      emoji: "🌊",
      title: "Tier is Recalibrating",
      detail:
        "They could use clear support and a focused short-term plan. Schedule time to reset priorities together.",
    });
  } else if (traj.tier === "FOCUSED") {
    list.push({
      id: "tier-focused",
      severity: "warn",
      emoji: "🎯",
      title: "Tier is Focused",
      detail: "A few areas need attention. Pick one to coach on this week.",
    });
  }

  // 4. Mastery very low
  const mastery = traj.tracks.find((t) => t.kind === "MASTERY");
  if (mastery && mastery.scorePct < 50) {
    list.push({
      id: "mastery-low",
      severity: "warn",
      emoji: "📚",
      title: "Mastery score is low",
      detail: `Currently ${Math.round(mastery.scorePct)}% — assigned content isn't being completed. Worth a check on workload or motivation.`,
    });
  }

  // 5. Vision = 0 (no quests set)
  const vision = traj.tracks.find((t) => t.kind === "VISION");
  if (vision && vision.actual === 0) {
    list.push({
      id: "no-quests",
      severity: "info",
      emoji: "🎯",
      title: "No quests set this cycle",
      detail:
        "They haven't completed the Growth Wizard yet. Encourage them to set their own targets.",
    });
  }

  // 6. Strong streak — celebrate
  if (traj.tier === "STELLAR" || traj.tier === "SOARING") {
    list.push({
      id: "celebrate",
      severity: "info",
      emoji: "🌟",
      title: "Crushing it",
      detail:
        "Tier is high. Endorse what's working and ask what stretch they'd love next.",
    });
  }

  return list;
}
