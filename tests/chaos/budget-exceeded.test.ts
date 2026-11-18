// Chaos: the AI budget runs out in the middle of an agent run (AI_DAILY_BUDGET_INR for the IST
// day, or the per-run maxCostInr). Real runner + real router; Claude answers through the contract fake.
// What a person sees: the run is FAILED with "Daily AI budget is exhausted: ₹… spent today (IST)
// of ₹… allowed" (or the per-run message), the job stays IN_PREP so the preparer can run it again,
// no half-made pack sits in Working, and the refused call is in the model log as BUDGET_REFUSED.
// Next IST day the same job runs to AGENT_DONE. A budget refusal inside an LLM checklist rule
// turns that rule into "check by hand" with the reason; onboarding falls back to questions.
import { describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { BudgetExceededError } from "@/lib/ai/errors";
import { runAgent } from "@/lib/agents/core/runner";
import { echoAgent } from "@/lib/agents/echo";
import { extractSpec } from "@/lib/agents/onboarding/extract";
import { echoWorld, rows, WORKING } from "../fakes/agent-world";
import { CHAOS_PACK, MODEL_NOW, claudeOk, modelCallingAgent, modelWorld } from "./support/model-world";

const ONE_CALL_INR = 0.176; // 10,000 in + 2,000 out on claude-haiku-5-5 at ₹88/USD
const ok = (n: number) => claudeOk({ output: { n }, confidence: 0.95 });
const EARLIER_TODAY = new Date("2026-11-05T03:30:00.000Z"); // 09:00 IST, same IST day as MODEL_NOW

function chaosRun(m: ReturnType<typeof modelWorld>, agent = modelCallingAgent({ calls: 2 })) {
  const w = echoWorld({ pack: false });
  w.db.seed("sopPack", [CHAOS_PACK]);
  return { w, run: () => runAgent(agent, "job-1", { ...w.deps, router: m.router }, { startedById: "u-priya" }) };
}

describe("daily budget (AI_DAILY_BUDGET_INR) exhausted mid-run", () => {
  it("the second model call is refused: run FAILED with the budget message, job IN_PREP, nothing in Working, refusal logged", async () => {
    let now = MODEL_NOW;
    const m = modelWorld({
      claude: [ok(4), ok(5), ok(6)], // the refused call never consumes a reply
      env: { AI_DAILY_BUDGET_INR: "10" },
      seed: [{ at: EARLIER_TODAY, costInr: 9.99 }], // other runs today
      now: () => now,
    });
    const { w, run } = chaosRun(m);
    const out = await run();

    expect(out).toMatchObject({ ok: false, code: "FAILED", runId: "run-1" });
    const reason = (out as { reason: string }).reason;
    expect(reason).toBe("Daily AI budget is exhausted: ₹10.17 spent today (IST) of ₹10.00 allowed (AI_DAILY_BUDGET_INR).");
    expect(rows(w.db, "agentRun")[0]).toMatchObject({ status: "FAILED", error: reason }); // shown on the run page
    expect(rows(w.db, "jobTask")[0].state).toBe("IN_PREP");
    expect(rows(w.db, "deliverable")).toEqual([]);
    expect(w.fake.filesIn(w.drive, WORKING)).toEqual([]);
    expect(m.claude.requests).toHaveLength(1); // the refused call never left the building
    expect(m.rows.slice(1).map((r) => [r.task, r.status, r.costInr])).toEqual([
      ["books.chaos-step-1", "OK", ONE_CALL_INR],
      ["books.chaos-step-2", "BUDGET_REFUSED", 0],
    ]);

    // Next IST day: yesterday's spend no longer counts; the preparer runs it again → AGENT_DONE.
    now = new Date(MODEL_NOW.getTime() + 24 * 3_600_000);
    const again = await run();
    expect(again).toMatchObject({ ok: true, attempt: 2, figures: { calls: 2 } });
    expect(rows(w.db, "jobTask")[0].state).toBe("AGENT_DONE");
    expect(w.fake.filesIn(w.drive, WORKING)).toEqual(["ACME01_Chaos-probe_2026-10_v2.xlsx"]);
  });
});

describe("per-run budget (maxCostInr) exhausted mid-run", () => {
  it("the run stops with the per-run message and the same clean state", async () => {
    const m = modelWorld({ claude: [ok(4), ok(5)] });
    const { w, run } = chaosRun(m, modelCallingAgent({ calls: 2, maxCostInr: 0.1 }));
    const out = await run();
    expect(out).toMatchObject({ ok: false, code: "FAILED", reason: "AI budget for this run is exhausted: ₹0.18 spent of ₹0.10 allowed (maxCostInr)." });
    expect(rows(w.db, "jobTask")[0].state).toBe("IN_PREP");
    expect(rows(w.db, "deliverable")).toEqual([]);
    expect(m.rows.map((r) => r.status)).toEqual(["OK", "BUDGET_REFUSED"]);
  });

  it("the router raises a typed BudgetExceededError (scope run, limit, spent) — callers can tell it from an outage", async () => {
    const m = modelWorld({ claude: [ok(1)], seed: [{ at: EARLIER_TODAY, costInr: 1, runId: "r-9" }] });
    const err = await m.router
      .run({ task: "books.classify", privacy: "anonymize-then-cloud", difficulty: "sop", runId: "r-9", maxCostInr: 0.5, messages: [{ role: "user", content: "x" }] })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(err).toMatchObject({ scope: "run", limitInr: 0.5, spentInr: 1 });
    expect(m.claude.requests).toHaveLength(0);
  });
});

describe("budget refusal elsewhere", () => {
  it("inside an LLM checklist rule: that rule is 'check by hand' with the budget reason; the code-built pack is still prepared", async () => {
    const w = echoWorld();
    const m = modelWorld({ claude: [], env: { AI_DAILY_BUDGET_INR: "5" }, seed: [{ at: EARLIER_TODAY, costInr: 5 }] });
    const out = await runAgent(echoAgent, "job-1", { ...w.deps, router: m.router }, { startedById: "u-priya" });
    expect(out.ok).toBe(true);
    const llm = rows(w.db, "checklistResult").find((r) => r.ruleId === "echo.related-party")!;
    expect(llm.status).toBe("na");
    // Scoped agents get the plain sentence (ADR-009 guardrail session); the ModelCall row keeps BUDGET_REFUSED.
    expect(String(llm.message)).toContain("the AI could not check this, so check it by hand. Today's AI budget for the firm is used up (₹5.00 of ₹5.00), so this run stopped. Run it again tomorrow, or ask an admin to raise the daily AI budget.");
    expect(m.claude.requests).toHaveLength(0);
  });

  it("during onboarding: the partner is told why and answers the questions instead", async () => {
    const m = modelWorld({ claude: [], env: { AI_DAILY_BUDGET_INR: "5" }, seed: [{ at: EARLIER_TODAY, costInr: 7.5 }] });
    const x = await extractSpec("Onboard Bright Tools LLP — GST monthly, assign Priya Sharma.", { router: m.router, runId: "onb-b" });
    expect(x.notes).toEqual(["The description could not be read automatically. Today's AI budget for the firm is used up. Answer the questions below instead."]);
    expect(x.spec).toEqual({});
  });
});
