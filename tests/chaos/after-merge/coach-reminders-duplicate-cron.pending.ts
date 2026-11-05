// DEPENDS ON PHASE 9 MERGE (Daily Coach reminders). Written against the orchestrator's Phase 9 brief
// before the code exists, so it is not run by `npm test` until renamed: after the merge, fix the
// ADAPTER block below to the real module / export / deps, then `git mv` this file to
// tests/chaos/coach-reminders-duplicate-cron.test.ts (docs/qa/phase-12-runbook.md "after-merge chaos").
//
// Phase 9 brief (orchestrator spec): reminders at T−2h and T−30m before the internal due time for
// tasks still open; escalation to the reviewer only if overdue, at most one escalation per task per
// day. CoachEvent.dedupeKey @unique (e.g. "reminder:<jobTaskId>:<userId>:<window>:<istDay>") makes a
// duplicate impossible even when the cron fires twice in the same second.
//
// Chaos: the coach cron fires every 5 minutes, each tick three times (two sequentially, then two at
// once). What a person must see: exactly one T−2h reminder and one T−30m reminder for an open task,
// none for a task closed in between, one escalation to the reviewer once it is overdue (per day),
// and no cron request failing because another one won the race.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { istDayKey } from "@/lib/ist";
import { coachEventTable, naturalDuplicates, readTable, type CoachEventTable } from "../support/coach-event-table";

// ------------------------------------------------------------------ ADAPTER (fix after the phase-9 merge)
// Expected: a pure-ish entry point the cron route calls, with injected db + clock. Adjust the path,
// the export name and the deps shape to what Phase 9 ships; keep the assertions below unchanged.
const COACH_MODULE = "../../../src/lib/agents/coach/reminders";
type CoachDb = { jobTask: unknown; coachEvent: CoachEventTable; coachPreference: unknown; user: unknown };
type RunReminders = (deps: { db: CoachDb; now: () => Date }) => Promise<unknown>;
async function loadRunReminders(): Promise<RunReminders> {
  const mod = (await import(/* @vite-ignore */ COACH_MODULE)) as Record<string, unknown>;
  const fn = mod.runReminders ?? mod.runCoachReminders ?? mod.sendReminders;
  if (typeof fn !== "function") throw new Error(`${COACH_MODULE}: no reminder entry point found — update the ADAPTER block`);
  return fn as RunReminders;
}
// ------------------------------------------------------------------ end ADAPTER

const MIN = 60_000;
const DUE = new Date("2026-11-05T09:30:00.000Z"); // Thu 15:00 IST internal due
const at = (minutesBeforeDue: number) => new Date(DUE.getTime() - minutesBeforeDue * MIN);

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

function world(jobState = "IN_PREP") {
  const coachEvent = coachEventTable(() => new Date());
  const jobs = [
    {
      id: "job-1", title: "GSTR-3B", period: "2026-10", service: "GST", state: jobState, assigneeId: "u-priya", reviewerId: "u-ravi",
      internalDueOn: DUE, statutoryDueOn: new Date("2026-11-20T00:00:00+05:30"), firmClientId: "fc-1", firmClient: { clientCode: "ACME01" },
    },
  ];
  const db: CoachDb = {
    jobTask: readTable(jobs),
    coachEvent,
    coachPreference: readTable([] as { userId: string }[]),
    user: readTable([
      { id: "u-priya", name: "Priya", active: true, managerId: "u-mgr" },
      { id: "u-ravi", name: "Ravi", active: true, managerId: "u-mgr" },
    ]),
  };
  return { db, jobs, coachEvent };
}

/** One cron tick fired three times: two in a row, then two at the same instant. */
async function fireTick(run: RunReminders, db: CoachDb, when: Date) {
  vi.setSystemTime(when);
  const deps = { db, now: () => new Date() };
  await run(deps);
  const settled = await Promise.allSettled([run(deps), run(deps)]);
  expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
}

describe("coach reminders under duplicate cron firing (depends on phase 9)", () => {
  it("an open task gets exactly one T−2h and one T−30m reminder, however often the cron fires", async () => {
    const run = await loadRunReminders();
    const { db, coachEvent } = world();
    for (let m = 180; m >= 5; m -= 5) await fireTick(run, db, at(m)); // 12:00 → 14:55 IST every 5 min
    const reminders = coachEvent.rows.filter((r) => r.kind === "reminder" && r.jobTaskId === "job-1");
    expect(reminders.map((r) => r.userId)).toEqual(["u-priya", "u-priya"]);
    expect(new Set(reminders.map((r) => r.dedupeKey)).size).toBe(2);
    expect(naturalDuplicates(coachEvent.rows.filter((r) => r.kind !== "reminder"), istDayKey)).toEqual([]);
    expect(coachEvent.rows.filter((r) => r.kind === "escalation")).toEqual([]); // not overdue yet
  });

  it("a task closed between the two windows gets the T−2h reminder only", async () => {
    const run = await loadRunReminders();
    const { db, jobs, coachEvent } = world();
    for (let m = 125; m >= 5; m -= 5) {
      if (m === 60) jobs[0].state = "DONE";
      await fireTick(run, db, at(m));
    }
    expect(coachEvent.rows.filter((r) => r.kind === "reminder")).toHaveLength(1);
  });

  it("overdue: one escalation to the reviewer per day, never more, never to the assignee", async () => {
    const run = await loadRunReminders();
    const { db, coachEvent } = world();
    for (let m = -15; m >= -240; m -= 15) await fireTick(run, db, at(m)); // 15:15 → 19:00 IST
    const esc = coachEvent.rows.filter((r) => r.kind === "escalation");
    expect(esc.map((r) => r.userId)).toEqual(["u-ravi"]);
    await fireTick(run, db, new Date(DUE.getTime() + 24 * 60 * MIN)); // next day, still overdue
    expect(coachEvent.rows.filter((r) => r.kind === "escalation")).toHaveLength(2);
    expect(naturalDuplicates(coachEvent.rows, istDayKey)).toEqual([]);
  });
});
