// Daily coach policy as data (Phase 9). Pure constants a partner can tune; nothing here reads the
// database or the clock. Every number below is a relative weight or a firm convention, not law.
//
//   ranking      score = proximity × client priority × blocking-others × penalty risk
//   reminders    internal due is a date; the coach treats it as due at 18:00 IST that day
//   breaks       > 100 min of continuous activity without a 10-min gap → one gentle nudge (≤ 3 a day)
import type { FirmService } from "@prisma/client";

export type DueTime = { hour: number; minute: number };

export type CoachCalendar = {
  /** Non-working weekdays (0 = Sunday … 6 = Saturday). Same default as the statutory calendar engine. */
  weekendDays: readonly number[];
  /** Firm holidays as IST day keys "YYYY-MM-DD". */
  holidays: readonly string[];
};

/**
 * Holidays. The LMS has no holiday table or calendar feed (grep "holiday": only the statutory
 * calendar engine's `isHoliday` hook, which nothing fills), so the default is empty. The
 * FIRM_OS_HOLIDAYS environment variable (comma-separated "YYYY-MM-DD") adds days without a deploy.
 */
export const FIRM_HOLIDAYS: readonly string[] = [];

export const DEFAULT_CALENDAR: CoachCalendar = { weekendDays: [0, 6], holidays: FIRM_HOLIDAYS };

/** The coach's working window in IST minutes after midnight: crons do nothing outside it. */
export const WORK_WINDOW = { startMin: 9 * 60, endMin: 19 * 60 } as const;

/** Internal due dates carry no time; the coach treats them as due at this IST wall time. */
export const INTERNAL_DUE_TIME: DueTime = { hour: 18, minute: 0 };

/** Reminder slots before the internal due moment, in minutes (T−2h, T−30m). */
export const REMINDER_OFFSETS_MIN: readonly number[] = [120, 30];

export type RankWeights = {
  /** Statutory proximity counts double the internal one: law, not the firm, sets that date. */
  statutory: number;
  internal: number;
  /** Proximity for a job with neither date, so it still lists (last). */
  noDue: number;
  /** Added to the blocking factor for each other person whose next step waits on this one. */
  blockingPerPerson: number;
  priorityMin: number;
  priorityMax: number;
};

export const RANK_WEIGHTS: RankWeights = { statutory: 2, internal: 1, noDue: 0.05, blockingPerPerson: 0.5, priorityMin: 0.5, priorityMax: 3 };

/**
 * Relative late-fee / interest exposure per service (applied only when the job has a statutory due
 * date). Ordering, not amounts: GST and TDS carry a per-day late fee plus monthly interest; ROC
 * additional fees accrue per day per form; income-tax late fee and s.234A interest; tax audit
 * penalty; Books and Engagement have no statutory penalty of their own. Partner to tune.
 */
export const PENALTY_RISK: Readonly<Record<FirmService, number>> = {
  GST: 1.5,
  TDS: 1.5,
  ROC: 1.4,
  IncomeTax: 1.3,
  Audit: 1.2,
  Books: 1,
  Engagement: 1,
};

/**
 * Client priority by client code. Neither Client nor FirmClient has a priority field, so this is a
 * data hook with an empty default: every client counts 1 until a partner lists exceptions here.
 */
export const CLIENT_PRIORITY: Readonly<Record<string, number>> = {};

export const BOARD = {
  /** Items shown per section ("Must today", "This week"). */
  size: 5,
  /** "This week" = due within this many working days. */
  weekWorkingDays: 5,
  /** A statutory due this many working days away (or fewer) is "Must today": file with margin. */
  statutoryMustTodayDays: 1,
} as const;

export type BreakPolicy = {
  /** Nudge when continuous activity exceeds this many minutes. */
  thresholdMin: number;
  /** A gap of at least this many minutes between heartbeats is a break. */
  gapMin: number;
  maxPerDay: number;
  snoozeOptionsMin: readonly number[];
  /** The server stores at most one heartbeat per person in this many seconds. */
  heartbeatMinIntervalSec: number;
  /** How far back the coach reads heartbeats. Must stay within the 7-day retention (ADR-006). */
  lookbackHours: number;
  retentionDays: number;
  /** A nudge stays on screen (until dismissed) for this long after it was raised. */
  showForMin: number;
};

export const BREAK_POLICY: BreakPolicy = {
  thresholdMin: 100,
  gapMin: 10,
  maxPerDay: 3,
  snoozeOptionsMin: [30, 60],
  heartbeatMinIntervalSec: 60,
  lookbackHours: 12,
  retentionDays: 7,
  showForMin: 20,
};

/** Weekly summary: Friday (IST weekday 5) from 16:00 IST. */
export const SUMMARY_SCHEDULE = { weekday: 5, fromMin: 16 * 60 } as const;

/** How long reminders and escalations stay listed on /coach until dismissed. */
export const NOTICE_DAYS = 7;

/** Calendar with FIRM_OS_HOLIDAYS added. Malformed entries are ignored. */
export function calendarFromEnv(env: Record<string, string | undefined> = process.env, base: CoachCalendar = DEFAULT_CALENDAR): CoachCalendar {
  const extra = (env.FIRM_OS_HOLIDAYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  return extra.length ? { ...base, holidays: [...new Set([...base.holidays, ...extra])].sort() } : base;
}
