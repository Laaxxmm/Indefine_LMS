// ADR-008 enforced in the runner, end to end with the echo agent: scope (undeclared task →
// ScopeViolationError, no provider call), firm + department preambles in the provider payload,
// validators escalating, abstain → reviewer question, agreement on high-stakes rules, the
// wrong-department sniff before any model call, grounding of extraction output, per-call schemas.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadRouterConfig } from "@/lib/ai/config";
import type { ProviderSet } from "@/lib/ai/providers";
import { ROUTER_INSTRUCTIONS, createRouter, type ModelCallRow, type ModelCallRepo } from "@/lib/ai/router";
import type { ModelProvider, ProviderRequest, ProviderResult } from "@/lib/ai/types";
import { ECHO_CHECKLIST, ECHO_RELATED_PARTY_SPEC, ECHO_RELATED_PARTY_TASK, ECHO_SCOPE, EchoExtractSchema, echoAgent, type EchoExtract, type EchoInput } from "@/lib/agents/echo";
import { REGISTER_CSV, echoWorld, rows } from "../../../../../tests/fakes/agent-world";
import { runAgent, type AgentDefinition } from "../runner";
import { openQuestions } from "./review";
import { FIRM_PREAMBLE, departmentPreamble, type ModelTaskSpec } from "./scope";
import { abstainable, evidence, groundedNumber } from "./schema";

type Def = AgentDefinition<EchoInput, EchoExtract>;
const PASS = { status: "pass", evidence: { quote: "Acme Traders", location: "register.csv row 2" } };
const related = (w: ReturnType<typeof echoWorld>) => rows(w.db, "checklistResult").find((r) => r.ruleId === "echo.related-party")!;
const guardEvent = (w: ReturnType<typeof echoWorld>) => rows(w.db, "auditEvent").find((e) => e.action === "guardrail-run") as { meta: Record<string, unknown> } | undefined;

// An extraction task echo does not have, declared only in these tests.
const PartyKinds = z.object({
  parties: z.array(z.object({ party: z.string().max(200), kind: abstainable(z.enum(["company", "individual"])), amount: groundedNumber(), quote: z.string().max(300), location: z.string().max(100) })).max(50),
});
const PARTY_TASK: ModelTaskSpec<z.infer<typeof PartyKinds>, EchoInput, "echo"> = { name: "echo.party-kinds", version: 1, schema: PartyKinds, systemPrompt: "Say for each party whether it is a company or an individual.", difficulty: "sop" };
const registerText = REGISTER_CSV;

/** Echo with the party task declared and an extract that calls `call`; captured outputs land in `seen`. */
function withExtract(call: Parameters<Def["extract"]>[0] extends infer C ? (ctx: C) => Promise<unknown> : never, tasks: ModelTaskSpec[] = [ECHO_RELATED_PARTY_SPEC as ModelTaskSpec, PARTY_TASK as ModelTaskSpec]) {
  const seen: unknown[] = [];
  const def: Def = {
    ...echoAgent,
    scope: { ...ECHO_SCOPE, tasks },
    async extract(ctx) {
      seen.push(await call(ctx));
      return EchoExtractSchema.parse({ rows: ctx.input.rows });
    },
  };
  return { def, seen };
}

