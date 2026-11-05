// DEPENDS ON PHASE 11 MERGE (reconciler uses CoachEvent.dedupeKey). Not run by `npm test` until
// renamed: after the merge, `git mv` this file to tests/chaos/duplicate-cron-concurrent.test.ts
// (docs/qa/phase-12-runbook.md step "after-merge chaos"). It typechecks today; it FAILS today
// against src/lib/close-loop/reconcile.ts — verified 2026-11-05: three simultaneous runs create three
// reminders for the assignee and three escalations each for the reviewer and the manager; and
// (06 Nov, after the Phase 9 merge) a coach pre-filing reminder suppresses the reconciler's same-day
// close-loop reminder, because nudgeOnce matches on kind alone.
//
// Chaos: the close-loop cron fires CONCURRENTLY (GitHub Actions schedule + Railway cron in the same
// second). Storage enforces CoachEvent.dedupeKey @unique exactly as Postgres does (P2002 on a
// duplicate key). What a person must see: one reminder, one escalation per recipient — and no
// cron request fails because the other one won the race.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { istDayKey } from "@/lib/ist";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { reconcile } from "@/lib/close-loop/reconcile";
import { dedupeKey as coachKey } from "@/lib/agents/coach/db";
import { CloseLoopWorld } from "../../fakes/close-loop-world";
import { coachEventTable, naturalDuplicates } from "../support/coach-event-table";

const FILED = new Date("2026-11-02T04:30:00.000Z"); // Mon 10:00 IST
const HOUR = 3_600_000;

// Only Date is faked: the CoachEvent table yields with setImmediate so concurrent runs interleave.
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

function world() {
  const w = new CloseLoopWorld();
  w.clock = () => new Date();
  const table = coachEventTable(() => new Date());
  // Swap in the unique-enforcing table for both the client and the transaction view.
  (w.db as unknown as { coachEvent: unknown }).coachEvent = table;
  (w.tx as unknown as { coachEvent: unknown }).coachEvent = table;
  const deps = { db: w.db, verifier: w.verifier, turia: new ManualBridge(w.turiaRepo) };
  return { w, table, deps };
}

function heldJob(w: CloseLoopWorld) {
  const job = w.addJob({ filedAt: FILED });
  w.addFiledHistory(job.id, FILED);
  w.addFinal(job);
  return job;
}

describe("concurrent close-loop cron firing (depends on phase 11)", () => {
  it("three simultaneous runs 25 h after filing: one reminder, one escalation per recipient, every run succeeds", async () => {
    const { w, table, deps } = world();
    heldJob(w);
    vi.setSystemTime(new Date(FILED.getTime() + 25 * HOUR));
    const results = await Promise.allSettled([reconcile(deps), reconcile(deps), reconcile(deps)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    expect(naturalDuplicates(table.rows, istDayKey)).toEqual([]);
    expect(table.rows.map((r) => `${r.kind}:${r.userId}`).sort()).toEqual(["escalation:u-mgr", "escalation:u-ravi", "reminder:u-priya"]);
    expect(table.rows.every((r) => !!r.dedupeKey)).toBe(true); // every nudge carries its idempotency key
  });

  it("a DONE job that lost its Final file: concurrent runs raise one alert per recipient and one done-alert audit", async () => {
    const { w, table, deps } = world();
    const { job, deliverable } = w.readyJob({ filedAt: FILED });
    vi.setSystemTime(new Date(FILED.getTime() + HOUR));
    const { closeJob } = await import("@/lib/close-loop/gate");
    expect((await closeJob(job.id, { kind: "system", name: "setup" }, deps)).ok).toBe(true);
    w.loseFile(deliverable.driveItemId!);
    vi.setSystemTime(new Date(FILED.getTime() + 2 * HOUR));
    const results = await Promise.allSettled([reconcile(deps), reconcile(deps)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(naturalDuplicates(table.rows, istDayKey)).toEqual([]);
    expect(w.audits.filter((a) => a.action === "done-alert")).toHaveLength(1);
    expect(w.job(job.id).state).toBe("DONE");
  });

  it("a coach pre-filing reminder does not suppress the reconciler's 'filed but not closed' reminder the same day", async () => {
    // Coordinator, 06 Nov 2026: the coach (Phase 9) also writes kind "reminder", reason "internal-due"
    // (pre-filing states only); the reconciler must key on its own reason, e.g.
    // reminder:<job>:<user>:close-loop:<istDay>, and stop matching on kind alone.
    const { w, table, deps } = world();
    const job = heldJob(w); // filed Mon 10:00 IST, Final in place, Turia not closed
    vi.setSystemTime(new Date(FILED.getTime() - 60 * 60_000)); // Mon 09:00 IST, before filing
    await table.create({
      data: {
        userId: "u-priya", kind: "reminder", jobTaskId: job.id, dedupeKey: coachKey.reminder(job.id, "u-priya", "2026-11-02@t-120"),
        payload: { reason: "internal-due", slot: "T−2h", message: "GSTR-3B 2026-10 for ACME01 is due internally today at 18:00 IST." },
      },
    });
    vi.setSystemTime(new Date(FILED.getTime() + 30 * 60_000)); // Mon 10:30 IST: 30 min after filing
    const results = await Promise.allSettled([reconcile(deps), reconcile(deps)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const reminders = table.rows.filter((r) => r.kind === "reminder" && r.userId === "u-priya" && r.jobTaskId === job.id);
    expect(reminders.map((r) => (r.payload as { reason: string }).reason).sort()).toEqual(["close-loop", "internal-due"]);
    expect(reminders.find((r) => (r.payload as { reason: string }).reason === "close-loop")?.dedupeKey).toMatch(/close-loop/);
    expect(naturalDuplicates(table.rows, istDayKey)).toEqual([]);
  });
});
