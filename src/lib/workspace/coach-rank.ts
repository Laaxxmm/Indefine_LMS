// The Daily Coach ranking (src/lib/agents/coach/rank.ts) plugged into the next-task `rank` seam
// (src/lib/workspace/next-task.ts RankFn), so /focus, the companion side panel and "My day" put
// jobs in the same order: statutory overdue, then internal overdue, then the coach's score
// (nearness of both due dates in working days, client priority, people waiting, penalty risk).
// Pure apart from reading FIRM_OS_HOLIDAYS for the calendar, exactly as the coach board does.
import { calendarFromEnv } from "@/lib/agents/coach/config";
import { rankJobs, waitingOnHolder, type RankInput, type RankOptions, type RankedItem } from "@/lib/agents/coach/rank";
import type { NextTaskCandidate, RankFn } from "./next-task";

/** A next-task candidate as the coach sees it (the board's toRankInputs, from the candidate's fields). */
export function toRankInput(c: NextTaskCandidate): RankInput {
  return {
    id: c.id,
    title: c.title,
    service: c.service,
    state: c.state,
    clientCode: c.clientCode,
    period: c.period,
    fy: c.fy,
    internalDueOn: c.internalDueOn,
    statutoryDueOn: c.statutoryDueOn,
    role: c.action.kind === "review" ? "review" : "prepare",
    waitingOnMe: waitingOnHolder(c),
  };
}

/** Why the first job is first, in one plain sentence. */
export function coachReason(item: Pick<RankedItem, "overdue">): string {
  if (item.overdue === "statutory") return "It comes first because its statutory due date has passed.";
  if (item.overdue === "internal") return "It comes first because its internal due date has passed.";
  return "It comes first on your board: its due dates are nearest once client priority and penalty risk are weighed in.";
}

/** The coach ranking as a RankFn; `opts` as for rankJobs (the firm calendar by default). */
export function coachRankWith(opts?: Partial<RankOptions>): RankFn {
  return (candidates, now) => {
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const ranked = rankJobs(candidates.map(toRankInput), now, opts ?? { calendar: calendarFromEnv() });
    return ranked.map((item, i) => ({ candidate: byId.get(item.id)!, reason: i === 0 && ranked.length > 1 ? coachReason(item) : null }));
  };
}

/** The default next-task ranking: the coach's, on the firm calendar (weekends + FIRM_OS_HOLIDAYS). */
export const coachRank: RankFn = (candidates, now) => coachRankWith()(candidates, now);
