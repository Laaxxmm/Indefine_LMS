// Coach crons (/api/cron/firm-os/coach?job=…). Each job does nothing outside its window and writes
// every nudge through createOnce(), so a workflow that fires twice, or two runs at once, nudges once.
//
//   morning   09:00 IST, working days: a CoachEvent "board" per person whose move it is on at least
//             one open job (dedupeKey board:<user>:<istDay>), unless they turned the board off.
//   reminders every 30 min, working time: T−2h / T−30m "reminder" before the internal due moment
//             (dedupeKey reminder:<job>:<user>:<slot>); once overdue, one "escalation" per job per
//             day (dedupeKey escalation:<job>:<istDay>). Jobs before filing only (reminders.ts).
//   summary   Friday 16:00 IST: a weekly cycle-time "summary" per person (dedupeKey
//             summary:<user>:<weekOf>), readable by the person and their manager only.
//
// Delivery is in-app only (the /coach page and the dashboard card). The LMS has no Teams or e-mail
// channel to staff: the work tracker's chat posts as its lead into one two-person chat and is not a
// general channel, and sending mail as a person is a client-facing send path the Firm OS forbids.
import { formatDate } from "@/lib/agents/core/format";
import { addDays, istDayKey, istDayStart, istWeekStart, istWeekday } from "@/lib/ist";
import { DEFAULT_CALENDAR, SUMMARY_SCHEDULE, type CoachCalendar } from "./config";
import { toRankInputs } from "./board";
import { COACH_ACTOR, COACH_JOB_SELECT, MAX_ROWS, audit, createOnce, dedupeKey, jobLabel, type CoachDb, type CoachJobRow } from "./db";
import { POST_FILING_STATES, PRE_FILING_STATES, buildBoard, stepHolder, type RankOptions, type RankedBoard, type RankedItem } from "./rank";
import { dueReminderSlot, escalationMessage, escalationTarget, isInternalOverdue, reminderMessage } from "./reminders";
import { weeklySummary } from "./summary";
import { isCoachWorkingTime, istMinutes } from "./workdays";

export type CoachCronDeps = {
  db: CoachDb;
  now?: () => Date;
  calendar?: CoachCalendar;
  rank?: Partial<RankOptions>;
};

export const DELIVERY_CHANNEL = "in-app" as const;

function setup(deps: CoachCronDeps) {
  const now = deps.now?.() ?? new Date();
  const calendar = deps.calendar ?? DEFAULT_CALENDAR;
  return { now, calendar, rank: { ...deps.rank, calendar } };
}

/** Open jobs before filing, oldest id first. */
async function preFilingJobs(db: Pick<CoachDb, "jobTask">, extra: object = {}): Promise<CoachJobRow[]> {
  return db.jobTask.findMany({
    where: { state: { in: [...PRE_FILING_STATES] }, ...extra },
    select: COACH_JOB_SELECT,
    orderBy: { id: "asc" },
    take: MAX_ROWS,
  });
}

async function activeUsers(db: Pick<CoachDb, "user">, ids: string[]): Promise<Map<string, { id: string; name: string | null; managerId: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: ids }, active: true }, select: { id: true, name: true, managerId: true } });
  return new Map(rows.map((u) => [u.id, u]));
}

// ------------------------------------------------------------------ morning board

const item = (r: RankedItem) => ({ jobTaskId: r.id, title: r.title, clientCode: r.clientCode, period: r.period, state: r.state, reason: r.reason });

export function boardMessage(b: RankedBoard, dayKey: string): string {
  const when = formatDate(dayKey);
  if (b.counts.mustToday === 0 && b.counts.thisWeek === 0) {
    return `Your board for ${when}: nothing due this week. ${b.counts.open} open job${b.counts.open === 1 ? "" : "s"}.`;
  }
  const overdue = b.counts.overdue ? ` (${b.counts.overdue} past due)` : "";
  return `Your board for ${when}: ${b.counts.mustToday} must today${overdue}, ${b.counts.thisWeek} this week.`;
}

export function boardPayload(b: RankedBoard, dayKey: string) {
  return {
    day: dayKey,
    channel: DELIVERY_CHANNEL,
    counts: b.counts,
    mustToday: b.mustToday.map(item),
    thisWeek: b.thisWeek.map(item),
    message: boardMessage(b, dayKey),
  };
}

export interface MorningSummary {
  at: string;
  skipped?: "outside-working-time";
  people: number;
  created: number;
  existing: number;
  boardOff: number;
  channel: typeof DELIVERY_CHANNEL;
}

