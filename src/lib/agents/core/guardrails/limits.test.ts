// ADR-009 consumption limits (OWASP LLM10) and the per-task hallucination budget (LLM09): the
// table covers every task, the session applies the task's output cap and the run's cost budget,
// documents over the input limit are cut at a line and flagged (never silently), a budget refusal
// reaches the person as a plain sentence, and drift rows rate each task against its budget.
import { describe, expect, it } from "vitest";
import { BudgetExceededError } from "@/lib/ai/errors";
import { guardrailRates, breachLabel, type GuardrailRunSignal } from "@/lib/ai/usage";
import type { ModelRequest, RouterResult } from "@/lib/ai/router";
import { EXTRACT_TASK, TOO_LONG_NOTE, extractSpec } from "@/lib/agents/onboarding/extract";
import { AGENTS } from "@/lib/agents/registry";
import { ECHO_RELATED_PARTY_SPEC, ECHO_RELATED_PARTY_TASK, echoAgent } from "@/lib/agents/echo";
import { echoWorld, rows } from "../../../../../tests/fakes/agent-world";
import { runAgent } from "../runner";
import { DEFAULT_TASK_LIMITS, TASK_LIMITS, TRUNCATION_RULE_ID, hallucinationBudgetFor, hasTaskLimits, limitsFor, runBudgetFor, truncateToLimit, truncationResult } from "./limits";
import { budgetMessage } from "./session";
import { taskLabel } from "./scope";

const meta = (w: ReturnType<typeof echoWorld>) => (rows(w.db, "auditEvent").find((e) => e.action === "guardrail-run") as { meta: Record<string, unknown> }).meta;

describe("the per-task limits table", () => {
  const tasks = Object.values(AGENTS).flatMap((a) => (a.scope?.tasks ?? []).map((t) => t.name as string));
  it("has an entry for every declared task and the onboarding extractor; checks answer one verdict, lists stay within 64k output", () => {
    expect([...tasks, EXTRACT_TASK].filter((t) => !hasTaskLimits(t))).toEqual([]);
    for (const [task, l] of Object.entries(TASK_LIMITS)) {
      expect(l.maxInputTokens).toBeGreaterThan(0);
      expect(l.maxOutputTokens).toBeGreaterThan(0);
      expect(l.maxOutputTokens).toBeLessThanOrEqual(64_000);
      expect(l.hallucinationBudget).toBeGreaterThan(0);
      expect(l.hallucinationBudget).toBeLessThanOrEqual(0.05);
      if (task.includes(".check")) expect(l.maxOutputTokens).toBeLessThanOrEqual(2_048);
    }
    expect(limitsFor("comms.unknown")).toEqual(DEFAULT_TASK_LIMITS);
    expect(hallucinationBudgetFor("gst.read-hsn@2")).toBe(TASK_LIMITS["gst.read-hsn"].hallucinationBudget);
    expect(runBudgetFor("gst")).toBeGreaterThan(0);
    expect(runBudgetFor("someone-else")).toBeGreaterThan(0);
  });
  it("truncateToLimit keeps whole lines within the limit and names the first line not sent", () => {
    expect(truncateToLimit("a\nb", 10, () => "x")).toEqual({ kept: "a\nb", cut: null });
    const text = ["row 1: aaaa", "row 2: bbbb", "row 3: cccc", "", "row 4: dddd"].join("\n");
    expect(truncateToLimit(text, 6, (line) => line.split(":")[0])).toEqual({ kept: "row 1: aaaa\nrow 2: bbbb", cut: { lines: 2, firstLocation: "row 3" } });
  });
  it("the truncation row is a plain warn finding (no codes), and absent when nothing was cut", () => {
    expect(truncationResult([])).toBeNull();
    const row = truncationResult([{ task: "gst.classify-ledgers@2", linesNotSent: 40, firstLocation: "purchase-register.csv row 812" }])!;
    expect(row).toMatchObject({ ruleId: TRUNCATION_RULE_ID, severity: "warn", status: "fail", flags: ["input-truncated"], evidence: { location: "purchase-register.csv row 812" } });
    expect(row.message).toBe(
      "Some documents were longer than the AI may read in one call, so part of them was not sent (40 lines from purchase-register.csv row 812 onwards). Those items have no AI answer: check them by hand, or split the job into smaller periods and run it again.",
    );
  });
});

