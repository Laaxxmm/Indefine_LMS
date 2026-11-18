// Morning-board ranking (Phase 9 task 1). Pure: no Prisma, no clock (now is an argument).
//
//   score = proximity × client priority × blocking-others × penalty risk
//
//   proximity      2 × f(statutory working days left) + 1 × f(internal working days left),
//                  f(d) = 1 / (1 + max(d, 0)); a missing date adds 0; neither date → 0.05
//   client priority  CLIENT_PRIORITY[clientCode] (or the row's own value), default 1, clamped 0.5–3
//   blocking-others  1 + 0.5 × (other people whose next step waits on this one, e.g. the preparer
//                  waiting on a review)
//   penalty risk   PENALTY_RISK[service] when the job has a statutory due date, else 1
//
// Order: statutory overdue, then internal overdue, then everything else; inside each tier the
// higher score first; ties by statutory due (earlier first, none last), client code, then id.
// Working days skip weekend days and firm holidays (config.ts).
import type { FirmService, JobTaskState } from "@prisma/client";
import { formatDate } from "@/lib/agents/core/format";
import { istDayKey } from "@/lib/ist";
import {
  BOARD,
  CLIENT_PRIORITY,
  DEFAULT_CALENDAR,
  INTERNAL_DUE_TIME,
  PENALTY_RISK,
  RANK_WEIGHTS,
  type CoachCalendar,
  type DueTime,
  type RankWeights,
} from "./config";
import { internalDueMoment, workingDaysBetween } from "./workdays";

/** States before filing: the coach ranks and reminds on these. After filing the close loop takes over. */
export const PRE_FILING_STATES = ["ASSIGNED", "IN_PREP", "AGENT_DONE", "IN_REVIEW", "APPROVED"] as const satisfies readonly JobTaskState[];
/** Filed, waiting for the close gate (Final file + Turia close): the close-loop reconciler nudges these. */
export const POST_FILING_STATES = ["FILED_BY_HUMAN", "CLOSING"] as const satisfies readonly JobTaskState[];

export type BoardRole = "prepare" | "review";

/** Whose move it is: the reviewer while IN_REVIEW, otherwise the assignee. Null when nobody holds it. */
export function stepHolder(job: { state: JobTaskState; assigneeId: string | null; reviewerId: string | null }): { userId: string; role: BoardRole } | null {
  if (job.state === "IN_REVIEW") return job.reviewerId ? { userId: job.reviewerId, role: "review" } : null;
  if ((PRE_FILING_STATES as readonly JobTaskState[]).includes(job.state)) return job.assigneeId ? { userId: job.assigneeId, role: "prepare" } : null;
  return null;
}

/** Other people held up by this step: the preparer while their pack waits on someone else's review. */
export function waitingOnHolder(job: { state: JobTaskState; assigneeId: string | null; reviewerId: string | null }): number {
  return job.state === "IN_REVIEW" && job.assigneeId && job.assigneeId !== job.reviewerId ? 1 : 0;
}

export interface RankInput {
  id: string;
  title: string;
  service: FirmService;
  state: JobTaskState;
  clientCode: string;
  period: string;
  fy: string;
  internalDueOn: Date | null;
  statutoryDueOn: Date | null;
  role: BoardRole;
  /** People other than this person whose next step waits on this one. */
  waitingOnMe: number;
  /** Overrides CLIENT_PRIORITY for this row when given. */
  clientPriority?: number | null;
}

export type Tier = 0 | 1 | 2;
export type Bucket = "must-today" | "this-week" | "later";

export interface RankedItem extends RankInput {
  score: number;
  tier: Tier;
  overdue: "statutory" | "internal" | null;
  internalDaysLeft: number | null;
  statutoryDaysLeft: number | null;
  factors: { proximity: number; priority: number; blocking: number; penalty: number };
  bucket: Bucket;
  /** Plain-language reason for the position, e.g. "Statutory due 06 Nov 2026 (next working day)". */
  reason: string;
}

export interface RankOptions {
  calendar: CoachCalendar;
  weights: RankWeights;
  penaltyRisk: Readonly<Record<string, number>>;
  clientPriority: Readonly<Record<string, number>>;
  dueTime: DueTime;
  boardSize: number;
  weekWorkingDays: number;
  statutoryMustTodayDays: number;
}

export const DEFAULT_RANK_OPTIONS: RankOptions = {
  calendar: DEFAULT_CALENDAR,
  weights: RANK_WEIGHTS,
  penaltyRisk: PENALTY_RISK,
  clientPriority: CLIENT_PRIORITY,
  dueTime: INTERNAL_DUE_TIME,
  boardSize: BOARD.size,
  weekWorkingDays: BOARD.weekWorkingDays,
  statutoryMustTodayDays: BOARD.statutoryMustTodayDays,
};

const opts = (o?: Partial<RankOptions>): RankOptions => ({ ...DEFAULT_RANK_OPTIONS, ...o });

