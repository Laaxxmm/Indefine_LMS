// Chaos: the Phase 9 coach reminder cron (/api/cron/firm-os/coach?job=reminders, every 30 min in
// working time) fires more often than scheduled — each tick once, then twice in the same instant
// (GitHub Actions schedule + a manual re-run + a second scheduler) — across two working days. Real
// runReminders over the coach's in-memory world, whose CoachEvent.dedupeKey is unique as in the schema.
// What a person sees: exactly one T−2h and one T−30m reminder for an open task, none for a task filed
// in between (filing belongs to the close-loop reconciler), one escalation to the reviewer per day
// once the internal due moment (18:00 IST) has passed — and no cron request fails because another
// one won the race.
import { afterEach, describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { runReminders, type ReminderRunSummary } from "@/lib/agents/coach/cron";
import { istDayKey } from "@/lib/ist";
import { CoachWorld } from "../fakes/coach-world";

const THU_0900_IST = new Date("2026-11-05T03:30:00.000Z");
const DUE_THU = new Date("2026-11-05T00:00:00+05:30"); // internal due Thu → due moment Thu 18:00 IST
const MIN = 60_000;

afterEach(() => vi.useRealTimers());

function world() {
  const w = new CoachWorld();
  let now = THU_0900_IST;
  w.clock = () => now;
  w.addUser("u-priya", { managerId: "u-mgr" });
  w.addUser("u-ravi", { managerId: "u-mgr" });
  w.addUser("u-mgr");
  const run = () => runReminders({ db: w.db, now: () => now });
  return { w, run, setNow: (d: Date) => void (now = d) };
}

/** Ticks every 30 minutes from 09:00 to 18:30 IST on `day` (0 = Thu); each fired three times, two at once. */
async function stormDay(t: ReturnType<typeof world>, day: number, beforeTick?: (at: Date) => void): Promise<ReminderRunSummary[]> {
  const out: ReminderRunSummary[] = [];
  for (let slot = 0; slot < 20; slot++) {
    const at = new Date(THU_0900_IST.getTime() + day * 24 * 60 * MIN + slot * 30 * MIN + MIN);
    t.setNow(at);
    beforeTick?.(at);
    out.push(await t.run());
    const settled = await Promise.allSettled([t.run(), t.run()]);
    expect(settled.map((s) => s.status), `tick ${at.toISOString()}`).toEqual(["fulfilled", "fulfilled"]);
    for (const s of settled) if (s.status === "fulfilled") out.push(s.value);
  }
  return out;
}

const sum = (xs: ReminderRunSummary[], k: "reminders" | "escalations") => xs.reduce((s, x) => s + x[k], 0);

describe("coach reminders under duplicate cron firing", () => {
  it("an open task: one T−2h and one T−30m reminder, then one escalation per day once overdue", async () => {
    const t = world();
    const job = t.w.addJob({ state: "IN_PREP", internalDueOn: DUE_THU });

    const thu = await stormDay(t, 0);
    const fri = await stormDay(t, 1);

    const reminders = t.w.events("reminder").filter((e) => e.jobTaskId === job.id);
    expect(reminders.map((e) => [e.userId, (e.payload as { slot: string }).slot])).toEqual([
      ["u-priya", "T−2h"],
      ["u-priya", "T−30m"],
    ]);
    expect(new Set(reminders.map((e) => e.dedupeKey)).size).toBe(2);
    expect(sum(thu, "reminders") + sum(fri, "reminders")).toBe(2);

    const escalations = t.w.events("escalation").filter((e) => e.jobTaskId === job.id);
    expect(escalations.map((e) => [e.userId, istDayKey(e.createdAt as Date)])).toEqual([
      ["u-ravi", "2026-11-05"], // 18:00 IST passed on Thursday
      ["u-ravi", "2026-11-06"], // and again, once, on Friday
    ]);
    expect(escalations.every((e) => (e.payload as { reason: string }).reason === "internal-overdue")).toBe(true);
    expect(t.w.auditEvent.rows.filter((a) => a.action === "escalate")).toHaveLength(2); // one audit per escalation, not per firing
  });

  it("a task filed between the two slots gets the T−2h reminder only (the reconciler owns it after filing)", async () => {
    const t = world();
    const job = t.w.addJob({ state: "IN_PREP", internalDueOn: DUE_THU });
    await stormDay(t, 0, (at) => {
      if (at.getTime() >= new Date("2026-11-05T11:30:00.000Z").getTime()) job.state = "FILED_BY_HUMAN"; // 17:00 IST
    });
    expect(t.w.events("reminder").map((e) => (e.payload as { slot: string }).slot)).toEqual(["T−2h"]);
    expect(t.w.events("escalation")).toEqual([]);
  });

  it("outside working time the extra firings do nothing at all", async () => {
    const t = world();
    t.w.addJob({ state: "IN_PREP", internalDueOn: DUE_THU });
    for (const iso of ["2026-11-05T14:00:00Z", "2026-11-07T23:00:00Z", "2026-11-08T05:00:00Z"]) {
      t.setNow(new Date(iso)); // Thu 19:30 IST, Sun 04:30 IST, Sun 10:30 IST
      const all = await Promise.all([t.run(), t.run(), t.run()]);
      expect(all.every((s) => s.skipped === "outside-working-time")).toBe(true);
    }
    expect(t.w.coachEvent.rows).toEqual([]);
  });
});
