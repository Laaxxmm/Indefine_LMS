// Review flow through the service layer: run → submit → request changes (re-run with notes) →
// approve (Working → Final with version suffix), plus access denial and the Final-copy retry.
import { describe, expect, it } from "vitest";
import { parseEchoRegister } from "@/lib/agents/echo";
import {
  addComment,
  approvePack,
  decideMistakeFor,
  defaultAgentDeps,
  finalizeRun,
  logMistake,
  previewDeliverable,
  readDeliverable,
  requestChanges,
  startAgentRun,
  submitForReview,
} from "./service";
import { CLEAN_EXTRACT, FINAL, GAP_REGISTER_CSV, PASS_VERDICT, REGISTER_CSV, RELATED_TASK, WORKING, echoWorld, rows, user } from "../../../tests/fakes/agent-world";

const job = (w: ReturnType<typeof echoWorld>) => rows(w.db, "jobTask")[0];

async function toReview(w: ReturnType<typeof echoWorld>) {
  expect(await startAgentRun(user("priya"), "echo", "job-1", w.deps)).toEqual({ ok: true, data: { runId: "run-1", status: "AGENT_DONE" } });
  expect(await submitForReview(user("priya"), "run-1", w.deps)).toEqual({ ok: true, data: { state: "IN_REVIEW" } });
}

describe("staff access", () => {
  it("someone not on the job cannot see or act on it (404, not 403, so it does not leak)", async () => {
    const w = echoWorld();
    expect(await startAgentRun(user("outsider"), "echo", "job-1", w.deps)).toMatchObject({ ok: false, status: 404 });
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    for (const r of [
      await submitForReview(user("outsider"), "run-1", w.deps),
      await requestChanges(user("outsider"), "run-1", "x", w.deps),
      await approvePack(user("outsider"), "run-1", null, w.deps),
      await addComment(user("outsider"), "run-1", "hi", w.deps),
      await readDeliverable(user("outsider"), (rows(w.db, "deliverable")[0].id as string), w.deps),
    ]) {
      expect(r).toMatchObject({ ok: false, status: 404 });
    }
    expect(job(w).state).toBe("AGENT_DONE");
  });

  it("the reviewer (staff) can see the job but cannot run the agent", async () => {
    const w = echoWorld();
    expect(await startAgentRun(user("ravi"), "echo", "job-1", w.deps)).toMatchObject({ ok: false, status: 403 });
    expect(rows(w.db, "agentRun")).toHaveLength(0);
  });

  it("inactive users and unknown agents / jobs are refused", async () => {
    const w = echoWorld();
    expect(await startAgentRun(user("priya", { active: false }), "echo", "job-1", w.deps)).toMatchObject({ ok: false, status: 404 });
    expect(await startAgentRun(user("priya"), "no-such-agent", "job-1", w.deps)).toMatchObject({ ok: false, status: 404 });
    expect(await startAgentRun(user("meera"), "echo", "job-x", w.deps)).toMatchObject({ ok: false, status: 404 });
  });

  it("a manager may run the agent on someone else's job", async () => {
    const w = echoWorld();
    expect(await startAgentRun(user("meera"), "echo", "job-1", w.deps)).toMatchObject({ ok: true });
  });

  it("the assignee cannot approve their own pack", async () => {
    const w = echoWorld();
    await toReview(w);
    expect(await approvePack(user("priya"), "run-1", null, w.deps)).toMatchObject({ ok: false, status: 403 });
    expect(job(w).state).toBe("IN_REVIEW");
  });
});

