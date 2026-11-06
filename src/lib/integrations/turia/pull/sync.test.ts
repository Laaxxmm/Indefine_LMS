// The Turia pull end to end against a fake Turia and an in-memory database: modes, mapping,
// idempotency, dry run creating nothing, disappearance never deleting, completion feeding the close
// gate, the sign-in paths, the lock and the time limit.
import { describe, expect, it } from "vitest";
import { checkTuria } from "@/lib/close-loop/gate";
import type { TuriaSyncRow } from "@/lib/close-loop/db";
import { createPullWorld, rawTask, type PullWorld } from "../../../../../tests/fakes/turia-pull-world";
import { saveClientLink, savePersonLink } from "./admin";
import { CANCELLED_NOTE, MISSING_NOTE } from "./plan";
import { BUSY_MESSAGE, FAILED_MESSAGE, MODE_INVALID_MESSAGE, PULL_OFF_MESSAGE, SESSION_MESSAGE, TIMEOUT_MESSAGE } from "./messages";
import { PULL_ACTOR, runTuriaPull, type PullDeps } from "./sync";
import { FIRM_OS_OFF_MESSAGE } from "@/lib/workspace/flag";

const admin = { id: "u-admin", name: "Asha", email: "asha@indefine.test", role: "ADMIN", level: "PARTNER", active: true } as never;
const run = (w: PullWorld, over: Partial<PullDeps> = {}) => runTuriaPull(w.deps(over), { trigger: "cron", actorId: null });

function world(tasks = [rawTask({ id: "101" })]) {
  const w = createPullWorld();
  w.seedFirm();
  w.turia.pages = [tasks];
  return w;
}

const jobOf = (w: PullWorld, turiaTaskId: string) => w.db.jobTask.rows.find((j) => j.turiaTaskId === turiaTaskId) as Record<string, unknown> | undefined;

describe("switches", () => {
  it("does nothing while Firm OS is off, the pull is off, or the setting is wrong", async () => {
    const w = world();
    w.env.FIRM_OS_ENABLED = "";
    expect(await run(w)).toMatchObject({ status: "off", message: FIRM_OS_OFF_MESSAGE, runId: null });
    w.env.FIRM_OS_ENABLED = "true";
    w.env.FIRM_OS_TURIA_PULL = "";
    expect(await run(w)).toMatchObject({ status: "off", message: PULL_OFF_MESSAGE });
    w.env.FIRM_OS_TURIA_PULL = "maybe";
    expect(await run(w)).toMatchObject({ status: "failed", message: MODE_INVALID_MESSAGE });
    expect(w.turia.calls).toEqual([]);
    expect(w.db.turiaPullRun.rows).toEqual([]);
    expect(w.db.turiaTaskMirror.rows).toEqual([]);
  });
});

