// Reconciler idempotency through CoachEvent.dedupeKey (unique): concurrent cron runs cannot
// double-nudge or double-alert; a unique violation is "already sent"; any other error still fails.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { CloseLoopWorld } from "../../../tests/fakes/close-loop-world";
import { closeJob } from "./gate";
import { ESCALATE_AFTER_MS, NUDGE_AFTER_MS, dedupeKeys, isUniqueViolation, reconcile } from "./reconcile";

// Mon 02 Nov 2026 10:00 IST = 04:30 UTC.
const FILED = new Date("2026-11-02T04:30:00.000Z");
const MIN = 60_000;
const at = (ms: number) => new Date(FILED.getTime() + ms);

function setup() {
  const w = new CloseLoopWorld();
  w.clock = () => new Date();
  return { w, deps: { db: w.db, verifier: w.verifier, turia: new ManualBridge(w.turiaRepo) } };
}

function heldJob(w: CloseLoopWorld) {
  const job = w.addJob({ filedAt: FILED });
  w.addFiledHistory(job.id, FILED);
  w.addFinal(job);
  return job;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("dedupe keys", () => {
  it("are per job, per person and per IST day", () => {
    expect(dedupeKeys.reminder("job-1", "u-priya", "2026-11-02")).toBe("reminder:job-1:u-priya:2026-11-02");
    expect(dedupeKeys.escalation("job-1", "u-mgr", "2026-11-02")).toBe("escalation:job-1:u-mgr:2026-11-02");
    expect(dedupeKeys.doneAlert("job-1", "2026-11-02")).toBe("done-alert:job-1:2026-11-02");
    expect(dedupeKeys.doneAlertRecipient("job-1", "2026-11-02", "u-mgr")).toBe("done-alert:job-1:2026-11-02:u-mgr");
  });

  it("recognises Prisma's unique violation only", () => {
    expect(isUniqueViolation({ code: "P2002", meta: { target: ["dedupeKey"] } })).toBe(true);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation({ code: "P2025" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("concurrent runs", () => {
  it("two runs at the same moment send one reminder and one escalation per person, with the keys", async () => {
    const { w, deps } = setup();
    const job = heldJob(w);
    vi.setSystemTime(at(ESCALATE_AFTER_MS + MIN)); // Tue 02 Nov... +24h → 03 Nov IST
    const [a, b] = await Promise.all([reconcile(deps), reconcile(deps)]);
    expect(a.reminders + b.reminders).toBe(1);
    expect(a.escalations + b.escalations).toBe(2); // reviewer and manager, once each
    expect(w.coach.map((c) => c.dedupeKey).sort()).toEqual([
      `escalation:${job.id}:u-mgr:2026-11-03`,
      `escalation:${job.id}:u-ravi:2026-11-03`,
      `reminder:${job.id}:u-priya:2026-11-03`,
    ]);
    // A third run the same day sends nothing.
    expect(await reconcile(deps)).toMatchObject({ reminders: 0, escalations: 0 });
    expect(w.coach).toHaveLength(3);
  });

  it("the next IST day gets a new reminder", async () => {
    const { w, deps } = setup();
    const job = heldJob(w);
    vi.setSystemTime(at(NUDGE_AFTER_MS + MIN));
    await reconcile(deps);
    vi.setSystemTime(new Date("2026-11-03T04:30:00.000Z")); // Tue 10:00 IST
    await reconcile(deps);
    expect(w.coach.filter((c) => c.kind === "reminder").map((c) => c.dedupeKey)).toEqual([`reminder:${job.id}:u-priya:2026-11-02`, `reminder:${job.id}:u-priya:2026-11-03`]);
  });

  it("a DONE job whose file vanished is alerted once even when two runs race: one owner, one AuditEvent", async () => {
    const { w, deps } = setup();
    const { job, deliverable } = w.readyJob({ filedAt: FILED });
    vi.setSystemTime(at(10 * MIN));
    expect((await closeJob(job.id, { kind: "system", name: "test" }, deps)).ok).toBe(true);
    w.loseFile(deliverable.driveItemId!);
    vi.setSystemTime(at(60 * MIN));
    const [a, b] = await Promise.all([reconcile(deps), reconcile(deps)]);
    expect([...a.alerts, ...b.alerts]).toEqual([job.id]);
    expect(w.audits.filter((x) => x.action === "done-alert")).toHaveLength(1);
    const esc = w.coach.filter((c) => (c.payload as { reason?: string }).reason === "done-recheck");
    expect(esc.map((c) => [c.userId, c.dedupeKey])).toEqual([
      ["u-mgr", `done-alert:${job.id}:2026-11-02`],
      ["u-ravi", `done-alert:${job.id}:2026-11-02:u-ravi`],
    ]);
    expect(w.job(job.id).state).toBe("DONE"); // never reopened
  });

  it("an open-job escalation and a DONE alert on the same day no longer collide", async () => {
    expect(dedupeKeys.escalation("job-1", "u-mgr", "2026-11-02")).not.toBe(dedupeKeys.doneAlert("job-1", "2026-11-02"));
  });
});

describe("errors", () => {
  it("anything other than a unique violation still fails the run", async () => {
    const { w, deps } = setup();
    heldJob(w);
    w.tx.coachEvent.create = async () => Promise.reject(new Error("connection reset"));
    vi.setSystemTime(at(NUDGE_AFTER_MS + MIN));
    await expect(reconcile(deps)).rejects.toThrow(/connection reset/);
  });
});