describe("review flow", () => {
  it("request changes → IN_PREP, a new attempt runs with the note, Working gets _v2", async () => {
    const w = echoWorld();
    await toReview(w);
    expect(await requestChanges(user("ravi"), "run-1", "   ", w.deps)).toMatchObject({ ok: false, status: 400 });
    const out = await requestChanges(user("ravi"), "run-1", "INV-2 looks doubled", w.deps);
    expect(out).toEqual({ ok: true, data: { runId: "run-2", status: "AGENT_DONE" } });
    const [r1, r2] = rows(w.db, "agentRun");
    expect(r1).toMatchObject({ status: "CHANGES_REQUESTED", reviewNotes: "INV-2 looks doubled" });
    expect(r2).toMatchObject({ attempt: 2, status: "AGENT_DONE", reviewNotes: "INV-2 looks doubled", startedById: "u-ravi" });
    // Echo makes no extraction call (the register is parsed by code); the notes ride on the run.
    // Echo reads its high-stakes related-party rule twice per run (ADR-008 agreement).
    expect(w.router.calls.map((c) => c.runId)).toEqual(["run-1", "run-1", "run-2", "run-2"]);
    expect(w.fake.filesIn(w.drive, WORKING)).toEqual(["ACME01_Echo-register_2026-10_v1.xlsx", "ACME01_Echo-register_2026-10_v2.xlsx"]);
    expect(job(w).state).toBe("AGENT_DONE");
    expect(rows(w.db, "jobTaskEvent").map((e) => e.toState)).toEqual(["IN_PREP", "AGENT_DONE", "IN_REVIEW", "IN_PREP", "AGENT_DONE"]);
    // Acting on the superseded run is refused.
    expect(await submitForReview(user("priya"), "run-1", w.deps)).toMatchObject({ ok: false, status: 409 });
  });

  it("approve → APPROVED; Working files copied to Final with a version suffix and Final rows", async () => {
    const w = echoWorld();
    await toReview(w);
    // An earlier approval of this period already left v1 in Final: never overwritten.
    w.fake.addFile(w.drive, `${FINAL}/ACME01_Echo-register_2026-10_v1.xlsx`, "earlier approved pack");
    const out = await approvePack(user("ravi"), "run-1", null, w.deps);
    expect(out).toEqual({ ok: true, data: { state: "APPROVED", final: ["ACME01_Echo-register_2026-10_v2.xlsx"] } });
    expect(job(w).state).toBe("APPROVED");
    expect(rows(w.db, "agentRun")[0].status).toBe("APPROVED");
    expect(w.fake.fileContent(w.drive, `${FINAL}/ACME01_Echo-register_2026-10_v1.xlsx`)?.toString()).toBe("earlier approved pack");
    const [working, final] = rows(w.db, "deliverable");
    expect(final).toMatchObject({ kind: "Final", name: "ACME01_Echo-register_2026-10_v2.xlsx", version: 2, spPath: "/sites/CL-ACME01/Compliance/FY2026-27/Books/2026-10/Final", sha256: working.sha256 });
    expect(w.fake.fileContent(w.drive, `${FINAL}/ACME01_Echo-register_2026-10_v2.xlsx`)?.equals(w.fake.fileContent(w.drive, `${WORKING}/ACME01_Echo-register_2026-10_v1.xlsx`)!)).toBe(true);
    expect(w.fake.violations).toEqual([]);
    // Idempotent: a retry adds nothing.
    expect(await finalizeRun(user("ravi"), "run-1", w.deps)).toEqual({ ok: true, data: { state: "APPROVED", final: ["ACME01_Echo-register_2026-10_v2.xlsx"] } });
    expect(rows(w.db, "deliverable")).toHaveLength(2);
  });

  it("block failures: the reviewer cannot approve; a partner needs a note", async () => {
    const w = echoWorld({ register: GAP_REGISTER_CSV, responses: { [RELATED_TASK]: PASS_VERDICT } });
    await toReview(w);
    expect(await approvePack(user("ravi"), "run-1", null, w.deps)).toMatchObject({ ok: false, status: 403 });
    expect(await approvePack(user("partner"), "run-1", null, w.deps)).toMatchObject({ ok: false, status: 400 });
    expect(await approvePack(user("partner"), "run-1", "Duplicate is a credit note, verified", w.deps)).toMatchObject({ ok: true });
  });

  it("Final copy failure → 502 with a retry; the retry completes it", async () => {
    const w = echoWorld();
    await toReview(w);
    const real = w.deps.store.copyVersioned;
    w.deps.store = { ...w.deps.store, copyVersioned: async () => { throw new Error("Graph 503"); } };
    expect(await approvePack(user("ravi"), "run-1", null, w.deps)).toMatchObject({ ok: false, status: 502, error: expect.stringMatching(/Copy to Final/) });
    expect(job(w).state).toBe("APPROVED");
    w.deps.store = { ...w.deps.store, copyVersioned: real };
    expect(await finalizeRun(user("ravi"), "run-1", w.deps)).toMatchObject({ ok: true, data: { final: ["ACME01_Echo-register_2026-10_v1.xlsx"] } });
  });

  it("refuses Final copies before approval, and when Working bytes changed since the run", async () => {
    const w = echoWorld();
    await toReview(w);
    expect(await finalizeRun(user("ravi"), "run-1", w.deps)).toMatchObject({ ok: false, status: 409 });
    w.deps.store = { ...w.deps.store, copyVersioned: async (...a) => ({ ...(await echoWorld().deps.store.putNew(w.drive.id, a[3], a[2], Buffer.from("tampered"))), driveId: w.drive.id }) };
    expect(await approvePack(user("ravi"), "run-1", null, w.deps)).toMatchObject({ ok: false, status: 502 });
  });

  it("submit / request changes / approve from the wrong state are conflicts", async () => {
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    expect(await approvePack(user("ravi"), "run-1", null, w.deps)).toMatchObject({ ok: false, status: 409 });
    expect(await requestChanges(user("ravi"), "run-1", "x", w.deps)).toMatchObject({ ok: false, status: 409 });
    await submitForReview(user("priya"), "run-1", w.deps);
    expect(await submitForReview(user("priya"), "run-1", w.deps)).toMatchObject({ ok: false, status: 409 });
    expect(await requestChanges(user("priya"), "run-1", "x", w.deps)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("comments, mistakes and files", () => {
  it("adds comments as audit events", async () => {
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    expect(await addComment(user("ravi"), "run-1", "  ", w.deps)).toMatchObject({ ok: false, status: 400 });
    expect(await addComment(user("ravi"), "run-1", "Check INV-3", w.deps)).toMatchObject({ ok: true });
    expect(rows(w.db, "auditEvent").find((e) => e.action === "comment")).toMatchObject({ actorId: "u-ravi", action: "comment", entity: "AgentRun", entityId: "run-1", meta: { text: "Check INV-3" } });
  });

  it("logs a mistake and lets only a partner / manager decide it", async () => {
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    const proposal = { id: "echo.big-invoice", title: "Invoices above ₹20,000", severity: "warn", kind: "deterministic", check: "echo.amount-over", evidence: "row", params: { limitPaise: 2000000 } };
    expect(await logMistake(user("ravi"), "run-1", { finding: "", ruleProposal: proposal }, w.deps)).toMatchObject({ ok: false, status: 400 });
    const r = await logMistake(user("ravi"), "run-1", { finding: "Missed INV-2 above limit", ruleProposal: proposal }, w.deps);
    expect(r.ok).toBe(true);
    expect(await logMistake(user("ravi"), "run-1", { finding: "again", ruleProposal: proposal }, w.deps)).toMatchObject({ ok: false, status: 409 });
    const id = (r as { data: { id: string } }).data.id;
    expect(await decideMistakeFor(user("ravi"), id, "approve", w.deps)).toMatchObject({ ok: false, status: 403 });
    expect(await decideMistakeFor(user("admin"), id, "approve", w.deps)).toMatchObject({ ok: false, status: 403 });
    expect(await decideMistakeFor(user("meera"), "nope", "approve", w.deps)).toMatchObject({ ok: false, status: 404 });
    expect(await decideMistakeFor(user("meera"), id, "approve", w.deps)).toEqual({ ok: true, data: { status: "APPROVED", promotedToVersion: "1.1.0" } });
    expect(await decideMistakeFor(user("partner"), id, "reject", w.deps)).toMatchObject({ ok: false, status: 409 });
    expect(await logMistake(user("outsider"), "run-1", { finding: "x", ruleProposal: proposal }, w.deps)).toMatchObject({ ok: false, status: 404 });
  });

  it("reads and previews the XLSX deliverable", async () => {
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    const id = rows(w.db, "deliverable")[0].id as string;
    const f = await readDeliverable(user("ravi"), id, w.deps);
    expect(f.ok && f.data.name).toBe("ACME01_Echo-register_2026-10_v1.xlsx");
    const p = await previewDeliverable(user("ravi"), id, w.deps);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.data.sheets.map((s) => s.name)).toEqual(["Register", "Summary"]);
    const reg = p.data.sheets[0].rows;
    expect(reg[10]).toEqual(["Ref", "Party", "Date", "Amount"]);
    expect(reg[11]).toEqual(["INV-1", "Acme Traders", "05 Oct 2026", "15,000.00"]);
    expect(reg[14]).toEqual(["Total", "", "", "47,456.49"]);
    expect(await readDeliverable(user("ravi"), "missing", w.deps)).toMatchObject({ ok: false, status: 404 });
  });

  it("file gone from SharePoint → 404; SharePoint down → 502; DOCX has no preview", async () => {
    const w = echoWorld();
    await startAgentRun(user("priya"), "echo", "job-1", w.deps);
    const id = rows(w.db, "deliverable")[0].id as string;
    w.deps.store = { ...w.deps.store, read: async () => null };
    expect(await readDeliverable(user("ravi"), id, w.deps)).toMatchObject({ ok: false, status: 404 });
    w.deps.store = { ...w.deps.store, read: async () => { throw new Error("down"); } };
    expect(await previewDeliverable(user("ravi"), id, w.deps)).toMatchObject({ ok: false, status: 502 });
    await w.db.deliverable.update({ where: { id }, data: { name: "x.docx" } });
    w.deps.store = { ...w.deps.store, read: async () => Buffer.from("docx") };
    expect(await previewDeliverable(user("ravi"), id, w.deps)).toMatchObject({ ok: false, status: 400 });
    await w.db.deliverable.update({ where: { id }, data: { name: "x.xlsx" } });
    expect(await previewDeliverable(user("ravi"), id, w.deps)).toMatchObject({ ok: false, status: 502 });
  });

  it("CLEAN_EXTRACT fixture is consistent with the register", () => {
    expect(parseEchoRegister(REGISTER_CSV)).toEqual({ rows: CLEAN_EXTRACT.rows, errors: [] });
  });
});

describe("defaultAgentDeps", () => {
  // The first call cold-imports the whole production wiring (Prisma client, router, SharePoint,
  // every registered agent). Alone it takes ~1.6 s; under full-suite load it exceeded the 5 s
  // default once. There is no race to fix — only import time — so this test gets 30 s.
  it("builds production wiring lazily and caches it", { timeout: 60_000 }, async () => {
    const a = await defaultAgentDeps();
    expect(await defaultAgentDeps()).toBe(a);
    expect(typeof a.router.run).toBe("function");
    expect(a.ids()).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.now()).toBeInstanceOf(Date);
  });
});