describe("dry run", () => {
  it("stores the mirror and a preview, and creates or changes no job, client or close record", async () => {
    const w = world([rawTask({ id: "101" }), rawTask({ id: "102", clientname: "Beta Foods LLP", taskname: "GSTR-1 Oct 2026" }), rawTask({ id: "103", taskstatus: "3" })]);
    w.env.FIRM_OS_TURIA_PULL = "dry-run";
    const r = await run(w);
    expect(r.status).toBe("ok");
    expect(r.mode).toBe("dry-run");
    expect(w.db.turiaTaskMirror.rows).toHaveLength(3);
    expect(w.db.jobTask.rows).toHaveLength(0);
    expect(w.db.firmClient.rows).toHaveLength(1); // only the seeded one
    expect(w.db.engagement.rows).toHaveLength(0);
    expect(w.db.turiaSync.rows).toHaveLength(0);
    expect(r.counts).toMatchObject({ fetched: 3, new: 3, create: 2, closedInTuria: 1 });
    const details = r.preview.map((p) => p.detail);
    expect(details[0]).toMatch(/^Would create GST · GSTR-3B · 2026-10 FY 2026-27 \(period from the name\) for Priya S, reviewer Ravi K, due 18 Nov 2026\.$/);
    expect(details[1]).toMatch(/Would create GST · GSTR-1 · 2026-10 FY 2026-27 .* New Firm OS client code BETAF\./);
    const runRow = w.db.turiaPullRun.rows[0];
    expect(runRow).toMatchObject({ mode: "dry-run", status: "ok", complete: true });
    expect((runRow.preview as unknown[]).length).toBe(2);
    const audit = w.db.auditEvent.rows[0];
    expect(audit).toMatchObject({ actorId: PULL_ACTOR, action: "turia-pull.run", entity: "TuriaPullRun", entityId: runRow.id });
    expect(Object.keys((audit.meta as { counts: object }).counts)).toContain("fetched");
    expect(JSON.stringify(audit.meta)).not.toContain("Acme"); // counts only, no client names
  });

  it("keeps only the fields a job needs (no descriptions or comments)", async () => {
    const w = world();
    w.env.FIRM_OS_TURIA_PULL = "dry-run";
    await run(w);
    const row = w.db.turiaTaskMirror.rows[0];
    expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["description"]));
    expect(JSON.stringify(row)).not.toMatch(/private notes|call the client/);
    expect(row).toMatchObject({ id: "101", identity: "TSK00101", clientName: "Acme Traders Pvt Ltd", clientKey: "acme traders private limited", status: "1" });
  });
});

