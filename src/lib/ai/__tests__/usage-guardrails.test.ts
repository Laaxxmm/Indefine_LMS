// ADR-008 §9 drift monitoring (pure): per-agent per-IST-day guardrail rates and breaches.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GUARDRAIL_THRESHOLDS,
  formatRate,
  guardrailRates,
  isSchemaOrValidatorFailure,
  loadGuardrailThresholds,
  type GuardrailRunSignal,
  type ReviewSignal,
  type UsageCall,
} from "../usage";

const DAY1 = new Date("2026-11-04T05:00:00Z"); // 04 Nov IST
const DAY2 = new Date("2026-11-05T05:00:00Z"); // 05 Nov IST
const LATE = new Date("2026-11-04T20:00:00Z"); // 05 Nov 01:30 IST
const call = (agent: string, at: Date, over: Partial<UsageCall> = {}): UsageCall => ({ createdAt: at, agent, provider: "claude", status: "OK", escalated: false, costInr: 0, tokensIn: 0, tokensOut: 0, ...over });
const run = (agent: string, at: Date, over: Partial<GuardrailRunSignal> = {}): GuardrailRunSignal => ({ createdAt: at, agent, judgements: 0, abstained: 0, groundChecked: 0, ungrounded: 0, agreementChecks: 0, disagreements: 0, scopeViolations: 0, wrongInput: 0, ...over });
const many = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

describe("thresholds", () => {
  it("defaults, env overrides, and bad values fall back", () => {
    expect(DEFAULT_GUARDRAIL_THRESHOLDS).toEqual({ schemaFail: 0.1, escalation: 0.25, abstain: 0.3, ungrounded: 0.02, disagreement: 0.1, override: 0.3, minSample: 5 });
    expect(loadGuardrailThresholds({ GUARDRAIL_MAX_ABSTAIN_RATE: "0.5", GUARDRAIL_MIN_SAMPLE: "10", GUARDRAIL_MAX_ESCALATION_RATE: "2", GUARDRAIL_MAX_UNGROUNDED_RATE: "x", GUARDRAIL_MAX_OVERRIDE_RATE: "" })).toEqual({
      ...DEFAULT_GUARDRAIL_THRESHOLDS,
      abstain: 0.5,
      minSample: 10,
    });
    expect(loadGuardrailThresholds({ GUARDRAIL_MIN_SAMPLE: "0" }).minSample).toBe(5);
  });
});

describe("isSchemaOrValidatorFailure", () => {
  it("schema failures and validator contradictions count; low confidence alone does not", () => {
    expect(isSchemaOrValidatorFailure({ status: "SCHEMA_FAIL", error: null })).toBe(true);
    expect(isSchemaOrValidatorFailure({ status: "LOW_CONFIDENCE", error: "contradiction: GSTIN checksum" })).toBe(true);
    expect(isSchemaOrValidatorFailure({ status: "LOW_CONFIDENCE", error: "confidence 0.5; contradiction: x" })).toBe(true);
    expect(isSchemaOrValidatorFailure({ status: "LOW_CONFIDENCE", error: "confidence 0.5 is below ROUTER_MIN_CONF 0.75" })).toBe(false);
    expect(isSchemaOrValidatorFailure({ status: "OK" })).toBe(false);
  });
});

describe("guardrailRates", () => {
  it("computes every rate per agent per IST day, newest first", () => {
    const calls = [
      ...many(8, () => call("gst", DAY1)),
      call("gst", DAY1, { status: "SCHEMA_FAIL", escalated: false }),
      call("gst", DAY1, { status: "LOW_CONFIDENCE", error: "contradiction: x", escalated: true }),
      call("tax", LATE),
      call(null as never, DAY1),
    ];
    const runs = [run("gst", DAY1, { judgements: 10, abstained: 2, groundChecked: 50, ungrounded: 0, agreementChecks: 4, disagreements: 1 }), run("tax", DAY2, { judgements: 1 })];
    const reviews: ReviewSignal[] = [...many(4, () => ({ createdAt: DAY1, agent: "gst", kind: "run" as const })), { createdAt: DAY1, agent: "gst", kind: "changes-requested" }, { createdAt: DAY1, agent: "gst", kind: "mistake" }];
    const days = guardrailRates(calls, runs, reviews);
    expect(days.map((d) => [d.day, d.agent])).toEqual([
      ["2026-11-05", "tax"],
      ["2026-11-04", "gst"],
    ]);
    const gst = days[1];
    expect(gst.rates).toEqual({
      schemaFail: { n: 2, d: 10, rate: 0.2 },
      escalation: { n: 1, d: 10, rate: 0.1 },
      abstain: { n: 2, d: 10, rate: 0.2 },
      ungrounded: { n: 0, d: 50, rate: 0 },
      disagreement: { n: 1, d: 4, rate: 0.25 },
      override: { n: 2, d: 4, rate: 0.5 },
    });
    // schema-fail 20% > 10% with 10 calls; disagreement 25% but only 4 checks (< minSample 5); override 50% but 4 runs.
    expect(gst.breaches).toEqual([{ metric: "schemaFail", rate: 0.2, count: 2, threshold: 0.1, sample: 10 }]);
    expect(days[0].rates.abstain).toEqual({ n: 0, d: 1, rate: 0 });
    expect(days[0].rates.override).toEqual({ n: 0, d: 0, rate: null });
  });

  it("a lower minSample turns small samples into breaches; any scope violation breaches", () => {
    const runs = [run("roc", DAY2, { agreementChecks: 2, disagreements: 1, scopeViolations: 1, wrongInput: 1 })];
    const [d] = guardrailRates([], runs, [], { ...DEFAULT_GUARDRAIL_THRESHOLDS, minSample: 1 });
    expect(d.breaches.map((b) => b.metric)).toEqual(["disagreement", "scopeViolation"]);
    expect(d.scopeViolations).toBe(1);
    expect(d.wrongInput).toBe(1);
    expect(guardrailRates([], [], [])).toEqual([]);
  });

  it("formatRate", () => {
    expect(formatRate({ n: 1, d: 3, rate: 1 / 3 })).toBe("33.3%");
    expect(formatRate({ n: 0, d: 0, rate: null })).toBe("—");
  });
});
