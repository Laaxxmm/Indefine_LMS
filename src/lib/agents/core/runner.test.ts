// Agent runner, end to end with the echo agent: memory db + recorded router + fake SharePoint.
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ECHO_EXTRACT_TASK, echoAgent } from "@/lib/agents/echo";
import { createRecordedRouter } from "./recorded-router";
import { INPUTS_RETENTION_DAYS, jobFolder, runAgent, type FirmDb } from "./runner";
import { staticInputSource } from "./inputs";
import { CLEAN_EXTRACT, GAP_EXTRACT, NOW, PASS_VERDICT, RELATED_TASK, WORKING, echoWorld, rows } from "../../../../tests/fakes/agent-world";

// Compile-time: the real Prisma client satisfies the runner's database type.
export const _prismaFits = (p: PrismaClient): FirmDb => p;

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe("runAgent — happy path", () => {
  it("ASSIGNED → IN_PREP → AGENT_DONE with checklist, figures, Working deliverable and cached inputs", async () => {
    const w = echoWorld();
    const out = await runAgent(echoAgent, "job-1", w.deps, { startedById: "u-priya" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out).toMatchObject({ runId: "run-1", attempt: 1, figures: { rowCount: 3, totalPaise: 4745649, largestPaise: 2345650 }, needsPartnerReview: false });
    expect(out.summary).toMatchObject({ total: 4, blockingFailures: 0, byStatus: { pass: 4, fail: 0, na: 0 } });

    const job = rows(w.db, "jobTask")[0];
    expect(job.state).toBe("AGENT_DONE");
    expect(rows(w.db, "jobTaskEvent").map((e) => [e.fromState, e.toState, e.actorId])).toEqual([
      ["ASSIGNED", "IN_PREP", "agent:run-1"],
      ["IN_PREP", "AGENT_DONE", "agent:run-1"],
    ]);

    const run = rows(w.db, "agentRun")[0];
    expect(run).toMatchObject({ id: "run-1", agent: "echo", status: "AGENT_DONE", attempt: 1, sopPackVersion: "1.0.0", startedById: "u-priya", error: null });
    expect((run.inputsPurgeAt as Date).getTime() - (run.finishedAt as Date).getTime()).toBeLessThanOrEqual(INPUTS_RETENTION_DAYS * 86_400_000);
    expect((run.inputsPurgeAt as Date).getTime()).toBeGreaterThan(NOW.getTime() + (INPUTS_RETENTION_DAYS - 1) * 86_400_000);
    expect(run.inputs).toEqual({ files: [{ name: "register.csv", source: "client-docs", sizeBytes: expect.any(Number) }], extracted: CLEAN_EXTRACT });

    const results = rows(w.db, "checklistResult");
    expect(results.map((r) => [r.ruleId, r.severity, r.status, r.source])).toEqual([
      ["echo.duplicate-refs", "block", "pass", "deterministic"],
      ["echo.round-amounts", "warn", "pass", "deterministic"],
      ["echo.weekend-dates", "info", "pass", "deterministic"],
      ["echo.related-party", "warn", "pass", "llm"],
    ]);
    expect(results[3].evidence).toEqual({ quote: "Acme Traders", location: "register.csv row 2" });

    const [d] = rows(w.db, "deliverable");
    expect(d).toMatchObject({
      jobTaskId: "job-1",
      agentRunId: "run-1",
      kind: "Working",
      name: "ACME01_Echo-register_2026-10_v1.xlsx",
      spPath: "/sites/CL-ACME01/Compliance/FY2026-27/Books/2026-10/Working",
      driveId: w.drive.id,
      version: 1,
    });
    const file = w.fake.fileContent(w.drive, `${WORKING}/ACME01_Echo-register_2026-10_v1.xlsx`)!;
    expect(d.sha256).toBe(sha(file));
    expect(d.sizeBytes).toBe(file.length);
    expect(w.fake.violations).toEqual([]);

    expect(w.router.calls.map((c) => [c.task, c.runId, c.privacy])).toEqual([
      [ECHO_EXTRACT_TASK, "run-1", "anonymize-then-cloud"],
      [RELATED_TASK, "run-1", "anonymize-then-cloud"],
    ]);
    expect(w.router.calls[1].messages[1].content).toContain("register.csv row 2: INV-1 | Acme Traders | 2026-10-05 | 15000.00");
  });

  it("raises block / warn / info failures and still finishes (approval is gated later)", async () => {
    const w = echoWorld({ responses: { [ECHO_EXTRACT_TASK]: GAP_EXTRACT, [RELATED_TASK]: PASS_VERDICT } });
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok && out.summary.blockingFailures).toBe(1);
    const failed = rows(w.db, "checklistResult").filter((r) => r.status === "fail").map((r) => [r.ruleId, r.severity]);
    expect(failed).toEqual([
      ["echo.duplicate-refs", "block"],
      ["echo.round-amounts", "warn"],
      ["echo.weekend-dates", "info"],
    ]);
    expect(rows(w.db, "checklistResult")[0].evidence).toEqual({ quote: "INV-1", location: "register.csv row 2 and register.csv row 3" });
  });

  it("starts from IN_PREP without a second start-prep event", async () => {
    const w = echoWorld({ jobState: "IN_PREP" });
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok).toBe(true);
    expect(rows(w.db, "jobTaskEvent").map((e) => e.toState)).toEqual(["AGENT_DONE"]);
  });

  it("a model answer flagged for review is used and marks the run needsPartnerReview", async () => {
    const w = echoWorld();
    w.deps.router = {
      async run(req) {
        const base = { provider: "claude", model: "m", confidence: 0.5, escalated: true, anonymized: true, tokensIn: 1, tokensOut: 1, costInr: 0, attempts: 3, needsPartnerReview: true } as const;
        if (req.task === ECHO_EXTRACT_TASK) return { ...base, status: "needs-review", output: CLEAN_EXTRACT as never, issues: ["low confidence"] };
        return { ...base, status: "ok", output: PASS_VERDICT as never };
      },
    };
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok && out.needsPartnerReview).toBe(true);
    expect(rows(w.db, "agentRun")[0].needsPartnerReview).toBe(true);
  });

  it("an LLM rule without a usable answer is recorded n/a for manual review; the run still completes", async () => {
    const w = echoWorld({ responses: { [ECHO_EXTRACT_TASK]: CLEAN_EXTRACT } });
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok).toBe(true);
    const llm = rows(w.db, "checklistResult").find((r) => r.ruleId === "echo.related-party")!;
    expect(llm.status).toBe("na");
    expect(llm.evidence).toEqual({ flags: ["llm-error"] });
  });

  it("re-run takes the next attempt number and the next free _v{n} in Working", async () => {
    const w = echoWorld({ jobState: "IN_PREP" });
    w.fake.addFile(w.drive, `${WORKING}/ACME01_Echo-register_2026-10_v2.xlsx`, "left by a failed upload");
    await w.db.agentRun.create({ data: { id: "old", jobTaskId: "job-1", agent: "echo", sopPackVersion: "1.0.0", status: "FAILED", startedAt: NOW } });
    const out = await runAgent(echoAgent, "job-1", w.deps, { notes: "  check INV-2 amount  " });
    expect(out.ok && out.attempt).toBe(2);
    expect(out.ok && out.deliverables[0].name).toBe("ACME01_Echo-register_2026-10_v3.xlsx");
    expect(rows(w.db, "agentRun")[1].reviewNotes).toBe("check INV-2 amount");
    expect(w.router.calls[0].messages[1].content).toContain("Reviewer notes: check INV-2 amount");
  });
});