describe("scope is required and validated (preconditions: no run is recorded)", () => {
  it("an agent that is not internal and declares no scope → NO_SCOPE", async () => {
    const w = echoWorld();
    const out = await runAgent({ ...echoAgent, internal: false, scope: undefined }, "job-1", w.deps);
    expect(out).toEqual({ ok: false, code: "NO_SCOPE", reason: expect.stringMatching(/^scope: not declared — Echo \(framework test\) must declare an AgentScope/) });
    expect(rows(w.db, "agentRun")).toHaveLength(0);
  });
  it("a scope with a task outside the agent's prefix, or a department that is not the service → INVALID_SCOPE", async () => {
    const w = echoWorld();
    const bad = await runAgent({ ...echoAgent, scope: { ...ECHO_SCOPE, department: "GST", tasks: [{ ...PARTY_TASK, name: "gst.party-kinds" } as never] } }, "job-1", w.deps);
    expect(bad).toMatchObject({ ok: false, code: "INVALID_SCOPE" });
    expect(!bad.ok && bad.reason).toMatch(/department GST differs from the agent's service Books/);
    expect(!bad.ok && bad.reason).toMatch(/task "gst.party-kinds" is not prefixed with "echo."/);
    expect(!bad.ok && bad.reason).toMatch(/LLM rule echo.related-party has no model task/);
    expect(rows(w.db, "agentRun")).toHaveLength(0);
  });
  it("an internal agent without a scope still runs the legacy path (backward compatible)", async () => {
    const w = echoWorld({ responses: { "system.check:echo.related-party": PASS } });
    const out = await runAgent({ ...echoAgent, scope: undefined }, "job-1", w.deps);
    expect(out.ok).toBe(true);
    expect(w.router.calls.map((c) => [c.task, c.taskVersion, c.messages[0].role])).toEqual([["system.check:echo.related-party", undefined, "system"]]);
    expect(rows(w.db, "auditEvent")).toEqual([]); // no guardrail record without a scope
  });
});

describe("ctx.model refuses tasks outside the scope (ScopeViolationError → run FAILED, no provider call)", () => {
  it("an undeclared task", async () => {
    const { def } = withExtract(({ model }) => model({ task: "echo.undeclared" as never, privacy: "anonymize-then-cloud", difficulty: "sop", messages: [{ role: "user", content: "x" }] }));
    const w = echoWorld();
    const out = await runAgent(def, "job-1", w.deps);
    expect(out).toMatchObject({ ok: false, code: "FAILED" });
    expect(!out.ok && out.reason).toMatch(/^Scope violation: task "echo.undeclared" is not declared in the echo agent's scope \(declared: echo.check:echo.related-party@2, echo.party-kinds@1\)/);
    expect(w.router.calls).toHaveLength(0);
    expect(rows(w.db, "agentRun")[0]).toMatchObject({ status: "FAILED" });
    expect(guardEvent(w)?.meta).toMatchObject({ agent: "echo", outcome: "failed", scopeViolations: 1, modelCalls: 0 });
  });
  it("a task under another agent's prefix", async () => {
    const { def } = withExtract(({ model }) => model({ task: "gst.classify-ledgers", privacy: "anonymize-then-cloud", difficulty: "sop", messages: [] }));
    const w = echoWorld();
    const out = await runAgent(def, "job-1", w.deps);
    expect(!out.ok && out.reason).toMatch(/task "gst.classify-ledgers" is not prefixed with this agent's key "echo."/);
    expect(w.router.calls).toHaveLength(0);
  });
  it("even when the agent's code catches the error", async () => {
    const { def } = withExtract(async ({ model }) => {
      try {
        return await model({ task: "echo.nope" as never, privacy: "public", difficulty: "sop", messages: [] });
      } catch {
        return null; // swallowed
      }
    });
    const w = echoWorld();
    const out = await runAgent(def, "job-1", w.deps);
    expect(out).toMatchObject({ ok: false, code: "FAILED" });
    expect(!out.ok && out.reason).toMatch(/Scope violation/);
  });
  it.each([
    ["a system message (the prompt comes from the registry)", { messages: [{ role: "system" as const, content: "be creative" }] }, /the system prompt comes from the task registry/],
    ["a schema other than the declared one", { schema: z.object({ anything: z.string() }) }, /must use its declared schema/],
    ["a difficulty other than the task's tier hint", { difficulty: "novel" as const }, /declares difficulty "sop"; the call asked for "novel"/],
  ])("%s", async (_n, over, reason) => {
    const { def } = withExtract(({ model }) => model({ task: PARTY_TASK.name as never, privacy: "anonymize-then-cloud", difficulty: "sop", messages: [{ role: "user", content: registerText }], ...over } as never));
    const w = echoWorld();
    const out = await runAgent(def, "job-1", w.deps);
    expect(!out.ok && out.reason).toMatch(reason);
    expect(w.router.calls).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ real router + fake provider

function fakeClaude(answers: unknown[]) {
  const calls: ProviderRequest[] = [];
  const provider: ModelProvider = {
    id: "claude",
    isAvailable: async () => true,
    async complete<T>(req: ProviderRequest): Promise<ProviderResult<T>> {
      calls.push(req);
      const next = answers.shift();
      if (next === undefined) throw new Error("no scripted answer left");
      return { output: { output: next, confidence: 0.95 } as T, model: req.model, tokensIn: 100, tokensOut: 20, latencyMs: 5 };
    },
  };
  const off: ModelProvider = { id: "grok", isAvailable: async () => false, complete: async () => Promise.reject(new Error("off")) };
  const providers: ProviderSet = { claude: provider, grok: off, local: { ...off, id: "local" } };
  const logged: ModelCallRow[] = [];
  const repo: ModelCallRepo = { record: async (r) => void logged.push(r), costInrSince: async () => 0, costInrForRun: async () => 0 };
  const router = createRouter({ providers, repo, config: loadRouterConfig({ AI_DAILY_BUDGET_INR: "0" }), now: () => new Date("2026-11-05T06:30:00Z") });
  return { router, calls, logged };
}

describe("the model sees the firm + department preambles; ModelCall records task@version", () => {
  it("system prompt = FIRM_PREAMBLE + department preamble + task prompt (+ router instructions); the second read is #2 on HARD", async () => {
    const w = echoWorld();
    const p = fakeClaude([PASS, PASS]);
    w.deps.router = p.router;
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok).toBe(true);
    expect(p.calls).toHaveLength(2);
    const system = p.calls[0].system ?? "";
    expect(system.startsWith(FIRM_PREAMBLE)).toBe(true);
    expect(system.indexOf(departmentPreamble("Books"))).toBeGreaterThan(system.indexOf(FIRM_PREAMBLE));
    expect(system.indexOf(ECHO_RELATED_PARTY_SPEC.systemPrompt)).toBeGreaterThan(system.indexOf(departmentPreamble("Books")));
    expect(system.endsWith(ROUTER_INSTRUCTIONS)).toBe(true);
    expect(system).toMatch(/Work only on Bookkeeping and accounts for Indian compliance/);
    expect(system).toMatch(/Never give filing, legal or audit-opinion advice/);
    expect(system).toMatch(/return "insufficient_evidence"/);
    expect(p.logged.map((r) => [r.task, r.agent, r.tier, r.status])).toEqual([
      ["echo.check:echo.related-party@2", "echo", "SMART", "OK"],
      ["echo.check:echo.related-party@2#2", "echo", "HARD", "OK"],
    ]);
  });

  it("a validator failure escalates like a schema failure (contradiction → next tier)", async () => {
    const w = echoWorld();
    const badRow = { status: "pass", evidence: { quote: "Acme Traders", location: "register.csv row 99" } }; // no such row
    const p = fakeClaude([badRow, PASS, PASS]);
    w.deps.router = p.router;
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok).toBe(true);
    expect(p.logged.map((r) => [r.task, r.tier, r.status, r.escalated])).toEqual([
      ["echo.check:echo.related-party@2", "SMART", "LOW_CONFIDENCE", false],
      ["echo.check:echo.related-party@2", "HARD", "OK", true],
      ["echo.check:echo.related-party@2#2", "HARD", "OK", false],
    ]);
    expect(p.logged[0].error).toMatch(/contradiction: location "register.csv row 99" is not a register row shown/);
    expect(related(w)).toMatchObject({ status: "pass" });
  });
});

describe("abstain and agreement", () => {
  it("insufficient_evidence → na + insufficient-evidence, an open question / client request, counted", async () => {
    const w = echoWorld({ responses: { [ECHO_RELATED_PARTY_TASK]: { status: "insufficient_evidence", message: "Ask whether Acme Traders is a group company." } } });
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out.ok).toBe(true);
    const r = related(w);
    expect(r).toMatchObject({ status: "na", message: "Related parties identified: insufficient evidence — Ask whether Acme Traders is a group company.", evidence: { flags: ["insufficient-evidence"] } });
    expect(guardEvent(w)?.meta).toMatchObject({ abstained: 1, judgements: 1 });
    const qs = openQuestions(rows(w.db, "checklistResult").map((x) => ({ ruleId: x.ruleId as string, message: x.message as string, flags: ((x.evidence as { flags?: string[] } | null)?.flags ?? []) })));
    expect(qs).toEqual([{ ruleId: "echo.related-party", kind: "insufficient-evidence", question: r.message, location: null, clientRequest: true }]);
  });

  it("two reads that disagree → na + model-disagreement (no flag on one read); agreeing reads keep the verdict", async () => {
    const fail = { status: "fail", evidence: { quote: "Acme Traders", location: "register.csv row 2" } };
    const w = echoWorld({ responses: { [ECHO_RELATED_PARTY_TASK]: fail, [`${ECHO_RELATED_PARTY_TASK}#2`]: PASS } });
    await runAgent(echoAgent, "job-1", w.deps);
    expect(related(w)).toMatchObject({ status: "na", evidence: { flags: ["model-disagreement"] } });
    expect(related(w).message).toMatch(/two independent model reads disagree \(fail vs pass\)/);
    expect(w.router.calls.map((c) => [c.secondOpinion ?? false, c.forceTier ?? null])).toEqual([
      [false, null],
      [true, "HARD"],
    ]);
    expect(guardEvent(w)?.meta).toMatchObject({ agreementChecks: 1, disagreements: 1 });
    const same = echoWorld({ responses: { [ECHO_RELATED_PARTY_TASK]: fail } }); // single recording reused for #2
    await runAgent(echoAgent, "job-1", same.deps);
    expect(related(same)).toMatchObject({ status: "fail" });
  });

  it("a block LLM rule is read twice even when its task is not marked high-stakes", async () => {
    const pack = { ...ECHO_CHECKLIST, rules: ECHO_CHECKLIST.rules.map((r) => (r.id === "echo.related-party" ? { ...r, severity: "block" as const } : r)) };
    const w = echoWorld({ pack: false });
    w.db.seed("sopPack", [{ key: "echo", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Echo", checklist: pack }]);
    await runAgent({ ...echoAgent, scope: { ...ECHO_SCOPE, tasks: [{ ...ECHO_RELATED_PARTY_SPEC, highStakes: false }] } }, "job-1", w.deps);
    expect(w.router.calls).toHaveLength(2);
  });

  it("an LLM rule the scope does not own gets no model call (na + out-of-scope); an owned rule without a task fails the run", async () => {
    const extra = { id: "echo.extra-llm", title: "Extra", severity: "warn" as const, kind: "llm" as const, check: "Anything odd?", evidence: "row" };
    const w = echoWorld({ pack: false });
    w.db.seed("sopPack", [{ key: "echo", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Echo", checklist: { ...ECHO_CHECKLIST, rules: [...ECHO_CHECKLIST.rules, extra] } }]);
    expect((await runAgent(echoAgent, "job-1", w.deps)).ok).toBe(true);
    expect(rows(w.db, "checklistResult").find((r) => r.ruleId === "echo.extra-llm")).toMatchObject({ status: "na", evidence: { flags: ["out-of-scope"] } });
    expect(w.router.calls.every((c) => (c.task as string) === ECHO_RELATED_PARTY_TASK)).toBe(true);
    expect(guardEvent(w)?.meta).toMatchObject({ outOfScopeRules: 1 });

    const w2 = echoWorld({ pack: false });
    w2.db.seed("sopPack", [{ key: "echo", version: "1.0.0", major: 1, minor: 0, patch: 0, title: "Echo", checklist: { ...ECHO_CHECKLIST, rules: [...ECHO_CHECKLIST.rules, extra] } }]);
    const owned = await runAgent({ ...echoAgent, scope: { ...ECHO_SCOPE, ruleIds: [...ECHO_SCOPE.ruleIds, "echo.extra-llm"] } }, "job-1", w2.deps);
    expect(!owned.ok && owned.reason).toMatch(/LLM rule echo.extra-llm has no declared model task \(declare "echo.check:echo.extra-llm" or "echo.check"\)/);
  });
});

describe("wrong-department input stops the run before any model call", () => {
  it("register.csv that is a GST register → FAILED naming the GST agent; the router is never called", async () => {
    const w = echoWorld({ register: "invoice_no,gstin,invoice_date,taxable_value,igst\nS-1,29ABCDE1234F1Z5,2026-10-05,100.00,18.00" });
    const out = await runAgent(echoAgent, "job-1", w.deps);
    expect(out).toMatchObject({ ok: false, code: "FAILED" });
    expect(!out.ok && out.reason).toBe(
      'Wrong input for Echo (framework test) (Bookkeeping and accounts): register.csv header must be ref,party,date,amount (found "invoice_no,gstin,invoice_date,taxable_value,igst"); it looks like a GST register. Run the gst agent on these documents instead.',
    );
    expect(w.router.calls).toHaveLength(0);
    expect(guardEvent(w)?.meta).toMatchObject({ wrongInput: 1, modelCalls: 0 });
  });
  it("a sniff that throws or rejects fails closed; an async sniff is awaited", async () => {
    const boom = await runAgent({ ...echoAgent, scope: { ...ECHO_SCOPE, inputSniff: () => { throw new Error("cannot read"); } } }, "job-1", echoWorld().deps);
    expect(!boom.ok && boom.reason).toMatch(/inputSniff could not read the files \(cannot read\)/);
    const w = echoWorld();
    const later = await runAgent({ ...echoAgent, scope: { ...ECHO_SCOPE, inputSniff: async () => ({ ok: false as const, reason: "a trial balance", suggestAgent: "books" }) } }, "job-1", w.deps);
    expect(!later.ok && later.reason).toMatch(/a trial balance\. Run the books agent/);
    expect(w.router.calls).toHaveLength(0);
  });
});

describe("extraction output is grounded", () => {
  const ask = (ctx: Parameters<Def["extract"]>[0]) => ctx.model({ task: PARTY_TASK.name as never, privacy: "anonymize-then-cloud", difficulty: "sop", schema: PARTY_TASK.schema, messages: [{ role: "user", content: registerText }] });
  it("an item whose number is not in its quote is dropped and counted", async () => {
    const { def, seen } = withExtract(ask);
    const answer = {
      parties: [
        { party: "Acme Traders", kind: "company", amount: 15000, quote: "INV-1,Acme Traders,2026-10-05,15000.00", location: "register.csv row 2" },
        { party: "Bright Supplies", kind: "company", amount: 23465.5, quote: "INV-2,Bright Supplies,2026-10-06,23456.50", location: "register.csv row 3" },
      ],
    };
    const w = echoWorld({ responses: { [ECHO_RELATED_PARTY_TASK]: PASS, [PARTY_TASK.name]: answer } });
    expect((await runAgent(def, "job-1", w.deps)).ok).toBe(true);
    expect((seen[0] as typeof answer).parties.map((p) => p.party)).toEqual(["Acme Traders"]);
    expect(guardEvent(w)?.meta).toMatchObject({ ungrounded: 1 });
    expect(w.router.calls[0]).toMatchObject({ task: "echo.party-kinds", taskVersion: 1 });
  });
  it("output whose own evidence is not in the documents cannot be used: the run fails", async () => {
    const Root = z.object({ kind: abstainable(z.enum(["company"])), evidence: evidence() });
    const task: ModelTaskSpec = { name: "echo.root", version: 1, schema: Root, systemPrompt: "x" };
    const { def } = withExtract((ctx) => ctx.model({ task: "echo.root" as never, privacy: "public", difficulty: "sop", messages: [{ role: "user", content: registerText }] }), [ECHO_RELATED_PARTY_SPEC as ModelTaskSpec, task]);
    const w = echoWorld({ responses: { [ECHO_RELATED_PARTY_TASK]: PASS, "echo.root": { kind: "company", evidence: { quote: "Acme Traders Private Limited", location: "row 2" } } } });
    const out = await runAgent(def, "job-1", w.deps);
    expect(!out.ok && out.reason).toMatch(/^Model output for echo.root@1 is not grounded in the documents/);
  });
});

describe("per-call closed schemas (schemaPerCall)", () => {
  const Template = z.object({ picks: z.array(z.object({ id: z.enum(["L1"]), head: abstainable(z.enum(["(ledger)"])), evidence: evidence() })) });
  const task: ModelTaskSpec = { name: "echo.pick", version: 1, schema: Template, systemPrompt: "Pick a head.", schemaPerCall: true };
  const run = async (schema: z.ZodTypeAny) => {
    const { def } = withExtract((ctx) => ctx.model({ task: "echo.pick" as never, privacy: "public", difficulty: "sop", schema, messages: [{ role: "user", content: registerText }] }), [ECHO_RELATED_PARTY_SPEC as ModelTaskSpec, task]);
    const w = echoWorld({ responses: { [ECHO_RELATED_PARTY_TASK]: PASS, "echo.pick": { picks: [] } } });
    return { out: await runAgent(def, "job-1", w.deps), w };
  };
  it("a schema of the template's shape with this call's enums is used", async () => {
    const { out, w } = await run(z.object({ picks: z.array(z.object({ id: z.enum(["L7", "L8"]), head: abstainable(z.enum(["Rent", "Power"])), evidence: evidence() })) }));
    expect(out.ok).toBe(true);
    expect(w.router.calls.find((c) => (c.task as string) === "echo.pick")?.schema).not.toBe(Template);
  });
  it("another shape, or free-form strings, are scope violations", async () => {
    expect((await run(z.object({ picks: z.array(z.object({ id: z.enum(["L7"]) })) }))).out).toMatchObject({ ok: false, reason: expect.stringMatching(/does not have the declared shape/) });
    const open = z.object({ picks: z.array(z.object({ id: z.enum(["L7"]), head: abstainable(z.enum(["Rent"])), evidence: z.object({ quote: z.string(), location: z.string() }).describe("x") })) });
    expect((await run(open.extend({ note: z.string() }))).out).toMatchObject({ ok: false });
  });
});
