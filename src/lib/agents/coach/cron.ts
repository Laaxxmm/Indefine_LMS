// Coach crons (/api/cron/firm-os/coach?job=…). Each job does nothing outside its window and writes
// every nudge through createOnce(), so a workflow that fires twice, or two runs at once, nudges once.
//
//   morning   09:00 IST, working days: a CoachEvent "board" per person whose move it is on at least
//             one open job (dedupeKey board:<user>:<istDay>), unless they turned the board off.
//
// Delivery is in-app only (the /coach page and the dashboard card). The LMS has no Teams or e-mail
// channel to staff: the work tracker's chat posts as its lead into one two-person chat and is not a
// general channel, and sending mail as a person is a client-facing send path the Firm OS forbids.
import { formatDate } from "@/lib/agents/core/format";
import { istDayKey } from "@/lib/ist";
import { DEFAULT_CALENDAR, type CoachCalendar } from "./config";
import { toRankInputs } from "./board";
import { COACH_ACTOR, COACH_JOB_SELECT, MAX_ROWS, audit, createOnce, dedupeKey, type CoachDb, type CoachJobRow } from "./db";
import { PRE_FILING_STATES, buildBoard, stepHolder, type RankOptions, type RankedBoard, type RankedItem } from "./rank";
import { isCoachWorkingTime } from "./workdays";

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

// ------------------------------------------------------------------ entry

export const COACH_JOBS = ["morning"] as const;
export type CoachJob = (typeof COACH_JOBS)[number];

export function isCoachJob(v: string | null): v is CoachJob {
  return !!v && (COACH_JOBS as readonly string[]).includes(v);
}

export async function runCoachJob(job: CoachJob, deps: CoachCronDeps): Promise<MorningSummary> {
  switch (job) {
    case "morning":
      return runMorning(deps);
  }
}
