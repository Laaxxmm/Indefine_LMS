// The independent audit's probes, kept as permanent self-tests (tests/fixtures/accuracy-selftest/).
// Before the fix every one of these produced a "pass" without the agent reading its input. Each
// probe root holds one echo fixture; the CLI form is in scripts/accuracy.test.ts.
import { describe, expect, it } from "vitest";
import { ECHO_RELATED_PARTY_TASK, EchoExtractSchema, echoAgent } from "@/lib/agents/echo";
import { DEFAULT_FIXTURES_ROOT, loadFixtures, runAgentAccuracy } from "./accuracy-run";
import { scoreboardMarkdown } from "./accuracy";
import type { AgentDefinition } from "./runner";
import type { EchoExtract, EchoInput } from "@/lib/agents/echo";

const PROBES = "tests/fixtures/accuracy-selftest";
const probe = (dir: string) => runAgentAccuracy(echoAgent, { root: `${PROBES}/${dir}` });
const STALE = "clean-register: recorded.json has responses no run asked for (system.echo-extract); remove stale recordings";
/** Echo's related-party rule is high-stakes (read twice); a fixture without a `#2` recording reuses the one answer — noted, not gated. */
const singleAnswer = (fixture: string) => `agreement: recorded single answer on 1 fixture(s) — ${fixture} (${ECHO_RELATED_PARTY_TASK}); add "<task>#2" recordings to exercise disagreement`;

describe("audit probes (each produced a false pass before the fix)", () => {
  it("(1) input amount + ₹1 with the recording unchanged → FAIL on figures", async () => {
    const s = await probe("probe-1-input-amount-plus-1");
    expect(s.pass).toBe(false);
    expect(s.figures.diffs).toEqual([{ fixtureId: "clean-register", diffs: [{ key: "totalPaise", expected: 4745649, actual: 4745749, deltaPaise: 100 }] }]);
    expect(s.reasons).toEqual(["figures exact on 0/1 fixtures"]);
    // The pre-audit extraction recording is still in the fixture; nothing asked for it.
    expect(s.notes).toEqual([STALE, singleAnswer("clean-register")]);
  });

  it("(2) duplicate ref injected in the input only → FAIL on an unexpected block flag", async () => {
    const s = await probe("probe-2-duplicate-ref-input-only");
    expect(s.pass).toBe(false);
    expect(s.flagDiffs).toEqual([{ fixtureId: "clean-register", missed: [], unexpected: [{ ruleId: "echo.duplicate-refs", severity: "block" }] }]);
    expect(s.split.block.deterministic).toMatchObject({ tp: 0, fp: 1, fn: 0, precision: 0 });
    expect(s.reasons).toEqual(["block precision (deterministic rules) 0.000 < 0.9"]);
  });

  it("(3) recorded value changed → no effect on deterministic figures (documented: passes, stale recording noted)", async () => {
    const s = await probe("probe-3-recorded-value-changed");
    // The stale system.echo-extract recording says INV-1 is ₹15,001.00; echo reads ₹15,000.00 from the input.
    expect(s.figures.share).toBe(1);
    expect(s.pass).toBe(true);
    expect(s.notes).toEqual([STALE, singleAnswer("clean-register")]);
  });

  it("(4) _mistakes removed → FAIL: the promoted warn rule is missing and its flag is missed", async () => {
    const s = await probe("probe-4-mistakes-removed");
    expect(s.pass).toBe(false);
    expect(s.replay.total).toBe(0);
    expect(s.unknownRules).toEqual(["echo.watch-shadow"]);
    expect(s.reasons).toEqual(["warn recall (deterministic rules) 0.000 < 0.9", "expected flag(s) for rule(s) not in the checklist pack: echo.watch-shadow (missing _mistakes promotion?)"]);
  });

  it("(5) LLM verdict quoting text absent from the input → na + llm-evidence-missing → FAIL on the missed warn flag and on ungrounded output", async () => {
    const s = await probe("probe-5-llm-quote-not-in-input");
    expect(s.pass).toBe(false);
    expect(s.flagDiffs).toEqual([{ fixtureId: "trap-related-party", missed: [{ ruleId: "echo.related-party", severity: "warn" }], unexpected: [] }]);
    expect(s.split.warn.llm).toMatchObject({ tp: 0, fp: 0, fn: 1 });
    // ADR-008: the fabricated quote is also counted as ungrounded output the fixture did not expect.
    expect(s.guardrails.ungrounded).toMatchObject({ actual: 1, expected: 0, ok: false });
    expect(s.reasons).toEqual([
      "warn LLM flags do not match the recorded verdicts (code path): 1 missed, 0 unexpected",
      "ungrounded output not expected by the fixtures — trap-related-party: 1 ungrounded item(s), expected 0",
    ]);
  });
});

