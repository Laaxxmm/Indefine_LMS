// Agent runner, end to end with the echo agent: memory db + recorded router + fake SharePoint.
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { echoAgent } from "@/lib/agents/echo";
import { createRecordedRouter } from "./recorded-router";
import { INPUTS_RETENTION_DAYS, jobFolder, runAgent, type FirmDb } from "./runner";
import { staticInputSource } from "./inputs";
import { CLEAN_EXTRACT, GAP_REGISTER_CSV, NOW, REGISTER_CSV, PASS_VERDICT, RELATED_TASK, WORKING, echoWorld, rows } from "../../../../tests/fakes/agent-world";

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

    // The register is parsed by code: the only model calls are the related-party LLM rule, read
    // twice because echo marks it high-stakes (ADR-008): the second read pinned to HARD.
    expect(w.router.calls.map((c) => [c.task, c.taskVersion, c.runId, c.privacy, c.secondOpinion ?? false, c.forceTier ?? null])).toEqual([
      [RELATED_TASK, 1, "run-1", "anonymize-then-cloud", false, null],
      [RELATED_TASK, 1, "run-1", "anonymize-then-cloud", true, "HARD"],
    ]);
    expect(w.router.calls[0].messages[1].content).toContain("register.csv row 2: INV-1 | Acme Traders | 2026-10-05 | 15000.00");
    expect(rows(w.db, "auditEvent")).toEqual([
      expect.objectContaining({ action: "guardrail-run", entity: "AgentRun", entityId: "run-1", meta: expect.objectContaining({ agent: "echo", outcome: "ok", judgements: 1, agreementChecks: 1, disagreements: 0, scopeViolations: 0 }) }),
    ]);
  });

  it("raises block / warn / info failures and still finishes (approval is gated later)", async () => {
    const w = echoWorld({ register: GAP_REGISTER_CSV });
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok && out.summary.blockingFailures).toBe(1);
    expect(out.ok && out.figures).toEqual({ rowCount: 2, totalPaise: 21500000, largestPaise: 20000000 });
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
        if ((req.task as string) === RELATED_TASK) return { ...base, status: "needs-review", output: PASS_VERDICT as never, issues: ["low confidence"] };
        throw new Error(`unexpected task ${req.task}`);
      },
    };
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok && out.needsPartnerReview).toBe(true);
    expect(rows(w.db, "agentRun")[0].needsPartnerReview).toBe(true);
  });

  it("an LLM rule without a usable answer is recorded n/a for manual review; the run still completes", async () => {
    const w = echoWorld({ responses: {} });
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

  it("register row that code cannot parse (named with its row)", async () => {
    const csv = ["ref,party,date,amount", "INV-1,Acme Traders,2026-10-05,15000.00", "INV-2,Bright,2026-02-30,12ab"].join("\n");
    await expectFailed(echoWorld({ register: csv }), /register.csv row 3: date "2026-02-30" is not a YYYY-MM-DD calendar date; amount "12ab" is not a rupee amount/);
  });
  it("register with the wrong header", async () => {
    await expectFailed(echoWorld({ register: "invoice,customer,amount\nINV-1,Acme,10" }), /header must be ref,party,date,amount/);
  });
  it("register with blank cells", async () => {
    await expectFailed(echoWorld({ register: "ref,party,date,amount\n , ,2026-10-05,1.00" }), /register.csv row 2: ref is blank; party is blank/);
  });
  it("register with a header and no entries", async () => {
    await expectFailed(echoWorld({ register: "ref,party,date,amount\n" }), /has a header but no entries/);
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
    w.deps.inputs = staticInputSource([{ name: "register.csv", source: "fixture", bytes: Buffer.from(REGISTER_CSV) }]);
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

describe("runAgent — LLM evidence is checked against the documents the model was shown", () => {
  it("a verdict quoting text that is not in the register is rejected: na + llm-evidence-missing", async () => {
    const fabricated = { status: "fail", message: "Acme is the director's firm", evidence: { quote: "Acme Traders (director's firm)", location: "register.csv row 2" } };
    const w = echoWorld({ responses: { [RELATED_TASK]: fabricated } });
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok).toBe(true);
    const llm = rows(w.db, "checklistResult").find((r) => r.ruleId === "echo.related-party")!;
    expect(llm).toMatchObject({ status: "na", evidence: { flags: ["llm-evidence-missing"] } });
  });
  it("a verdict quoting the register (any case / spacing) is accepted", async () => {
    const w = echoWorld({ responses: { [RELATED_TASK]: { status: "fail", evidence: { quote: "acme   TRADERS", location: "register.csv row 2" } } } });
    await runAgent(echoAgent, "job-1", w.deps);
    expect(rows(w.db, "checklistResult").find((r) => r.ruleId === "echo.related-party")).toMatchObject({ status: "fail" });
  });
});

describe("runAgent — model trouble on the LLM rule is not a run failure", () => {
  it.each([
    ["queued for a human (local-only)", { status: "queued", reason: "local model down", needsPartnerReview: true, runId: "run-1", attempts: 0 }, /queued for a human: local model down/],
    ["output that fails the schema", { status: "needs-review", output: null, issues: ["status: Invalid enum value"], needsPartnerReview: true }, /Model output not usable/],
  ] as const)("%s → related-party is na + llm-error, the run completes", async (_n, answer, message) => {
    const w = echoWorld();
    w.deps.router = { run: async () => answer as never };
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok).toBe(true);
    const llm = rows(w.db, "checklistResult").find((r) => r.ruleId === "echo.related-party")!;
    expect(llm).toMatchObject({ status: "na", evidence: { flags: ["llm-error"] } });
    expect(llm.message).toMatch(message);
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
