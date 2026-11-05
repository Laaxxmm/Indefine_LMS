// Cycle time (Phase 8 task 2/5): pure functions over the append-only JobTaskEvent history.
// No Prisma, no clock. cycleTimes() splits one job's life into stages; summariseCycleTimes()
// gives median / p90 per service, person and client and the bottleneck stage.
//
// Stages (every interval between two events belongs to exactly one, so they add up):
//   queue         ASSIGNED                  assigned, preparation not started
//   prep          IN_PREP, AGENT_DONE       preparing (agent or by hand) until sent for review
//   review        IN_REVIEW                 until approved (or sent back)
//   filing        APPROVED                  approved, waiting for a person to file on the portal
//   filingToDone  FILED_BY_HUMAN, CLOSING   filed, until the close gate passes (Final file + Turia)
//   waitOnClient  any state entered by an event whose note says "waiting on client" (or
//                 "waiting for client"), e.g. a reviewer's request-changes note; that interval is
//                 counted here and not in the state's own stage.
// assignedToDone = first entry into ASSIGNED (or the first event, if the job was created
// already assigned) → the DONE event. DRAFT time is not counted.
import type { JobTaskState } from "@prisma/client";
import { addDays, istDayKey, istDayStart, parseDayKey } from "@/lib/ist";
import { formatDayKey as formatDayKeyStrict } from "@/lib/agents/core/format";

export const STAGES = ["queue", "prep", "review", "waitOnClient", "filing", "filingToDone"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  queue: "Waiting to start",
  prep: "Preparation",
  review: "Review",
  waitOnClient: "Waiting on client",
  filing: "Approved to filed",
  filingToDone: "Filed to done",
};

export const WAITING_ON_CLIENT_RE = /\bwait(?:ing)?\s*(?:on|for)\s+(?:the\s+)?client\b/i;

const STATE_STAGE: Partial<Record<JobTaskState, Stage>> = {
  ASSIGNED: "queue",
  IN_PREP: "prep",
  AGENT_DONE: "prep",
  IN_REVIEW: "review",
  APPROVED: "filing",
  FILED_BY_HUMAN: "filingToDone",
  CLOSING: "filingToDone",
};

export interface CycleEvent {
  fromState: JobTaskState | null;
  toState: JobTaskState;
  createdAt: Date;
  note?: string | null;
}

export interface CycleTimes {
  /** ms from assignment to DONE; null until the job is DONE. */
  assignedToDone: number | null;
  queue: number;
  prep: number;
  review: number;
  waitOnClient: number;
  filing: number;
  filingToDone: number;
  done: boolean;
}

/**
 * Stage durations (ms) for one job. Events may arrive in any order; ties keep input order.
 * For a job that is not DONE, the open interval runs to `until` (default: the last event, i.e. 0).
 */
export function cycleTimes(events: readonly CycleEvent[], until?: Date): CycleTimes {
  const evs = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.createdAt.getTime() - b.e.createdAt.getTime() || a.i - b.i).map((x) => x.e);
  const out: CycleTimes = { assignedToDone: null, queue: 0, prep: 0, review: 0, waitOnClient: 0, filing: 0, filingToDone: 0, done: false };
  let doneAt: Date | null = null;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (e.toState === "DONE") {
      doneAt = e.createdAt;
      break;
    }
    const end = evs[i + 1]?.createdAt ?? until ?? e.createdAt;
    const ms = Math.max(0, end.getTime() - e.createdAt.getTime());
    const stage = STATE_STAGE[e.toState];
    if (!stage) continue;
    if (WAITING_ON_CLIENT_RE.test(e.note ?? "")) out.waitOnClient += ms;
    else out[stage] += ms;
  }
  const start = evs.find((e) => e.toState === "ASSIGNED") ?? evs.find((e) => e.toState !== "DRAFT" && e.toState !== "DONE");
  if (doneAt && start) {
    out.done = true;
    out.assignedToDone = Math.max(0, doneAt.getTime() - start.createdAt.getTime());
  }
  return out;
}

// ------------------------------------------------------------------ statistics

/** Middle value; the mean of the two middle values for an even count; null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Nearest-rank percentile (p in 0–100): the smallest value with at least p% of values at or below it. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.min(s.length, Math.max(1, Math.ceil((p / 100) * s.length)));
  return s[rank - 1];
}

export interface Bottleneck {
  stage: Stage;
  /** Median, across jobs, of this stage's share of the job's total stage time (0–1). */
  share: number;
}

