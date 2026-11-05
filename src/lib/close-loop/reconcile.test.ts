// Reconciler: working-hours window, 15-min / 24-h nudges (fake timers), idempotent re-runs,
// closing jobs whose conditions are now met, and DONE re-checks that alert but never reopen.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { CloseLoopWorld } from "../../../tests/fakes/close-loop-world";
import { closeJob } from "./gate";
import { ESCALATE_AFTER_MS, NUDGE_AFTER_MS, escalationRecipients, isWorkingHours, reconcile } from "./reconcile";

// Mon 02 Nov 2026 10:00 IST = 04:30 UTC.
const FILED = new Date("2026-11-02T04:30:00.000Z");
const MIN = 60_000;
const at = (ms: number) => new Date(FILED.getTime() + ms);

function setup() {
  const w = new CloseLoopWorld();
  w.clock = () => new Date(); // follows the fake system time
  const deps = { db: w.db, verifier: w.verifier, turia: new ManualBridge(w.turiaRepo) };
  return { w, deps };
}

/** CLOSING job filed at FILED with a Final file but no Turia close. */
function heldJob(w: CloseLoopWorld, over: Parameters<CloseLoopWorld["addJob"]>[0] = {}) {
  const job = w.addJob({ filedAt: FILED, ...over });
  w.addFiledHistory(job.id, FILED);
  w.addFinal(job);
  return job;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("isWorkingHours (IST, Mon–Sat 09:00–19:00)", () => {
  it.each([
    ["2026-11-02T03:29:00Z", false], // Mon 08:59
    ["2026-11-02T03:30:00Z", true], // Mon 09:00
    ["2026-11-02T13:29:00Z", true], // Mon 18:59
    ["2026-11-02T13:30:00Z", false], // Mon 19:00
    ["2026-11-07T05:00:00Z", true], // Sat 10:30
    ["2026-11-08T05:00:00Z", false], // Sun 10:30
    ["2026-11-01T20:00:00Z", false], // Mon 01:30 IST (Sun in UTC)
  ])("%s → %s", (iso, want) => {
    expect(isWorkingHours(new Date(iso))).toBe(want);
  });
});

describe("out of hours", () => {
  it("is a no-op: nothing read beyond the clock, nothing written", async () => {
    const { w, deps } = setup();
    heldJob(w);
    vi.setSystemTime(new Date("2026-11-02T15:00:00Z")); // Mon 20:30 IST
    const s = await reconcile(deps);
    expect(s.skipped).toBe("outside-working-hours");
    expect(w.coach).toEqual([]);
    expect(w.audits).toEqual([]);
    expect(w.verifierCalls.getItem).toBe(0);
  });
});

describe("nudges for held CLOSING jobs", () => {
  it("nothing before 15 minutes", async () => {
    const { w, deps } = setup();
    heldJob(w);
    vi.setSystemTime(at(NUDGE_AFTER_MS));
    const s = await reconcile(deps);
    expect(s).toMatchObject({ open: 1, reminders: 0, escalations: 0 });
    expect(w.coach).toEqual([]);
    expect(w.audits.map((a) => a.action)).toEqual(["close-refused"]);
  });

  it("after 15 minutes the assignee gets one reminder, however often the cron fires that day", async () => {
    const { w, deps } = setup();
    const job = heldJob(w);
    vi.setSystemTime(at(NUDGE_AFTER_MS + MIN));
    expect((await reconcile(deps)).reminders).toBe(1);
    expect(w.coach).toHaveLength(1);
    expect(w.coach[0]).toMatchObject({ userId: "u-priya", kind: "reminder", jobTaskId: job.id });
    const payload = w.coach[0].payload as { message: string; missing: string[] };
    expect(payload.message).toMatch(/GSTR-3B 2026-10 for ACME01 was marked filed 16m ago/);
    expect(payload.missing).toEqual(["the Turia task close with time logged"]);

    expect((await reconcile(deps)).reminders).toBe(0); // duplicate firing
    vi.setSystemTime(at(4 * 60 * MIN)); // later the same day
    expect((await reconcile(deps)).reminders).toBe(0);
    expect(w.coach).toHaveLength(1);
    expect(w.job(job.id).state).toBe("CLOSING");
  });

  it("after 24 hours the reviewer and the assignee's manager are escalated once per day; the reminder repeats daily", async () => {
    const { w, deps } = setup();
    const job = heldJob(w);
    vi.setSystemTime(at(20 * MIN)); // Mon: day-1 reminder
    expect((await reconcile(deps)).reminders).toBe(1);
    vi.setSystemTime(at(ESCALATE_AFTER_MS - MIN)); // Tue 09:59 IST: day-2 reminder, no escalation yet
    expect((await reconcile(deps)).reminders).toBe(1);
    expect(w.coach.filter((c) => c.kind === "escalation")).toEqual([]);

    vi.setSystemTime(at(ESCALATE_AFTER_MS + MIN)); // Tue 10:01 IST
    const s = await reconcile(deps);
    expect(s).toMatchObject({ reminders: 0, escalations: 2 });
    expect(w.coach.filter((c) => c.kind === "escalation").map((c) => c.userId).sort()).toEqual(["u-mgr", "u-ravi"]);
    expect((w.coach.at(-1)!.payload as { message: string }).message).toMatch(/waited 1d since filing/);

    expect(await reconcile(deps)).toMatchObject({ reminders: 0, escalations: 0 });
    expect(w.coach).toHaveLength(4); // day-1 reminder, day-2 reminder, 2 escalations
    expect(w.job(job.id).state).toBe("CLOSING");
  });

  it("escalates to partners when the job has no reviewer and the assignee no manager", async () => {
    const { w } = setup();
    w.users = w.users.map((u) => (u.id === "u-priya" ? { ...u, managerId: null } : u));
    const job = heldJob(w, { reviewerId: null });
    const row = (await w.db.jobTask.findFirst({ where: { id: job.id }, select: {} as never }))!;
    expect(await escalationRecipients(w.db, row)).toEqual(["u-partner"]);
    w.engagements.push({ id: "eng-1", reviewerId: "u-ravi" });
    w.job(job.id).engagementId = "eng-1";
    const row2 = (await w.db.jobTask.findFirst({ where: { id: job.id }, select: {} as never }))!;
    expect(await escalationRecipients(w.db, row2)).toEqual(["u-ravi"]);
  });

  it("an unassigned job reminds the reviewer", async () => {
    const { w, deps } = setup();
    heldJob(w, { assigneeId: null });
    vi.setSystemTime(at(20 * MIN));
    await reconcile(deps);
    expect(w.coach[0]).toMatchObject({ userId: "u-ravi", kind: "reminder" });
  });

  it("a job missing only the filing confirmation still nudges; a job whose filedAt is unknown uses its FILED event", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ filedAt: null, ackRef: null });
    w.addFiledHistory(job.id, FILED);
    w.addFinal(job);
    w.addCloseSync(job.id);
    vi.setSystemTime(at(30 * MIN));
    await reconcile(deps);
    expect((w.coach[0].payload as { missing: string[] }).missing).toEqual(["the filing confirmation"]);
  });
});