describe("runAgent — preconditions (no run is recorded)", () => {
  it.each([
    ["unknown job", {}, "job-x", "NOT_FOUND"],
    ["wrong service", { service: "GST" }, "job-1", "WRONG_SERVICE"],
    ["job not ready", { jobState: "DRAFT" }, "job-1", "NOT_READY"],
    ["job already reviewed", { jobState: "IN_REVIEW" }, "job-1", "NOT_READY"],
    ["no SOP pack", { pack: false }, "job-1", "NO_SOP_PACK"],
  ] as const)("%s → %s", async (_n, opts, id, code) => {
    const w = echoWorld(opts);
    const out = await runAgent(echoAgent, id, w.deps);
    expect(out).toMatchObject({ ok: false, code });
    expect(rows(w.db, "agentRun")).toHaveLength(0);
  });
});

describe("runAgent — failure path (run FAILED, job stays IN_PREP)", () => {
  async function expectFailed(w: ReturnType<typeof echoWorld>, reason: RegExp, def = echoAgent) {
    const out = await runAgent(def, "job-1", w.deps);
    expect(out).toMatchObject({ ok: false, code: "FAILED", runId: "run-1" });
    expect(!out.ok && out.reason).toMatch(reason);
    const run = rows(w.db, "agentRun")[0];
    expect(run.status).toBe("FAILED");
    expect(run.error).toMatch(reason);
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(rows(w.db, "jobTask")[0].state).toBe("IN_PREP");
    expect(rows(w.db, "checklistResult")).toHaveLength(0);
    expect(rows(w.db, "deliverable")).toHaveLength(0);
    return run;
  }

  it("model has no answer for extraction", async () => {
    await expectFailed(echoWorld({ responses: {} }), /No recorded model response for task "system.echo-extract"/);
  });
  it("model call queued for a human (local-only)", async () => {
    const w = echoWorld();
    w.deps.router = { run: async () => ({ status: "queued", reason: "local model down", needsPartnerReview: true, runId: "run-1", attempts: 0 }) };
    await expectFailed(w, /queued for a human: local model down/);
  });
  it("model output that fails the schema", async () => {
    await expectFailed(echoWorld({ responses: { [ECHO_EXTRACT_TASK]: { rows: [{ ref: "A" }] } } }), /Model output not usable/);
  });
  it("input file missing from ClientDocs", async () => {
    await expectFailed(echoWorld({ register: null }), /register.csv is missing/);
  });
  it("input file empty", async () => {
    await expectFailed(echoWorld({ register: "  " }), /register.csv is empty/);
  });
  it("compute returns a non-integer figure", async () => {
    await expectFailed(echoWorld(), /non-integer figure total=1.5/, { ...echoAgent, compute: () => ({ total: 1.5 }) });
  });
  it("SOP pack names a check that has no implementation", async () => {
    const w = echoWorld({ pack: false });
    w.db.seed("sopPack", [
      { key: "echo", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Echo", checklist: { schemaVersion: 1, key: "echo", version: "1.0.0", rules: [{ id: "echo.x", title: "X", severity: "block", kind: "deterministic", check: "echo.nope", evidence: "e" }] } },
    ]);
    await expectFailed(w, /cannot be used: rule echo.x: no deterministic implementation/);
  });
  it("client Compliance library not provisioned", async () => {
    const w = echoWorld();
    w.deps.inputs = staticInputSource([{ name: "register.csv", source: "fixture", bytes: Buffer.from("x") }]);
    w.fake.sites.clear();
    await expectFailed(w, /does not exist yet/);
  });
  it("job moved by someone else while the agent worked", async () => {
    const w = echoWorld({ jobState: "IN_PREP" });
    const inner = w.deps.inputs;
    w.deps.inputs = {
      async gather(req) {
        await w.db.jobTask.update({ where: { id: "job-1" }, data: { state: "IN_REVIEW" } });
        return inner.gather(req);
      },
    };
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out).toMatchObject({ ok: false, code: "FAILED" });
    expect(!out.ok && out.reason).toMatch(/could not move to AGENT_DONE/);
    expect(rows(w.db, "agentRun")[0].status).toBe("FAILED");
  });
});

describe("helpers", () => {
  it("jobFolder resolves Path A folders and validates the period", () => {
    expect(jobFolder({ clientCode: "ACME01", fy: "2026-27", service: "GST", period: "Q2" }, "Final").path).toBe("FY2026-27/GST/Q2/Final");
    expect(() => jobFolder({ clientCode: "ACME01", fy: "2026-27", service: "GST", period: "2027-04" }, "Final")).toThrow();
  });
  it("recorded router: functions and schema-less requests", async () => {
    const r = createRecordedRouter((_req, n) => `answer ${n}`);
    const res = await r.run({ task: "system.x", privacy: "public", difficulty: "sop", messages: [], runId: "r" });
    expect(res).toMatchObject({ status: "ok", output: "answer 1" });
  });
});