/** The stage with the largest median share of each job's time; ties go to the earlier stage. */
export function bottleneck(times: readonly CycleTimes[]): Bottleneck | null {
  const rows = times.map((t) => ({ t, total: STAGES.reduce((n, s) => n + t[s], 0) })).filter((r) => r.total > 0);
  if (rows.length === 0) return null;
  let best: Bottleneck | null = null;
  for (const stage of STAGES) {
    const share = median(rows.map((r) => r.t[stage] / r.total)) ?? 0;
    if (!best || share > best.share) best = { stage, share };
  }
  return best;
}

// ------------------------------------------------------------------ grouping

export interface CycleJob {
  jobTaskId: string;
  service: string;
  assigneeId: string | null;
  assigneeName: string | null;
  clientCode: string;
  times: CycleTimes;
}

export interface GroupStats {
  key: string;
  label: string;
  jobs: number;
  medianMs: number | null;
  p90Ms: number | null;
  bottleneck: Bottleneck | null;
}

export interface StageStats {
  stage: Stage;
  label: string;
  medianMs: number | null;
  p90Ms: number | null;
}

export interface CycleSummary {
  overall: GroupStats;
  stages: StageStats[];
  byService: GroupStats[];
  byPerson: GroupStats[];
  byClient: GroupStats[];
}

function stats(key: string, label: string, jobs: CycleJob[]): GroupStats {
  const totals = jobs.map((j) => j.times.assignedToDone).filter((v): v is number => v !== null);
  return { key, label, jobs: jobs.length, medianMs: median(totals), p90Ms: percentile(totals, 90), bottleneck: bottleneck(jobs.map((j) => j.times)) };
}

function groupBy(jobs: CycleJob[], keyOf: (j: CycleJob) => string, labelOf: (j: CycleJob) => string): GroupStats[] {
  const m = new Map<string, CycleJob[]>();
  for (const j of jobs) m.set(keyOf(j), [...(m.get(keyOf(j)) ?? []), j]);
  return [...m.entries()]
    .map(([k, js]) => stats(k, labelOf(js[0]), js))
    .sort((a, b) => b.jobs - a.jobs || (b.medianMs ?? 0) - (a.medianMs ?? 0) || a.label.localeCompare(b.label));
}

/** Only DONE jobs count (an open job has no cycle time yet). */
export function summariseCycleTimes(all: readonly CycleJob[]): CycleSummary {
  const jobs = all.filter((j) => j.times.done);
  return {
    overall: stats("all", "All services", jobs),
    stages: STAGES.map((stage) => {
      const v = jobs.map((j) => j.times[stage]);
      return { stage, label: STAGE_LABELS[stage], medianMs: median(v), p90Ms: percentile(v, 90) };
    }),
    byService: groupBy(jobs, (j) => j.service, (j) => j.service),
    byPerson: groupBy(jobs, (j) => j.assigneeId ?? "unassigned", (j) => j.assigneeName ?? (j.assigneeId ? "Unknown person" : "Unassigned")),
    byClient: groupBy(jobs, (j) => j.clientCode, (j) => j.clientCode),
  };
}

// ------------------------------------------------------------------ display

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "3d 4h", "5h 20m", "45m", "under 1m"; "–" for no value. Rounded down to the minute. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return "–";
  if (ms < MIN) return "under 1m";
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MIN);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * "2026-11-05" → "05 Nov 2026" (DD MMM YYYY, IST). Fixed English month names: en-IN locale data
 * writes September as "Sept", which is not MMM.
 */
export function formatDayKey(key: string): string {
  return parseDayKey(key) ? formatDayKeyStrict(key) : key;
}

export interface CycleRange {
  from: Date;
  /** Exclusive: 00:00 IST of the day after the last day. */
  to: Date;
  fromKey: string;
  toKey: string;
}

export const DEFAULT_RANGE_DAYS = 90;
export const MAX_RANGE_DAYS = 366;

/** Inclusive IST day range of DONE dates from query strings; last 90 days by default, at most a year. */
export function parseCycleRange(fromStr: string | undefined, toStr: string | undefined, now: Date): CycleRange {
  let to = parseDayKey(toStr) ?? istDayStart(now);
  let from = parseDayKey(fromStr) ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) [from, to] = [to, from];
  if ((to.getTime() - from.getTime()) / DAY >= MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
  return { from, to: addDays(to, 1), fromKey: istDayKey(from), toKey: istDayKey(to) };
}