export async function runMorning(deps: CoachCronDeps): Promise<MorningSummary> {
  const { now, calendar, rank } = setup(deps);
  const s: MorningSummary = { at: now.toISOString(), people: 0, created: 0, existing: 0, boardOff: 0, channel: DELIVERY_CHANNEL };
  if (!isCoachWorkingTime(now, calendar)) return { ...s, skipped: "outside-working-time" };

  const rows = await preFilingJobs(deps.db);
  const holders = [...new Set(rows.map((r) => stepHolder(r)?.userId).filter((x): x is string => !!x))].sort();
  const users = await activeUsers(deps.db, holders);
  const ids = holders.filter((id) => users.has(id));
  const prefs = ids.length
    ? await deps.db.coachPreference.findMany({ where: { userId: { in: ids } }, select: { userId: true, morningBoard: true } })
    : [];
  const off = new Set(prefs.filter((p) => !p.morningBoard).map((p) => p.userId));
  const day = istDayKey(now);

  for (const userId of ids) {
    s.people += 1;
    if (off.has(userId)) {
      s.boardOff += 1;
      continue;
    }
    const board = buildBoard(toRankInputs(rows, userId), now, rank);
    const created = await createOnce(deps.db, { userId, kind: "board", dedupeKey: dedupeKey.board(userId, day), payload: boardPayload(board, day) });
    if (created) s.created += 1;
    else s.existing += 1;
  }
  if (s.created > 0) await audit(deps.db, { actorId: COACH_ACTOR, action: "coach-board", entity: "CoachEvent", meta: { day, created: s.created } });
  return s;
}

// ------------------------------------------------------------------ reminders + escalation

export interface ReminderRunSummary {
  at: string;
  skipped?: "outside-working-time";
  checked: number;
  reminders: number;
  escalations: number;
  /** Overdue jobs with nobody to escalate to (no reviewer, holder has no manager). */
  unescalated: string[];
}

/**
 * Every 30 minutes in working time: T−2h / T−30m reminders to whoever holds the next step on jobs
 * before filing, and one escalation per overdue job per IST day. Reason "internal-due" /
 * "internal-overdue" in the payload; the close-loop reconciler's are "close-loop" / "done-recheck".
 */
export async function runReminders(deps: CoachCronDeps): Promise<ReminderRunSummary> {
  const { now, calendar } = setup(deps);
  const s: ReminderRunSummary = { at: now.toISOString(), checked: 0, reminders: 0, escalations: 0, unescalated: [] };
  if (!isCoachWorkingTime(now, calendar)) return { ...s, skipped: "outside-working-time" };

  // Due dates up to a week ahead can roll back onto today (weekend, holiday); everything earlier is overdue.
  const rows = await preFilingJobs(deps.db, { internalDueOn: { not: null, lt: addDays(istDayStart(now), 8) } });
  const ids = new Set<string>();
  for (const r of rows) {
    const h = stepHolder(r)?.userId;
    if (h) ids.add(h);
    for (const id of [r.reviewerId, r.engagement?.reviewerId]) if (id) ids.add(id);
  }
  const users = await activeUsers(deps.db, [...ids].sort());
  const managerIds = [...new Set([...users.values()].map((u) => u.managerId).filter((x): x is string => !!x && !users.has(x)))];
  for (const [id, u] of await activeUsers(deps.db, managerIds)) users.set(id, u);
  const managerOf = (id: string) => users.get(id)?.managerId ?? null;
  const day = istDayKey(now);
  const opts = { calendar };

  for (const r of rows) {
    if (!r.internalDueOn) continue;
    s.checked += 1;
    const holder = stepHolder(r);
    const label = jobLabel(r);
    if (!isInternalOverdue(r.internalDueOn, now, opts)) {
      const slot = dueReminderSlot(r.internalDueOn, now, opts);
      if (!slot || !holder || !users.has(holder.userId)) continue;
      const payload = { reason: "internal-due", slot: slot.label, dueAt: slot.dueAt.toISOString(), state: r.state, message: reminderMessage(label, slot) };
      const created = await createOnce(deps.db, {
        userId: holder.userId,
        kind: "reminder",
        jobTaskId: r.id,
        dedupeKey: dedupeKey.reminder(r.id, holder.userId, slot.key),
        payload,
      });
      if (created) s.reminders += 1;
      continue;
    }
    const to = escalationTarget(r, holder?.userId ?? null, managerOf, (id) => users.has(id));
    if (!to) {
      s.unescalated.push(r.id);
      continue;
    }
    const holderName = holder ? users.get(holder.userId)?.name ?? null : null;
    const payload = {
      reason: "internal-overdue",
      state: r.state,
      holderId: holder?.userId ?? null,
      internalDueOn: r.internalDueOn.toISOString(),
      message: escalationMessage(label, r.internalDueOn, r.state, holderName),
    };
    const created = await createOnce(deps.db, { userId: to, kind: "escalation", jobTaskId: r.id, dedupeKey: dedupeKey.escalation(r.id, day), payload });
    if (!created) continue;
    s.escalations += 1;
    await audit(deps.db, { actorId: COACH_ACTOR, action: "escalate", entity: "JobTask", entityId: r.id, meta: { to, reason: "internal-overdue", day } });
  }
  return s;
}