describe("the session applies the limits on every scoped call", () => {
  it("the task's output cap and the run's cost budget go to the router; per-task grounding counts go to the run record", async () => {
    const w = echoWorld();
    expect((await runAgent(echoAgent, "job-1", w.deps)).ok).toBe(true);
    for (const c of w.router.calls) expect(c).toMatchObject({ maxTokens: limitsFor(ECHO_RELATED_PARTY_TASK).maxOutputTokens, maxCostInr: runBudgetFor("echo") });
    expect(meta(w)).toMatchObject({ truncatedCalls: 0, tasks: { [taskLabel(ECHO_RELATED_PARTY_SPEC)]: { checked: 1, ungrounded: 0 } } });
  });

  it("documents over the task's input limit are cut at a line and flagged (warn), never silently; the verdict may only quote what was sent", async () => {
    const big = ["ref,party,date,amount", ...Array.from({ length: 700 }, (_, i) => `INV-${i + 1},Party number ${String(i + 1).padStart(4, "0")} Traders,2026-10-05,100.00`)].join("\n");
    const lastQuote = { status: "pass", evidence: { quote: "Party number 0700 Traders", location: "register.csv row 701" } };
    const w = echoWorld({ register: big, responses: { [ECHO_RELATED_PARTY_TASK]: lastQuote } });
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok).toBe(true);
    const sent = w.router.calls[0].messages[1].content;
    expect(sent.length).toBeLessThan(limitsFor(ECHO_RELATED_PARTY_TASK).maxInputTokens * 4 + 400);
    expect(sent).not.toContain("Party number 0700");
    const row = rows(w.db, "checklistResult").find((r) => r.ruleId === TRUNCATION_RULE_ID)!;
    expect(row).toMatchObject({ severity: "warn", status: "fail", evidence: { flags: ["input-truncated"] } });
    expect(row.message).toMatch(/^Some documents were longer than the AI may read in one call, so part of them was not sent \(\d+ lines from register\.csv row \d+ onwards\)/);
    expect(row.message).not.toMatch(/echo\.check|@\d/); // plain words: no task identifiers
    expect(rows(w.db, "checklistResult").find((r) => r.ruleId === "echo.related-party")).toMatchObject({ status: "na", evidence: { flags: ["llm-evidence-missing"] } });
    expect(meta(w)).toMatchObject({ truncatedCalls: 1, tasks: { [taskLabel(ECHO_RELATED_PARTY_SPEC)]: { checked: 1, ungrounded: 1 } } });
  });

  it("a budget refusal reaches the person as a plain sentence saying what to do (the ModelCall row keeps the code)", async () => {
    const refuse = { run: async <T,>(): Promise<RouterResult<T>> => Promise.reject(new BudgetExceededError("run", 25, 25.5)) };
    const plain = "This run has used its AI budget (₹25.50 of ₹25.00), so it stopped before finishing. Run it again, or ask an admin to raise the per-run AI budget for this agent.";
    // An extraction call: the run fails with the sentence.
    const kinds = { name: "echo.kinds" as const, version: 1, schema: ECHO_RELATED_PARTY_SPEC.schema, systemPrompt: "x", privacy: "anonymize-then-cloud" as const };
    const def = {
      ...echoAgent,
      scope: { ...echoAgent.scope!, tasks: [...echoAgent.scope!.tasks, kinds] },
      async extract(ctx: Parameters<typeof echoAgent.extract>[0]) {
        await ctx.model({ task: "echo.kinds" as never, privacy: "anonymize-then-cloud", difficulty: "sop", messages: [{ role: "user", content: "register.csv row 2: Acme Traders" }] });
        return echoAgent.extract(ctx);
      },
    };
    const w = echoWorld();
    w.deps.router = refuse;
    const out = await runAgent(def, "job-1", w.deps);
    expect(!out.ok && out.reason).toBe(plain);
    // An LLM rule: the rule is left for manual review with the same sentence.
    const w2 = echoWorld();
    w2.deps.router = refuse;
    expect((await runAgent(echoAgent, "job-1", w2.deps)).ok).toBe(true);
    expect(rows(w2.db, "checklistResult").find((r) => r.ruleId === "echo.related-party")).toMatchObject({ status: "na", message: `Related parties identified: model check failed (${plain}); review manually` });
    for (const m of [budgetMessage(new BudgetExceededError("run", 1, 2)), budgetMessage(new BudgetExceededError("day", 1000, 1000))]) {
      expect(m).not.toMatch(/maxCostInr|AI_DAILY_BUDGET_INR|BUDGET_REFUSED|\b[45]\d\d\b/);
    }
    expect(budgetMessage(new BudgetExceededError("day", 1000, 1000))).toBe("Today's AI budget for the firm is used up (₹1000.00 of ₹1000.00), so this run stopped. Run it again tomorrow, or ask an admin to raise the daily AI budget.");
  });
});