describe("gate rules that close the audit's gaps", () => {
  it("perfect echo set → PASS", async () => {
    const s = await runAgentAccuracy(echoAgent);
    expect(s.pass).toBe(true);
    expect(s.reasons).toEqual([]);
  });

  it("a non-internal agent without probes → FAIL (input sensitivity: not declared)", async () => {
    const prod: AgentDefinition<EchoInput, EchoExtract> = { ...echoAgent, internal: false, probeMutation: undefined, inputProbes: undefined };
    const s = await runAgentAccuracy(prod);
    expect(s.pass).toBe(false);
    expect(s.reasons).toContain("input sensitivity: not declared (agents that are not internal must define probeMutation)");
    expect(scoreboardMarkdown([s], new Date())).toContain("| input sensitivity | – | – | – | not declared · required (agent is not internal) | FAIL |");
  });

  it("a non-internal agent with only the single probeMutation, or a required input without a probe → FAIL (second audit, M2)", async () => {
    const single = await runAgentAccuracy({ ...echoAgent, internal: false, inputProbes: undefined });
    expect(single.reasons).toContain("input sensitivity: no per-input probes (agents that are not internal must declare inputProbes for every required input file)");
    const uncovered = await runAgentAccuracy({ ...echoAgent, internal: false, requiredInputs: ["register.csv", "bank.csv"] });
    expect(uncovered.reasons).toContain("input sensitivity: no probe for the required input bank.csv");
    expect(uncovered.sensitivity.missingRequired).toEqual(["bank.csv"]);
    expect(scoreboardMarkdown([uncovered], new Date())).toContain("| input sensitivity · bank.csv (required) | – | – | – | no probe declared · required input | FAIL |");
  });

  it("a thin production set → FAIL (9 fixtures where 15 are required; no red-team fixtures where 2 are required, ADR-009)", async () => {
    const prod: AgentDefinition<EchoInput, EchoExtract> = { ...echoAgent, internal: false };
    const s = await runAgentAccuracy(prod);
    expect(s.pass).toBe(false);
    expect(s.reasons).toEqual(["thin fixture set: 9 fixture(s), echo needs at least 15", "red-team: 0 fixture(s) with injection attempts inside input documents, need at least 2 (ADR-009)"]);
  });

  it("a probe that changes nothing → FAIL", async () => {
    const s = await runAgentAccuracy({ ...echoAgent, inputProbes: [{ input: "register.csv", mutate: (files) => files }] });
    expect(s.pass).toBe(false);
    expect(s.sensitivity.failures[0]).toEqual({ fixtureId: "clean-credit-note", reason: "register.csv: the register.csv probe left the input unchanged" });
    const legacy = await runAgentAccuracy({ ...echoAgent, inputProbes: undefined, probeMutation: (files) => files });
    expect(legacy.sensitivity.failures[0]).toEqual({ fixtureId: "clean-credit-note", reason: "probeMutation left the input unchanged" });
  });

  it("the original C1 bug re-created is refused by the scope: the undeclared extraction task is a scope violation", async () => {
    const legacy: AgentDefinition<EchoInput, EchoExtract> = {
      ...echoAgent,
      extract: ({ model }) => model({ task: "system.echo-extract" as never, privacy: "anonymize-then-cloud", difficulty: "sop", schema: EchoExtractSchema, messages: [] }),
    };
    const s = await runAgentAccuracy(legacy, { root: `${PROBES}/probe-1-input-amount-plus-1` });
    expect(s.pass).toBe(false);
    expect(s.guardrails.scope.violations).toBeGreaterThan(0);
    expect(s.errors[0].error).toMatch(/Scope violation: task "system.echo-extract" is not prefixed with this agent's key "echo."/);
  });

  it("the original C1 bug re-created (figures from a recorded extraction) is caught by input sensitivity even when expectations agree with the recording", async () => {
    // Pre-audit echo, unscoped: extract() returns the model's (recorded) rows and never reads input/.
    const legacy: AgentDefinition<EchoInput, EchoExtract> = {
      ...echoAgent,
      scope: undefined,
      inputProbes: undefined,
      extract: ({ model }) => model({ task: "system.echo-extract" as never, privacy: "anonymize-then-cloud", difficulty: "sop", schema: EchoExtractSchema, messages: [] }),
    };
    // Probe 1's root: input amount + ₹1, recording and expected.json still the original — the audit's false pass.
    const s = await runAgentAccuracy(legacy, { root: `${PROBES}/probe-1-input-amount-plus-1` });
    expect(s.figures.share).toBe(1); // the recording agrees with expected.json …
    expect(s.pass).toBe(false); // … but the gate no longer passes it
    expect(s.sensitivity.failures).toEqual([{ fixtureId: "clean-register", reason: "same figures and flags after one input value changed: the result does not depend on the input" }]);
    expect(s.reasons).toEqual(["input sensitivity: result unchanged or probe failed on clean-register"]);
  });

  it("echo fixtures record only genuine LLM outputs (the related-party verdict, and its #2 re-ask where a fixture tests disagreement)", () => {
    for (const fx of loadFixtures(DEFAULT_FIXTURES_ROOT, "echo")) {
      for (const k of Object.keys(fx.recorded)) expect([ECHO_RELATED_PARTY_TASK, `${ECHO_RELATED_PARTY_TASK}#2`]).toContain(k);
    }
  });
});
