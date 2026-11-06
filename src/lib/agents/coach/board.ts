// The morning board for one person (Phase 9 task 2): their open JobTasks where the next move is
// theirs (prepare queue: the assignee before filing; review queue: the reviewer while IN_REVIEW),
// ranked by rank.ts, each with a link to the place the work is done. Filed jobs still waiting for
// the close gate are listed separately and not ranked: the close-loop reconciler nudges those.
import type { JobTaskState } from "@prisma/client";
import { formatDate } from "@/lib/agents/core/format";
import { COACH_JOB_SELECT, MAX_ROWS, type CoachDb, type CoachJobRow } from "./db";
import {
  POST_FILING_STATES,
  PRE_FILING_STATES,
  buildBoard,
  stepHolder,
  waitingOnHolder,
  type RankInput,
  type RankOptions,
  type RankedBoard,
  type RankedItem,
} from "./rank";

export type BoardLink = { href: string; label: string };
export type LatestRun = { id: string; agent: string };

export type BoardItem = RankedItem & {
  clientName: string;
  part: "Preparer" | "Reviewer";
  internalDue: string;
  statutoryDue: string;
  link: BoardLink;
};

export type FiledItem = { id: string; title: string; period: string; fy: string; clientCode: string; state: JobTaskState; link: BoardLink };

export interface BoardView {
  mustToday: BoardItem[];
  mustTodayMore: number;
  thisWeek: BoardItem[];
  thisWeekMore: number;
  later: BoardItem[];
  /** Every ranked item, in order (the full list on /coach). */
  all: BoardItem[];
  filed: FiledItem[];
  counts: RankedBoard["counts"];
}

/** "Waiting for you" on /agents: its rows carry the Run agent button. */
export const WAITING_FOR_YOU = "/agents#waiting";

/** Where the next step on a job is done. */
export function linkFor(state: JobTaskState, run: LatestRun | null): BoardLink {
  const pack = (label: string): BoardLink => (run ? { href: `/agents/${run.agent}/runs/${run.id}`, label } : { href: "/agents", label: "Open agent runs" });
  switch (state) {
    case "ASSIGNED":
    case "IN_PREP":
      return { href: WAITING_FOR_YOU, label: "Open in Waiting for you" };
    case "AGENT_DONE":
      return pack("Open pack to submit");
    case "IN_REVIEW":
      return pack("Review pack");
    case "APPROVED":
      return pack("Open pack to file");
    default:
      return pack("Open pack to close");
  }
}

/** The person's ranked inputs: rows where the next move is theirs. */
export function toRankInputs(rows: readonly CoachJobRow[], userId: string): RankInput[] {
  const out: RankInput[] = [];
  for (const r of rows) {
    const holder = stepHolder(r);
    if (!holder || holder.userId !== userId) continue;
    out.push({
      id: r.id,
      title: r.title,
      service: r.service,
      state: r.state,
      clientCode: r.firmClient.clientCode,
      period: r.period,
      fy: r.fy,
      internalDueOn: r.internalDueOn,
      statutoryDueOn: r.statutoryDueOn,
      role: holder.role,
      waitingOnMe: waitingOnHolder(r),
    });
  }
  return out;
}

async function latestRuns(db: Pick<CoachDb, "agentRun">, jobIds: string[]): Promise<Map<string, LatestRun>> {
  if (jobIds.length === 0) return new Map();
  const runs = await db.agentRun.findMany({
    where: { jobTaskId: { in: jobIds } },
    orderBy: { startedAt: "desc" },
    select: { id: true, agent: true, jobTaskId: true },
    take: MAX_ROWS,
  });
  const m = new Map<string, LatestRun>();
  for (const r of runs) if (!m.has(r.jobTaskId)) m.set(r.jobTaskId, { id: r.id, agent: r.agent });
  return m;
}

/** Open jobs the person prepares or reviews (before and just after filing). */
export async function loadMyJobs(db: Pick<CoachDb, "jobTask">, userId: string): Promise<CoachJobRow[]> {
  return db.jobTask.findMany({
    where: { state: { in: [...PRE_FILING_STATES, ...POST_FILING_STATES] }, OR: [{ assigneeId: userId }, { reviewerId: userId }] },
    select: COACH_JOB_SELECT,
    orderBy: { id: "asc" },
    take: MAX_ROWS,
  });
}

export async function loadBoard(db: Pick<CoachDb, "jobTask" | "agentRun">, userId: string, now: Date, opts?: Partial<RankOptions>): Promise<BoardView> {
  const rows = await loadMyJobs(db, userId);
  const filedRows = rows.filter((r) => (POST_FILING_STATES as readonly JobTaskState[]).includes(r.state) && r.assigneeId === userId);
  const board = buildBoard(toRankInputs(rows, userId), now, opts);
  const runs = await latestRuns(db, [...board.all.map((r) => r.id), ...filedRows.map((r) => r.id)]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const view = (r: RankedItem): BoardItem => ({
    ...r,
    clientName: byId.get(r.id)?.firmClient.client?.name ?? "",
    part: r.role === "review" ? "Reviewer" : "Preparer",
    internalDue: r.internalDueOn ? formatDate(r.internalDueOn) : "—",
    statutoryDue: r.statutoryDueOn ? formatDate(r.statutoryDueOn) : "—",
    link: linkFor(r.state, runs.get(r.id) ?? null),
  });
  return {
    mustToday: board.mustToday.map(view),
    mustTodayMore: board.mustTodayMore,
    thisWeek: board.thisWeek.map(view),
    thisWeekMore: board.thisWeekMore,
    later: board.later.map(view),
    all: board.all.map(view),
    filed: filedRows.map((r) => ({
      id: r.id,
      title: r.title,
      period: r.period,
      fy: r.fy,
      clientCode: r.firmClient.clientCode,
      state: r.state,
      link: linkFor(r.state, runs.get(r.id) ?? null),
    })),
    counts: board.counts,
  };
}

/** True when the person has any open Firm OS job (the dashboard card shows only then). */
export const hasOpenJobs = (b: BoardView) => b.all.length > 0 || b.filed.length > 0;