// ------------------------------------------------------------------ weekly summary

export interface SummaryRunSummary {
  at: string;
  skipped?: "not-friday-afternoon";
  weekOf: string;
  people: number;
  created: number;
  existing: number;
}

/** Friday from 16:00 IST (a manual run at any other time does nothing). */
export function isSummaryTime(now: Date): boolean {
  return istWeekday(now) === SUMMARY_SCHEDULE.weekday && istMinutes(now) >= SUMMARY_SCHEDULE.fromMin;
}

/**
 * Friday 16:00 IST: one CoachEvent "summary" per person with jobs this week (done, open or past due)
 * — dedupeKey summary:<user>:<weekOf>. The event is the person's; their manager may read it
 * (access.ts), nobody else.
 */
export async function runWeeklySummary(deps: CoachCronDeps): Promise<SummaryRunSummary> {
  const { now, calendar } = setup(deps);
  const weekStart = istWeekStart(now);
  const weekOf = istDayKey(weekStart);
  const s: SummaryRunSummary = { at: now.toISOString(), weekOf, people: 0, created: 0, existing: 0 };
  if (!isSummaryTime(now)) return { ...s, skipped: "not-friday-afternoon" };

  const done = await deps.db.jobTask.findMany({
    where: { state: "DONE", doneAt: { gte: weekStart, lte: now } },
    select: { id: true, assigneeId: true, events: { select: { fromState: true, toState: true, createdAt: true, note: true }, orderBy: { createdAt: "asc" } } },
    orderBy: { id: "asc" },
    take: MAX_ROWS,
  });
  const open = await deps.db.jobTask.findMany({
    where: { state: { in: [...PRE_FILING_STATES, ...POST_FILING_STATES] } },
    select: { id: true, state: true, assigneeId: true, internalDueOn: true },
    orderBy: { id: "asc" },
    take: MAX_ROWS,
  });
  const people = [...new Set([...done, ...open].map((j) => j.assigneeId).filter((x): x is string => !!x))].sort();
  const users = await activeUsers(deps.db, people);

  for (const userId of people.filter((id) => users.has(id))) {
    s.people += 1;
    const mine = open.filter((j) => j.assigneeId === userId);
    const overdue = mine.filter(
      (j) => (PRE_FILING_STATES as readonly string[]).includes(j.state) && j.internalDueOn && isInternalOverdue(j.internalDueOn, now, { calendar }),
    ).length;
    const summary = weeklySummary({ weekStart, done: done.filter((j) => j.assigneeId === userId), open: mine.length, overdue });
    const created = await createOnce(deps.db, { userId, kind: "summary", dedupeKey: dedupeKey.summary(userId, weekOf), payload: summary });
    if (created) s.created += 1;
    else s.existing += 1;
  }
  if (s.created > 0) await audit(deps.db, { actorId: COACH_ACTOR, action: "coach-summary", entity: "CoachEvent", meta: { weekOf, created: s.created } });
  return s;
}

// ------------------------------------------------------------------ entry

export const COACH_JOBS = ["morning", "reminders", "summary"] as const;
export type CoachJob = (typeof COACH_JOBS)[number];

export function isCoachJob(v: string | null): v is CoachJob {
  return !!v && (COACH_JOBS as readonly string[]).includes(v);
}

export async function runCoachJob(job: CoachJob, deps: CoachCronDeps): Promise<MorningSummary | ReminderRunSummary | SummaryRunSummary> {
  switch (job) {
    case "morning":
      return runMorning(deps);
    case "reminders":
      return runReminders(deps);
    case "summary":
      return runWeeklySummary(deps);
  }
}