describe("onboarding limits", () => {
  it("passes the output cap; a text over the input limit is cut and the person is told", async () => {
    const calls: ModelRequest<unknown>[] = [];
    const router = { run: async <T,>(r: ModelRequest<T>) => (calls.push(r as ModelRequest<unknown>), { status: "queued" as const, reason: "x", needsPartnerReview: true as const, runId: "r", attempts: 0 as const }) };
    const long = `Onboard Acme Widgets Pvt Ltd. ${"Monthly GST and books. ".repeat(400)}`;
    const r = await extractSpec(long, { router, runId: "r" });
    expect(calls[0].maxTokens).toBe(limitsFor(EXTRACT_TASK).maxOutputTokens);
    expect(calls[0].messages[1].content.length).toBeLessThanOrEqual(limitsFor(EXTRACT_TASK).maxInputTokens * 4 + 80);
    expect(r.notes[0]).toBe(TOO_LONG_NOTE);
  });
});

describe("hallucination budget per task on the drift rows (LLM09)", () => {
  const AT = new Date("2026-11-05T05:00:00Z");
  const run = (tasks: GuardrailRunSignal["tasks"], injections = 0): GuardrailRunSignal => ({ createdAt: AT, agent: "gst", judgements: 0, abstained: 0, groundChecked: 0, ungrounded: 0, agreementChecks: 0, disagreements: 0, scopeViolations: 0, wrongInput: 0, injections, tasks });
  it("each task is rated against its own budget, worst first; over budget with enough checks is a breach naming the task", () => {
    const days = guardrailRates([], [run({ "gst.read-hsn@2": { checked: 10, ungrounded: 1 }, "gst.classify-ledgers@2": { checked: 50, ungrounded: 0 } }, 2), run({ "gst.read-hsn@2": { checked: 10, ungrounded: 0 } })], [], undefined, hallucinationBudgetFor);
    expect(days).toHaveLength(1);
    const d = days[0];
    expect(d.injections).toBe(2);
    expect(d.hallucination.map((h) => [h.task, h.rate.n, h.rate.d, h.breach])).toEqual([
      ["gst.read-hsn@2", 1, 20, true],
      ["gst.classify-ledgers@2", 0, 50, false],
    ]);
    expect(d.breaches).toEqual([{ metric: "hallucination", rate: 0.05, count: 1, threshold: 0.02, sample: 20, task: "gst.read-hsn@2" }]);
    expect(breachLabel(d.breaches[0])).toBe("Hallucination budget (gst.read-hsn@2)");
  });
  it("too few checks is not a breach; runs without task counts still work", () => {
    expect(guardrailRates([], [run({ "gst.read-hsn@2": { checked: 2, ungrounded: 1 } })], [])[0].breaches).toEqual([]);
    expect(guardrailRates([], [run(undefined)], [])[0]).toMatchObject({ hallucination: [], injections: 0, breaches: [] });
  });
});