describe("closing and catching up", () => {
  it("closes a CLOSING job whose Turia close arrived", async () => {
    const { w, deps } = setup();
    const job = heldJob(w);
    w.addCloseSync(job.id);
    vi.setSystemTime(at(40 * MIN));
    const s = await reconcile(deps);
    expect(s.closed).toEqual([job.id]);
    expect(w.job(job.id).state).toBe("DONE");
    expect(w.coach).toEqual([]);
    expect(w.audits.find((a) => a.action === "close")?.actorId).toBe("system:close-loop-reconciler");
  });

  it("moves a FILED_BY_HUMAN job the request left behind to CLOSING", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "FILED_BY_HUMAN", filedAt: FILED });
    w.addEvent(job.id, "APPROVED", "FILED_BY_HUMAN", FILED);
    vi.setSystemTime(at(5 * MIN));
    const s = await reconcile(deps);
    expect(s.movedToClosing).toEqual([job.id]);
    expect(w.job(job.id).state).toBe("CLOSING");
  });
});

describe("DONE re-check: alert, never reopen", () => {
  async function doneJob(w: CloseLoopWorld, deps: ReturnType<typeof setup>["deps"]) {
    const { job, deliverable } = w.readyJob({ filedAt: FILED });
    vi.setSystemTime(at(10 * MIN));
    expect((await closeJob(job.id, { kind: "system", name: "test" }, deps)).ok).toBe(true);
    return { job, deliverable, doneAt: w.job(job.id).doneAt };
  }

  it("a healthy DONE job raises nothing", async () => {
    const { w, deps } = setup();
    await doneJob(w, deps);
    vi.setSystemTime(at(60 * MIN));
    const s = await reconcile(deps);
    expect(s).toMatchObject({ doneChecked: 1, alerts: [], backstopViolations: [] });
  });

  it("file deleted after DONE → escalation + AuditEvent; state and doneAt unchanged; no duplicate alert", async () => {
    const { w, deps } = setup();
    const { job, deliverable, doneAt } = await doneJob(w, deps);
    w.loseFile(deliverable.driveItemId!);
    vi.setSystemTime(at(60 * MIN));
    const s = await reconcile(deps);
    expect(s.alerts).toEqual([job.id]);
    expect(w.job(job.id)).toMatchObject({ state: "DONE", doneAt });
    expect(w.events.filter((e) => e.jobTaskId === job.id).at(-1)?.toState).toBe("DONE");
    const esc = w.coach.filter((c) => c.kind === "escalation");
    expect(esc.map((c) => c.userId).sort()).toEqual(["u-mgr", "u-ravi"]);
    expect((esc[0].payload as { message: string }).message).toMatch(/not found in SharePoint.*was not reopened/);
    expect(w.audits.filter((a) => a.action === "done-alert")).toHaveLength(1);

    const again = await reconcile(deps);
    expect(again.alerts).toEqual([]);
    expect(w.audits.filter((a) => a.action === "done-alert")).toHaveLength(1);
    expect(w.job(job.id).state).toBe("DONE");
  });

  it("file changed after DONE → alert", async () => {
    const { w, deps } = setup();
    const { job, deliverable } = await doneJob(w, deps);
    w.changeFile(deliverable.driveItemId!, "tampered");
    vi.setSystemTime(at(60 * MIN));
    expect((await reconcile(deps)).alerts).toEqual([job.id]);
  });

  it("deliverable row edited after DONE → alert", async () => {
    const { w, deps } = setup();
    const { job, deliverable } = await doneJob(w, deps);
    deliverable.sha256 = "0".repeat(64);
    vi.setSystemTime(at(60 * MIN));
    const s = await reconcile(deps);
    expect(s.alerts).toEqual([job.id]);
    expect(JSON.stringify(w.audits.at(-1)?.meta)).toMatch(/no longer matches/);
  });

  it("Graph unavailable → reported as unverifiable, no alert", async () => {
    const { w, deps } = setup();
    const { job } = await doneJob(w, deps);
    w.verifierError = new Error("503");
    vi.setSystemTime(at(60 * MIN));
    const s = await reconcile(deps);
    expect(s).toMatchObject({ unverifiable: [job.id], alerts: [] });
  });

  it("backstop: a DONE job without a system:close-gate event with evidence is flagged", async () => {
    const { w, deps } = setup();
    const job = w.addJob({ state: "DONE", doneAt: FILED, filedAt: FILED });
    w.addFiledHistory(job.id, FILED);
    w.addEvent(job.id, "CLOSING", "DONE", at(MIN), "u-partner", "closed by hand");
    w.addFinal(job);
    const forged = w.addJob({ state: "DONE", doneAt: null });
    w.addEvent(forged.id, "CLOSING", "DONE", at(MIN), "system:close-gate", "{\"gate\":\"close-gate\"}");
    vi.setSystemTime(at(30 * MIN));
    const s = await reconcile(deps);
    expect(s.backstopViolations).toEqual([job.id, forged.id].sort());
    expect(s.alerts.sort()).toEqual([job.id, forged.id].sort());
    expect(w.job(job.id).state).toBe("DONE");
    expect(JSON.stringify(w.audits.find((a) => a.entityId === job.id)?.meta)).toMatch(/without close-gate evidence/);
  });
});