describe("on", () => {
  it("creates the job with mapped people, Turia's due date, the period and the engagement", async () => {
    const w = world();
    const r = await run(w);
    expect(r.status).toBe("ok");
    const job = jobOf(w, "101")!;
    expect(job).toMatchObject({
      firmClientId: "fc-acme",
      service: "GST",
      title: "GSTR-3B",
      fy: "2026-27",
      period: "2026-10",
      state: "ASSIGNED",
      assigneeId: "u-priya", // by email, case-insensitive
      reviewerId: "u-ravi", // by exact name (no email in Turia)
      source: "turia",
      agentless: false,
    });
    expect((job.internalDueOn as Date).toISOString()).toBe("2026-11-18T06:30:00.000Z");
    expect(w.db.engagement.rows[0]).toMatchObject({ firmClientId: "fc-acme", service: "GST", frequency: "MONTHLY" });
    expect(w.db.jobTaskEvent.rows[0]).toMatchObject({ jobTaskId: job.id, fromState: null, toState: "ASSIGNED", actorId: PULL_ACTOR });
    expect(w.db.turiaTaskMirror.rows[0]).toMatchObject({ jobTaskId: job.id });
    expect(w.db.turiaPersonLink.rows.map((p) => [p.turiaUserId, p.userId, p.matchedBy])).toEqual([
      ["t-priya", "u-priya", "email"],
      ["t-ravi", "u-ravi", "name"],
    ]);
  });

  it("is idempotent: a second run with the same Turia data changes nothing", async () => {
    const w = world();
    await run(w);
    const before = JSON.stringify([w.db.jobTask.rows, w.db.engagement.rows, w.db.firmClient.rows, w.db.turiaSync.rows]);
    w.advance(15 * 60_000);
    const r2 = await run(w);
    expect(r2.counts).toMatchObject({ fetched: 1, unchanged: 1, new: 0, changed: 0, create: 0, update: 0 });
    expect(r2.preview).toEqual([]);
    expect(JSON.stringify([w.db.jobTask.rows, w.db.engagement.rows, w.db.firmClient.rows, w.db.turiaSync.rows])).toBe(before);
    expect(w.db.turiaPullRun.rows).toHaveLength(2);
  });

  it("follows Turia's assignee, reviewer and due date, never clearing them for an unmatched person", async () => {
    const w = world();
    await run(w);
    w.turia.pages = [[rawTask({ id: "101", assignee: [{ id: "t-ravi", name: "Ravi K" }], reviewer: [{ id: "t-priya", name: "Priya S" }], targetduedate: Date.UTC(2026, 10, 15) })]];
    const r = await run(w);
    expect(r.counts.update).toBe(1);
    expect(r.preview[0].detail).toBe("Changed preparer to Ravi K, reviewer to Priya S, due date to 15 Nov 2026.");
    expect(jobOf(w, "101")).toMatchObject({ assigneeId: "u-ravi", reviewerId: "u-priya" });
    w.turia.pages = [[rawTask({ id: "101", assignee: [{ id: "t-stranger", name: "Someone New" }], reviewer: [], targetduedate: null })]];
    await run(w);
    expect(jobOf(w, "101")).toMatchObject({ assigneeId: "u-ravi", reviewerId: "u-priya" });
  });

  it("never moves a job through the state machine, and leaves a DONE job alone", async () => {
    const w = world([rawTask({ id: "101" }), rawTask({ id: "102", taskname: "GSTR-1 Oct 2026" })]);
    await run(w);
    Object.assign(jobOf(w, "101")!, { state: "IN_REVIEW" });
    Object.assign(jobOf(w, "102")!, { state: "DONE" });
    w.turia.pages = [[rawTask({ id: "101", assignee: [{ id: "t-ravi", name: "Ravi K" }] }), rawTask({ id: "102", taskname: "GSTR-1 Oct 2026", assignee: [{ id: "t-ravi", name: "Ravi K" }], taskstatus: "3" })]];
    await run(w);
    expect(jobOf(w, "101")).toMatchObject({ state: "IN_REVIEW", assigneeId: "u-ravi" });
    expect(jobOf(w, "102")).toMatchObject({ state: "DONE", assigneeId: "u-priya" });
    expect(w.db.turiaSync.rows).toHaveLength(0);
    expect(w.db.jobTaskEvent.rows).toHaveLength(2); // the two creations only
  });

  it("a task that disappears flags its job and keeps it; it clears when the task comes back", async () => {
    const w = world([rawTask({ id: "101" }), rawTask({ id: "102", taskname: "GSTR-1 Oct 2026" })]);
    await run(w);
    w.turia.pages = [[rawTask({ id: "102", taskname: "GSTR-1 Oct 2026" })]];
    w.advance(60_000);
    const r = await run(w);
    expect(r.counts.missing).toBe(1);
    expect(r.counts.flagged).toBe(1);
    expect(w.db.jobTask.rows).toHaveLength(2);
    expect(jobOf(w, "101")).toMatchObject({ turiaNote: MISSING_NOTE });
    expect(jobOf(w, "101")!.turiaMissingAt).toBeInstanceOf(Date);
    expect(w.db.turiaTaskMirror.rows.find((m) => m.id === "101")!.missingSince).toBeInstanceOf(Date);
    w.turia.pages = [[rawTask({ id: "101" }), rawTask({ id: "102", taskname: "GSTR-1 Oct 2026" })]];
    w.advance(60_000);
    const back = await run(w);
    expect(back.preview.map((p) => p.action)).toContain("unflag");
    expect(jobOf(w, "101")).toMatchObject({ turiaMissingAt: null, turiaNote: null });
  });

  it("a cancelled task flags its job (never removed)", async () => {
    const w = world();
    await run(w);
    w.turia.pages = [[rawTask({ id: "101", taskstatusname: "Cancelled", taskstatus: "5" })]];
    await run(w);
    expect(jobOf(w, "101")).toMatchObject({ turiaNote: CANCELLED_NOTE });
    expect(w.db.jobTask.rows).toHaveLength(1);
  });

  it("an incomplete scan (capped) never marks tasks missing", async () => {
    const w = world([rawTask({ id: "101" }), rawTask({ id: "102", taskname: "GSTR-1 Oct 2026" })]);
    await run(w);
    w.turia.pages = [[rawTask({ id: "102", taskname: "GSTR-1 Oct 2026" })], [rawTask({ id: "103" })]];
    const r = await run(w, { limits: { perPage: 1, maxPages: 1 } });
    expect(r.status).toBe("partial");
    expect(r.complete).toBe(false);
    expect(r.counts.missing).toBe(0);
    expect(jobOf(w, "101")).toMatchObject({ turiaMissingAt: null });
  });

  it("Turia's completion with time logged satisfies the close gate's Turia check", async () => {
    const w = world();
    await run(w);
    const job = jobOf(w, "101")!;
    w.turia.pages = [[rawTask({ id: "101", taskstatus: "3", completedon: Date.UTC(2026, 10, 6) })]];
    w.turia.minutes.set("101", 95);
    const r = await run(w);
    expect(r.counts.completed).toBe(1);
    const sync = w.db.turiaSync.rows[0];
    expect(sync).toMatchObject({ jobTaskId: job.id, firmClientId: "fc-acme", operation: "closeTask", mode: "PULL", status: "CLOSED", turiaRef: "TSK00101", minutesLogged: 95 });
    expect(job.state).toBe("ASSIGNED"); // DONE stays with the close gate
    const rows = w.db.turiaSync.rows.filter((s) => s.jobTaskId === job.id && s.operation === "closeTask") as unknown as TuriaSyncRow[];
    expect(checkTuria(rows).ok).toBe(true);
    // Recorded once: a later run adds nothing.
    await run(w);
    expect(w.db.turiaSync.rows).toHaveLength(1);
    expect(w.turia.calls.filter((c) => c.startsWith("timesheet/list"))).toHaveLength(1);
  });

  it("a completion with no time in Turia records nothing and asks for the minutes by hand, rechecked a day later", async () => {
    const w = world();
    await run(w);
    w.turia.pages = [[rawTask({ id: "101", taskstatus: "3" })]];
    const r = await run(w);
    expect(r.counts.completedNoTime).toBe(1);
    expect(r.preview.find((p) => p.action === "complete")!.detail).toMatch(/Record Turia close/);
    expect(w.db.turiaSync.rows).toHaveLength(0);
    w.advance(60 * 60_000);
    await run(w);
    expect(w.turia.calls.filter((c) => c.startsWith("timesheet/list"))).toHaveLength(1);
    w.advance(24 * 60 * 60_000);
    w.turia.minutes.set("101", 30);
    await run(w);
    expect(w.db.turiaSync.rows[0]).toMatchObject({ minutesLogged: 30, status: "CLOSED" });
  });

  it("a task first seen completed or cancelled makes no job", async () => {
    const w = world([rawTask({ id: "101", taskstatus: "3" }), rawTask({ id: "102", taskstatusname: "Cancelled" })]);
    const r = await run(w);
    expect(r.counts.closedInTuria).toBe(2);
    expect(w.db.jobTask.rows).toHaveLength(0);
  });

  it("a task no rule maps becomes a job without an agent, named with its Turia number", async () => {
    const w = world([rawTask({ id: "101", taskname: "Monthly MIS for the board", departmentname: "Accounts" })]);
    const r = await run(w);
    expect(r.counts.agentless).toBe(1);
    expect(jobOf(w, "101")).toMatchObject({ agentless: true, service: "Books", title: "Monthly MIS for the board (TSK00101)", period: "2026-11", fy: "2026-27" });
    expect(w.db.engagement.rows).toHaveLength(0);
  });

  it("links an existing job with the same client, service, FY, period and title instead of duplicating it", async () => {
    const w = world();
    w.db.jobTask.rows.push({ id: "job-onboard", firmClientId: "fc-acme", service: "GST", fy: "2026-27", period: "2026-10", title: "GSTR-3B", state: "IN_PREP", assigneeId: "u-ravi", reviewerId: null, internalDueOn: null, turiaTaskId: null, turiaMissingAt: null, turiaNote: null, agentless: false, source: null });
    const r = await run(w);
    expect(r.counts.link).toBe(1);
    expect(w.db.jobTask.rows).toHaveLength(1);
    expect(w.db.jobTask.rows[0]).toMatchObject({ id: "job-onboard", turiaTaskId: "101", state: "IN_PREP", assigneeId: "u-priya", reviewerId: "u-ravi", source: null });
    expect(w.db.turiaTaskMirror.rows[0].jobTaskId).toBe("job-onboard");
  });

  it("a second Turia task for an already linked job gets its own job, titled with its number", async () => {
    const w = world([rawTask({ id: "101" }), rawTask({ id: "201" })]);
    await run(w);
    expect(w.db.jobTask.rows.map((j) => j.title).sort()).toEqual(["GSTR-3B", "GSTR-3B (TSK00201)"]);
  });
});