/** 1 / (1 + days left), 1 at or past the due day, 0 without a date. */
export function proximityFactor(daysLeft: number | null): number {
  return daysLeft === null ? 0 : 1 / (1 + Math.max(0, daysLeft));
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function reasonOf(r: Omit<RankedItem, "reason" | "bucket">, bucket: Bucket): string {
  const stat = r.statutoryDueOn ? formatDate(r.statutoryDueOn) : null;
  const int = r.internalDueOn ? formatDate(r.internalDueOn) : null;
  if (r.overdue === "statutory") return `Statutory due ${stat} has passed`;
  if (r.overdue === "internal") return `Internal due ${int} has passed`;
  if (bucket === "must-today" && r.internalDaysLeft !== null && r.internalDaysLeft <= 0) return "Internal due today";
  if (stat && r.statutoryDaysLeft !== null && bucket !== "later" && (r.internalDaysLeft === null || r.statutoryDaysLeft <= r.internalDaysLeft)) {
    const when = r.statutoryDaysLeft <= 0 ? " (today)" : r.statutoryDaysLeft === 1 ? " (next working day)" : "";
    return `Statutory due ${stat}${when}`;
  }
  if (int) return `Internal due ${int}`;
  if (stat) return `Statutory due ${stat}`;
  return "No due date set";
}

/** Score, tier and bucket for one job, seen at `now`. */
export function scoreJob(input: RankInput, now: Date, o?: Partial<RankOptions>): RankedItem {
  const p = opts(o);
  const today = istDayKey(now);
  const internalDaysLeft = input.internalDueOn ? workingDaysBetween(today, istDayKey(input.internalDueOn), p.calendar) : null;
  const statutoryDaysLeft = input.statutoryDueOn ? workingDaysBetween(today, istDayKey(input.statutoryDueOn), p.calendar) : null;

  const statutoryOverdue = !!input.statutoryDueOn && istDayKey(input.statutoryDueOn) < today;
  const internalOverdue = !!input.internalDueOn && now.getTime() >= internalDueMoment(input.internalDueOn, p.calendar, p.dueTime).getTime();
  const overdue = statutoryOverdue ? "statutory" : internalOverdue ? "internal" : null;
  const tier: Tier = statutoryOverdue ? 0 : internalOverdue ? 1 : 2;

  const w = p.weights;
  const proximity =
    internalDaysLeft === null && statutoryDaysLeft === null
      ? w.noDue
      : w.statutory * proximityFactor(statutoryDaysLeft) + w.internal * proximityFactor(internalDaysLeft);
  const priority = clamp(input.clientPriority ?? p.clientPriority[input.clientCode] ?? 1, w.priorityMin, w.priorityMax);
  const blocking = 1 + w.blockingPerPerson * Math.max(0, input.waitingOnMe);
  const penalty = input.statutoryDueOn ? p.penaltyRisk[input.service] ?? 1 : 1;
  const score = proximity * priority * blocking * penalty;

  const mustToday =
    tier < 2 ||
    (internalDaysLeft !== null && internalDaysLeft <= 0) ||
    (statutoryDaysLeft !== null && statutoryDaysLeft <= p.statutoryMustTodayDays);
  const thisWeek =
    (internalDaysLeft !== null && internalDaysLeft <= p.weekWorkingDays) || (statutoryDaysLeft !== null && statutoryDaysLeft <= p.weekWorkingDays);
  const bucket: Bucket = mustToday ? "must-today" : thisWeek ? "this-week" : "later";

  const base = { ...input, score, tier, overdue, internalDaysLeft, statutoryDaysLeft, factors: { proximity, priority, blocking, penalty } } as const;
  return { ...base, bucket, reason: reasonOf(base, bucket) };
}

const dueMs = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);

/** Tier, then score (higher first), then statutory due (earlier first, none last), client code, id. */
export function compareRanked(a: RankedItem, b: RankedItem): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.score !== b.score) return b.score - a.score;
  const da = dueMs(a.statutoryDueOn);
  const db = dueMs(b.statutoryDueOn);
  if (da !== db) return da < db ? -1 : 1;
  if (a.clientCode !== b.clientCode) return a.clientCode < b.clientCode ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function rankJobs(inputs: readonly RankInput[], now: Date, o?: Partial<RankOptions>): RankedItem[] {
  return inputs.map((i) => scoreJob(i, now, o)).sort(compareRanked);
}

export interface RankedBoard {
  /** Top N "Must today" (overdue first). */
  mustToday: RankedItem[];
  /** "Must today" items beyond the top N. */
  mustTodayMore: number;
  /** Top N due within the week (not already "Must today"). */
  thisWeek: RankedItem[];
  thisWeekMore: number;
  /** Everything else (due later or no date), ranked. */
  later: RankedItem[];
  /** Every item, ranked. */
  all: RankedItem[];
  counts: { open: number; overdue: number; mustToday: number; thisWeek: number };
}

export function buildBoard(inputs: readonly RankInput[], now: Date, o?: Partial<RankOptions>): RankedBoard {
  const p = opts(o);
  const all = rankJobs(inputs, now, p);
  const must = all.filter((r) => r.bucket === "must-today");
  const week = all.filter((r) => r.bucket === "this-week");
  return {
    mustToday: must.slice(0, p.boardSize),
    mustTodayMore: Math.max(0, must.length - p.boardSize),
    thisWeek: week.slice(0, p.boardSize),
    thisWeekMore: Math.max(0, week.length - p.boardSize),
    later: all.filter((r) => r.bucket === "later"),
    all,
    counts: { open: all.length, overdue: all.filter((r) => r.overdue).length, mustToday: must.length, thisWeek: week.length },
  };
}
