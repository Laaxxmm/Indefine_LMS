// Chaos: the local open-weight model is down (Week 1: LOCAL_LLM_BASE_URL empty; or set but the
// Phase-2b provider not wired, so the stub fails closed mid-call).
// What a person sees: a `privacy: 'local-only'` task is QUEUED FOR A HUMAN with the reason, and
// not one byte goes to a cloud model (payload spies on Claude and on the real Grok provider); an
// agent run that needs such a task stops with "Model call queued for a human: …" and leaves the
// job in preparation. A non-PII task falls back to Claude's fast tier, masked.
import { describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { z } from "zod";
import { detectPii } from "@/lib/ai/anonymizer";
import { runAgent } from "@/lib/agents/core/runner";
import { echoWorld, rows, WORKING } from "../fakes/agent-world";
import { CHAOS_PACK, claudeOk, modelCallingAgent, modelWorld } from "./support/model-world";

const QUEUE_REASON = "privacy is local-only and the local model is unavailable; queued for a human.";
const PII_TASK = {
  task: "books.read-bank-statement" as const,
  privacy: "local-only" as const,
  difficulty: "sop" as const,
  runId: "run-local",
  schema: z.object({ n: z.number() }),
  messages: [{ role: "user" as const, content: "Read the bank statement of AAACE1234F, a/c 50100234567890 IFSC HDFC0001234, phone +91 98765 43210." }],
};

describe("local-only task, local model down", () => {
  it("LOCAL_LLM_BASE_URL empty → queued for a human; zero cloud calls (Claude AND Grok configured)", async () => {
    const m = modelWorld({ claude: [claudeOk({ output: { n: 1 }, confidence: 1 })], grok: () => ({ output: { n: 1 }, confidence: 1 }) });
    const r = await m.router.run(PII_TASK);
    expect(r).toEqual({ status: "queued", reason: QUEUE_REASON, needsPartnerReview: true, runId: "run-local", attempts: 0 });
    expect(m.claude.requests).toHaveLength(0);
    expect(m.xai.bodies).toHaveLength(0);
    expect(m.rows.map((x) => [x.provider, x.status, x.anonymized])).toEqual([[null, "QUEUED_FOR_HUMAN", false]]);
    expect(m.rows[0].error).toBe(QUEUE_REASON);
  });

  it("LOCAL_LLM_BASE_URL set but the stub fails closed mid-call → still queued, still zero cloud calls (never falls through to cloud)", async () => {
    const m = modelWorld({ claude: [claudeOk({ output: { n: 1 }, confidence: 1 })], grok: () => ({ output: { n: 1 }, confidence: 1 }), localBaseUrl: "http://10.0.0.5:11434/v1" });
    const r = await m.router.run(PII_TASK);
    expect(r.status).toBe("queued");
    expect(m.claude.requests).toHaveLength(0);
    expect(m.xai.bodies).toHaveLength(0);
    expect(m.rows.map((x) => [x.provider, x.tier, x.status])).toEqual([
      ["local", "LOCAL", "PROVIDER_ERROR"],
      [null, null, "QUEUED_FOR_HUMAN"],
    ]);
    expect(m.rows[0].error).toMatch(/not wired yet \(Phase 2b\); failing closed/);
  });

  it("an agent step that needs a local-only read stops the run with the queue reason; the job stays IN_PREP, nothing reaches Working or a cloud model", async () => {
    const w = echoWorld({ pack: false });
    w.db.seed("sopPack", [CHAOS_PACK]);
    const m = modelWorld({ claude: [claudeOk({ output: { n: 1 }, confidence: 1 })] });
    const out = await runAgent(modelCallingAgent({ calls: 1, privacy: "local-only" }), "job-1", { ...w.deps, router: m.router }, { startedById: "u-priya" });
    expect(out).toEqual({ ok: false, code: "FAILED", runId: "run-1", reason: `Model call queued for a human: ${QUEUE_REASON}` });
    expect(rows(w.db, "agentRun")[0]).toMatchObject({ status: "FAILED", error: `Model call queued for a human: ${QUEUE_REASON}` });
    expect(rows(w.db, "jobTask")[0].state).toBe("IN_PREP"); // the preparer can run it again once local is up
    expect(rows(w.db, "deliverable")).toEqual([]);
    expect(w.fake.filesIn(w.drive, WORKING)).toEqual([]);
    expect(m.claude.requests).toHaveLength(0);
  });
});

describe("non-PII task, local model down", () => {
  it("falls back to Claude's fast tier with the anonymizer on; the payload carries no client PII", async () => {
    const m = modelWorld({ claude: [claudeOk({ output: { n: 2 }, confidence: 0.9 })] });
    const r = await m.router.run({ ...PII_TASK, privacy: "anonymize-then-cloud" });
    expect(r).toMatchObject({ status: "ok", output: { n: 2 }, provider: "claude", anonymized: true });
    expect(m.rows[0]).toMatchObject({ provider: "claude", tier: "FAST", model: "claude-haiku-5-5", anonymized: true, status: "OK" });
    const sent = JSON.stringify(m.claude.requests[0].messages);
    expect(detectPii(sent)).toEqual([]);
    for (const raw of ["AAACE1234F", "50100234567890", "HDFC0001234", "98765 43210"]) expect(sent).not.toContain(raw);
  });
});
