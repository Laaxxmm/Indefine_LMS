// Weekly micro-checkin helpers.
//
// Each checkin is keyed by (userId, weekStart). Week start = Monday
// 00:00 UTC of the week. We show the form anytime in the current week,
// but the dashboard banner lights up Wed–Fri and stays until they do it.

import { prisma } from "@/lib/prisma";

export function weekStartFromDate(d: Date): Date {
  const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay: Sun=0 ... Sat=6. We want Monday.
  const day = u.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day; // shift back to Monday
  u.setUTCDate(u.getUTCDate() + offset);
  return u;
}

export function currentWeekStart(now: Date = new Date()): Date {
  return weekStartFromDate(now);
}

export function previousWeekStart(now: Date = new Date()): Date {
  const ws = currentWeekStart(now);
  ws.setUTCDate(ws.getUTCDate() - 7);
  return ws;
}

export function weekLabel(weekStart: Date): string {
  const end = new Date(weekStart);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(weekStart)} – ${fmt(end)}`;
}

/** Promptyness: show the dashboard banner from Wed onward, more urgent on Fri. */
export function checkinUrgency(now: Date = new Date()): "off" | "soft" | "loud" {
  const day = now.getUTCDay(); // Sun=0 ... Sat=6
  if (day === 3 || day === 4) return "soft"; // Wed-Thu
  if (day === 5 || day === 6 || day === 0) return "loud"; // Fri-Sun
  return "off"; // Mon, Tue
}

export interface CheckinStreak {
  current: number;
  best: number;
}

/** Consecutive weeks they've submitted a checkin, walking back from this week. */
export async function computeCheckinStreak(userId: string): Promise<CheckinStreak> {
  const all = await prisma.weeklyCheckin.findMany({
    where: { userId },
    select: { weekStart: true },
  });
  if (all.length === 0) return { current: 0, best: 0 };

  // Distinct weekStart values as ISO date keys
  const set = new Set(all.map((c) => c.weekStart.toISOString().slice(0, 10)));

  // Current streak — count back from this week, accept missing this week if today is Mon-Tue.
  let cursor = currentWeekStart();
  // If they haven't done THIS week yet but it's still early, skip back one.
  if (!set.has(cursor.toISOString().slice(0, 10))) {
    const day = new Date().getUTCDay();
    if (day === 1 || day === 2) {
      cursor = new Date(cursor);
      cursor.setUTCDate(cursor.getUTCDate() - 7);
    }
  }
  let current = 0;
  while (set.has(cursor.toISOString().slice(0, 10))) {
    current++;
    cursor = new Date(cursor);
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }

  // Best streak — sort + walk
  const sorted = Array.from(set).sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of sorted) {
    const d = new Date(k);
    if (prev === null) {
      run = 1;
    } else {
      const diff = Math.round(
        (d.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
      );
      run = diff === 7 ? run + 1 : 1;
    }
    if (run > best) best = run;
    prev = d;
  }

  return { current, best };
}
