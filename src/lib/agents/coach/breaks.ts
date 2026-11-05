// Break-nudge state machine (Phase 9 task 3, ADR-006). Pure: heartbeats, today's nudges, the
// person's preferences and the clock go in; a state comes out. No Prisma, no clock.
//
//   off        the feature flag is off, or the person turned break reminders off
//   snoozed    the person snoozed reminders and the snooze has not ended
//   idle       no activity in the window
//   on-break   the last heartbeat is ≥ 10 min old: they are away
//   active     working continuously (no gap ≥ 10 min) for less than the threshold
//   nudge      continuously active for more than 100 min since the streak began (or since the last
//              nudge in this streak): raise one, the n-th today
//   limit      would nudge, but today's 3 are used up
//
// A snoozed nudge comes back when the snooze ends if the streak never broke. Data stays with the
// person: nothing here is shown or reported to anyone else (ADR-006).
import { istDayStart } from "@/lib/ist";
import { BREAK_POLICY, type BreakPolicy } from "./config";

export type BreakPrefs = { enabled: boolean; snoozeUntil: Date | null };

export type BreakInput = {
  now: Date;
  /** Heartbeat times (any order). Only those in [now − lookback, now] are used. */
  heartbeats: readonly Date[];
  /** When today's (IST) break nudges were raised. */
  nudgesToday: readonly Date[];
  prefs: BreakPrefs;
  featureOn: boolean;
};

export type BreakState =
  | { state: "off"; reason: "feature-off" | "opted-out" }
  | { state: "snoozed"; until: Date }
  | { state: "idle" }
  | { state: "on-break"; awayMs: number }
  | { state: "active"; streakStart: Date; activeMs: number; nudgeAt: Date }
  | { state: "nudge"; streakStart: Date; activeMs: number; ordinal: number }
  | { state: "limit"; streakStart: Date; activeMs: number };

const MIN = 60_000;

/** Start of the current streak: walk back from the last heartbeat while gaps stay under `gapMs`. */
export function streakStart(sortedBeats: readonly number[], gapMs: number): number {
  let i = sortedBeats.length - 1;
  while (i > 0 && sortedBeats[i] - sortedBeats[i - 1] < gapMs) i -= 1;
  return sortedBeats[i];
}

export function evaluateBreak(input: BreakInput, policy: BreakPolicy = BREAK_POLICY): BreakState {
  if (!input.featureOn) return { state: "off", reason: "feature-off" };
  if (!input.prefs.enabled) return { state: "off", reason: "opted-out" };
  const now = input.now.getTime();
  const snooze = input.prefs.snoozeUntil?.getTime() ?? null;
  if (snooze !== null && now < snooze) return { state: "snoozed", until: new Date(snooze) };

  const gapMs = policy.gapMin * MIN;
  const from = now - policy.lookbackHours * 60 * MIN;
  const beats = input.heartbeats
    .map((d) => d.getTime())
    .filter((t) => t >= from && t <= now)
    .sort((a, b) => a - b);
  if (beats.length === 0) return { state: "idle" };
  const last = beats[beats.length - 1];
  if (now - last >= gapMs) return { state: "on-break", awayMs: now - last };

  const start = streakStart(beats, gapMs);
  const activeMs = last - start;
  const dayStart = istDayStart(input.now).getTime();
  const today = input.nudgesToday.map((d) => d.getTime()).filter((t) => t >= dayStart && t <= now);
  const lastNudge = Math.max(...today.filter((t) => t >= start), Number.NEGATIVE_INFINITY);
  const thresholdMs = policy.thresholdMin * MIN;

  // The next nudge is due once activity runs past `after`: the threshold after the streak began; or
  // the threshold after the last nudge in this streak; or, when that nudge was snoozed, the end of
  // the snooze (the streak never broke, so the reminder comes back).
  let after = start + thresholdMs;
  if (Number.isFinite(lastNudge)) after = snooze !== null && snooze > lastNudge ? snooze - 1 : lastNudge + thresholdMs;
  const streak = new Date(start);
  if (last <= after) return { state: "active", streakStart: streak, activeMs, nudgeAt: new Date(after + 1) };
  if (today.length >= policy.maxPerDay) return { state: "limit", streakStart: streak, activeMs };
  return { state: "nudge", streakStart: streak, activeMs, ordinal: today.length + 1 };
}

/** "1 h 45 min", "40 min". */
export function formatActive(ms: number): string {
  const m = Math.floor(ms / MIN);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
}

export function breakMessage(activeMs: number): string {
  return `You have been working for about ${formatActive(activeMs)} without a pause. A few minutes away from the screen may help.`;
}