describe("mapping waits", () => {
  it("an unmatched client waits; after a manual pick the next run creates the Firm OS client and the job", async () => {
    const w = world([rawTask({ id: "101", clientname: "Gamma Exports" })]);
    w.db.client.rows.push({ id: "c-gamma", name: "Gamma Exports (India) Private Limited" });
    const r = await run(w);
    expect(r.counts.waitingClient).toBe(1);
    expect(r.counts.unmatchedClients).toBe(1);
    expect(r.preview[0]).toMatchObject({ action: "wait", detail: expect.stringMatching(/not matched to a client in the client list/) });
    expect(await saveClientLink(w.adminDb, admin, { key: "gamma exports", action: "link", lmsClientId: "c-gamma" })).toMatchObject({ ok: true });
    await run(w);
    const fc = w.db.firmClient.rows.find((f) => f.lmsClientId === "c-gamma")!;
    expect(fc.clientCode).toBe("GAMMAE"); // "India" and "Private Limited" are left out
    expect(jobOf(w, "101")).toMatchObject({ firmClientId: fc.id });
    expect(w.db.turiaClientLink.rows.find((l) => l.key === "gamma exports")).toMatchObject({ status: "manual", firmClientId: fc.id });
  });

  it("an ignored client is skipped", async () => {
    const w = world();
    await run(w, { env: { ...w.env, FIRM_OS_TURIA_PULL: "dry-run" } });
    await saveClientLink(w.adminDb, admin, { key: "acme traders private limited", action: "ignore" });
    const r = await run(w);
    expect(r.counts.waitingClient).toBe(1);
    expect(w.db.jobTask.rows).toHaveLength(0);
  });

  it("an unmatched assignee waits; a manual pick is kept over automatic matching", async () => {
    const w = world([rawTask({ id: "101", assignee: [{ id: "t-new", name: "N Kumar" }] })]);
    const r = await run(w);
    expect(r.counts.waitingPeople).toBe(1);
    expect(r.counts.unmatchedPeople).toBe(1);
    await savePersonLink(w.adminDb, admin, { turiaUserId: "t-new", userId: "u-priya" });
    await run(w);
    expect(jobOf(w, "101")).toMatchObject({ assigneeId: "u-priya" });
    expect(w.db.turiaPersonLink.rows.find((p) => p.turiaUserId === "t-new")).toMatchObject({ matchedBy: "manual", userId: "u-priya" });
  });

  it("a task with no assignee waits, and an inactive LMS user is never given a job", async () => {
    const w = world([rawTask({ id: "101", assignee: [] }), rawTask({ id: "102", assignee: [{ id: "t-old", name: "Old Staff" }] })]);
    const r = await run(w);
    expect(r.counts.waitingPeople).toBe(2);
    expect(w.db.jobTask.rows).toHaveLength(0);
  });
});

describe("sign-in, lock and limits", () => {
  it("no stored Turia sign-in: stops with the plain sentence and records the run", async () => {
    const w = world();
    const r = await run(w, { session: async () => ({ present: false, updatedAt: null }) });
    expect(r).toMatchObject({ status: "session", message: SESSION_MESSAGE });
    expect(w.turia.calls).toEqual([]);
    expect(w.db.turiaPullRun.rows[0]).toMatchObject({ status: "session", message: SESSION_MESSAGE });
    expect(w.db.auditEvent.rows[0]).toMatchObject({ action: "turia-pull.run", meta: expect.objectContaining({ status: "session" }) });
    expect(w.db.turiaPullLock.rows[0]).toMatchObject({ holder: null });
  });

  it("an expired sign-in part way: stops quietly with the same sentence", async () => {
    const w = world();
    w.turia.sessionExpired = true;
    const r = await run(w);
    expect(r).toMatchObject({ status: "session", message: SESSION_MESSAGE });
    expect(w.db.jobTask.rows).toHaveLength(0);
  });

  it("another unexpected failure stops with a plain sentence", async () => {
    const w = world();
    w.turia.taskPage = async () => {
      throw new Error("NEO_TURIA_ORG_ID is not set");
    };
    const r = await run(w);
    expect(r).toMatchObject({ status: "failed", message: FAILED_MESSAGE });
  });

  it("only one run at a time: a held lock answers busy without a run row; an expired lease is taken over", async () => {
    const w = world();
    w.db.turiaPullLock.rows.push({ id: 1, holder: "other", lockUntil: new Date("2026-11-06T06:00:00Z") });
    expect(await run(w)).toMatchObject({ status: "busy", message: BUSY_MESSAGE });
    expect(w.db.turiaPullRun.rows).toHaveLength(0);
    w.setNow(new Date("2026-11-06T06:01:00Z"));
    expect((await run(w)).status).toBe("ok");
  });

  it("stops at the time limit, keeping what it did", async () => {
    const w = world();
    w.turia.pages = [[rawTask({ id: "101" })], [rawTask({ id: "102" })], []];
    let t = new Date("2026-11-06T05:30:00Z").getTime();
    const r = await run(w, { now: () => new Date((t += 60_000)), limits: { perPage: 1, timeoutMs: 90_000 } });
    expect(r).toMatchObject({ status: "partial", message: TIMEOUT_MESSAGE, complete: false });
    expect(w.db.turiaTaskMirror.rows.length).toBeGreaterThan(0);
  });

  it("pages politely: 100 a page at most, a pause between pages, and stops on a short page", async () => {
    const w = world();
    w.turia.pages = [[rawTask({ id: "101" }), rawTask({ id: "102" })], [rawTask({ id: "103" })], [rawTask({ id: "104" })]];
    const pauses: number[] = [];
    const r = await run(w, { limits: { perPage: 2 }, sleep: async (ms) => void pauses.push(ms) });
    expect(w.turia.calls.filter((c) => c.startsWith("task/list"))).toEqual(["task/list p1 n2 createdon", "task/list p2 n2 createdon"]);
    expect(pauses).toEqual([400]);
    expect(r.counts.fetched).toBe(3);
  });

  it("with updatedon sorting and a recent full scan, stops at a page where nothing changed", async () => {
    const w = world();
    const at = (id: string, ms: number) => rawTask({ id, updatedon: ms });
    w.turia.pages = [[at("101", 5e12), at("102", 4e12)], [at("103", 3e12), at("104", 2e12)], [at("105", 1e12)]];
    await run(w, { limits: { perPage: 2 } });
    w.env.FIRM_OS_TURIA_PULL_SORT = "updatedon";
    w.turia.calls.length = 0;
    w.advance(60_000);
    const r = await run(w, { limits: { perPage: 2 } });
    expect(w.turia.calls.filter((c) => c.startsWith("task/list"))).toEqual(["task/list p1 n2 updatedon"]);
    expect(r.status).toBe("ok");
    expect(r.counts.missing).toBe(0);
  });
});
