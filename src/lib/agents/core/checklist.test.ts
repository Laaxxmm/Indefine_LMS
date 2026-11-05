import { describe, it, expect, vi } from "vitest";
import {
  bumpMinor,
  createRuleRegistry,
  hasBlockingFailures,
  loadRuleSet,
  normalizeEvidenceText,
  quoteInContext,
  rulesFromMistakeLogs,
  runChecklist,
  summarizeChecklist,
  toChecklistResultRows,
  withPromotedRule,
  type ChecklistPack,
  type ChecklistResultItem,
  type LlmCheck,
  type RuleDefinition,
  type RuleSet,
} from "./checklist";

type Input = { invoices: { no: string; gstin: string; value: number }[]; boom?: boolean };

const registry = createRuleRegistry<Input>({
  "gstin-format": (input) => {
    const bad = input.invoices.find((i) => !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(i.gstin));
    return bad
      ? { status: "fail", message: `Invalid GSTIN on invoice ${bad.no}`, evidence: { quote: bad.gstin, location: `sales register, invoice ${bad.no}` } }
      : { status: "pass" };
  },
  "series-gaps": (input, rule) => {
    if (input.boom) throw new Error("register unreadable");
    const max = Number(rule.params?.maxGap ?? 0);
    return input.invoices.length > max ? { status: "pass", message: "  " } : { status: "na" };
  },
  "throws-string": () => {
    throw "plain string";
  },
});

const pack: ChecklistPack = {
  schemaVersion: 1,
  key: "gst",
  version: "1.2.0",
  rules: [
    { id: "gst.rcm-liability", title: "RCM liability", severity: "warn", kind: "llm", check: "Is there any RCM supply?", evidence: "Purchase register row" },
    { id: "gst.gstin-format", title: "Counterparty GSTIN format", severity: "block", kind: "deterministic", check: "gstin-format", evidence: "Invoice number and GSTIN" },
    { id: "gst.series", title: "Invoice series gaps", severity: "info", kind: "deterministic", check: "series-gaps", evidence: "Invoice numbers", params: { maxGap: 0 }, failMessage: "Series has gaps" },
  ],
};

const cleanInput: Input = { invoices: [{ no: "INV-1", gstin: "29ABCDE1234F1Z5", value: 1000 }] };
const ok = (r: ReturnType<typeof loadRuleSet>): RuleSet => {
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.ruleSet;
};

describe("loadRuleSet", () => {
  it("parses a pack and keeps rule order", () => {
    const rs = ok(loadRuleSet(pack, registry));
    expect(rs.key).toBe("gst");
    expect(rs.version).toBe("1.2.0");
    expect(rs.rules.map((r) => r.id)).toEqual(["gst.rcm-liability", "gst.gstin-format", "gst.series"]);
  });

  it("rejects a malformed pack with readable errors", () => {
    const r = loadRuleSet({ schemaVersion: 1, key: "gst", version: "1.2", rules: [{ id: "X Y", severity: "high" }] }, registry);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.startsWith("version:"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("rules.0.id:"))).toBe(true);
      expect(r.errors.some((e) => e.startsWith("rules.0.severity:"))).toBe(true);
    }
    const root = loadRuleSet(null, registry);
    expect(root.ok).toBe(false);
    if (!root.ok) expect(root.errors[0]).toMatch(/^\(root\):/);
  });

  it("rejects duplicate rule ids and unknown fields", () => {
    const dup = loadRuleSet({ ...pack, rules: [pack.rules[1], pack.rules[1]] }, registry);
    expect(dup).toMatchObject({ ok: false, errors: [expect.stringContaining("duplicate rule id gst.gstin-format")] });
    const extra = loadRuleSet({ ...pack, rules: [{ ...pack.rules[1], fn: "() => true" }] }, registry);
    expect(extra.ok).toBe(false);
  });

  it("fails closed when a deterministic rule has no implementation", () => {
    const r = loadRuleSet({ ...pack, rules: [{ ...pack.rules[1], check: "not-registered" }] }, registry);
    expect(r).toEqual({ ok: false, errors: ['rule gst.gstin-format: no deterministic implementation registered as "not-registered"'] });
  });

  it("appends extra (mistake) rules and refuses id clashes", () => {
    const extra: RuleDefinition = { ...pack.rules[0], id: "gst.extra" };
    expect(ok(loadRuleSet(pack, registry, [extra])).rules.map((r) => r.id)).toContain("gst.extra");
    expect(loadRuleSet(pack, registry, [pack.rules[0]])).toMatchObject({ ok: false, errors: ["extra rule gst.rcm-liability duplicates a pack rule"] });
  });
});

describe("runChecklist", () => {
  const goodVerdict = { status: "fail", message: "RCM on legal fees not booked", evidence: { quote: "Legal fees - Adv. Rao 50,000", location: "purchase register row 14" } };
  /** The documents text LLM rules are given in these tests; verdict quotes must occur in it. */
  const DOCS = "purchase register row 14: Legal fees - Adv. Rao 50,000\nnotes p.2: No RCM supplies";
  const llmContext = () => DOCS;

  it("runs deterministic rules first, then LLM rules", async () => {
    const calls: string[] = [];
    const llm: LlmCheck<Input> = async (rule) => {
      calls.push(`llm:${rule.id}`);
      return goodVerdict;
    };
    const results = await runChecklist(ok(loadRuleSet(pack, registry)), cleanInput, { registry, llmCheck: llm, llmContext });
    expect(results.map((r) => [r.ruleId, r.source])).toEqual([
      ["gst.gstin-format", "deterministic"],
      ["gst.series", "deterministic"],
      ["gst.rcm-liability", "llm"],
    ]);
    expect(calls).toEqual(["llm:gst.rcm-liability"]);
    expect(results[0]).toEqual({ ruleId: "gst.gstin-format", title: "Counterparty GSTIN format", severity: "block", status: "pass", message: "Counterparty GSTIN format: OK", evidence: null, source: "deterministic", flags: [] });
    expect(results[1].message).toBe("Invoice series gaps: OK");
    expect(results[2]).toMatchObject({ status: "fail", message: "RCM on legal fees not booked", evidence: goodVerdict.evidence, flags: [] });
  });

  it("passes the rule and its params to the implementation", async () => {
    const results = await runChecklist(ok(loadRuleSet({ ...pack, rules: [{ ...pack.rules[2], params: { maxGap: 5 } }] }, registry)), cleanInput, { registry });
    expect(results[0]).toMatchObject({ status: "na", message: "Invoice series gaps: not applicable" });
  });

  it("reports failures with evidence from the deterministic check", async () => {
    const input: Input = { invoices: [{ no: "INV-7", gstin: "29ABCDE1234F1Z", value: 10 }] };
    const [r] = await runChecklist(ok(loadRuleSet({ ...pack, rules: [pack.rules[1]] }, registry)), input, { registry });
    expect(r).toMatchObject({ status: "fail", message: "Invalid GSTIN on invoice INV-7", evidence: { quote: "29ABCDE1234F1Z", location: "sales register, invoice INV-7" } });
  });

  it("a throwing deterministic check is recorded as fail (fail-safe) with a flag", async () => {
    const [r] = await runChecklist(ok(loadRuleSet({ ...pack, rules: [pack.rules[2]] }, registry)), { ...cleanInput, boom: true }, { registry });
    expect(r).toMatchObject({ status: "fail", flags: ["check-error"], message: expect.stringContaining("this check could not run, so treat it as not checked and check it by hand. Register unreadable.") });
    const thrower: RuleDefinition = { ...pack.rules[2], id: "x.throws", check: "throws-string" };
    const [s] = await runChecklist({ key: "x", version: "1.0.0", rules: [thrower] }, cleanInput, { registry });
    expect(s.message).toContain("Plain string");
  });

  it("a deterministic rule with no implementation at run time is a flagged fail", async () => {
    const rule: RuleDefinition = { ...pack.rules[1], check: "gone" };
    const [r] = await runChecklist({ key: "gst", version: "1.2.0", rules: [rule] }, cleanInput, { registry });
    expect(r).toMatchObject({ status: "fail", flags: ["missing-implementation"] });
    expect(hasBlockingFailures([r])).toBe(true);
  });

  it("without an llmCheck, LLM rules are na + llm-unavailable", async () => {
    const results = await runChecklist(ok(loadRuleSet(pack, registry)), cleanInput, { registry });
    expect(results[2]).toMatchObject({ status: "na", flags: ["llm-unavailable"], evidence: null });
  });

  it("an llmCheck that throws gives na + llm-error", async () => {
    const llm = vi.fn(async () => {
      throw new Error("timeout");
    });
    const results = await runChecklist(ok(loadRuleSet(pack, registry)), cleanInput, { registry, llmCheck: llm });
    expect(results[2]).toMatchObject({ status: "na", flags: ["llm-error"], message: expect.stringContaining("the AI could not check this, so check it by hand. It took too long and was stopped.") });
    expect(llm).toHaveBeenCalledWith(expect.objectContaining({ id: "gst.rcm-liability" }), cleanInput, JSON.stringify(cleanInput, null, 2));
  });

  it.each([
    ["no evidence", { status: "pass" }],
    ["quote but no location", { status: "fail", evidence: { quote: "x" } }],
    ["location but no quote", { status: "fail", evidence: { location: "row 3" } }],
    ["blank quote", { status: "pass", evidence: { quote: "   ", location: "row 3" } }],
    ["blank location", { status: "pass", evidence: { quote: "abc", location: "" } }],
    ["bad status", { status: "maybe", evidence: { quote: "abc", location: "row 1" } }],
    ["not an object", "yes"],
    ["null", null],
  ])("rejects an LLM verdict with %s", async (_name, verdict) => {
    const results = await runChecklist(ok(loadRuleSet(pack, registry)), cleanInput, { registry, llmCheck: async () => verdict });
    expect(results[2]).toMatchObject({ status: "na", flags: ["llm-evidence-missing"], evidence: null });
  });

  it("accepts an LLM pass with quote + location and uses the default message; a link from the model is never kept (ADR-009, LLM05)", async () => {
    const results = await runChecklist(ok(loadRuleSet(pack, registry)), cleanInput, {
      registry,
      llmContext,
      llmCheck: async () => ({ status: "pass", evidence: { quote: "No RCM supplies", location: "notes p.2", link: "javascript:alert(1)" } }),
    });
    expect(results[2]).toMatchObject({ status: "pass", message: "RCM liability: OK" });
    expect(results[2].evidence).toEqual({ quote: "No RCM supplies", location: "notes p.2" });
  });

  it("uses failMessage when a failing check gives no message", async () => {
    const reg = createRuleRegistry<Input>({ "series-gaps": () => ({ status: "fail" }) });
    const [r] = await runChecklist({ key: "gst", version: "1.0.0", rules: [pack.rules[2]] }, cleanInput, { registry: reg });
    expect(r.message).toBe("Series has gaps");
    const noMsg: RuleDefinition = { ...pack.rules[2], failMessage: undefined };
    const [s] = await runChecklist({ key: "gst", version: "1.0.0", rules: [noMsg] }, cleanInput, { registry: reg });
    expect(s.message).toBe("Invoice series gaps: failed");
  });

  it("is deterministic across runs", async () => {
    const llm = async () => goodVerdict;
    const rs = ok(loadRuleSet(pack, registry));
    const a = await runChecklist(rs, cleanInput, { registry, llmCheck: llm, llmContext });
    const b = await runChecklist(rs, cleanInput, { registry, llmCheck: llm, llmContext });
    expect(a).toEqual(b);
    expect(a[2].status).toBe("fail");
  });

  describe("LLM evidence must quote the documents the rule was given", () => {
    const run = (verdict: unknown, ctx: (() => string) | null = llmContext) =>
      runChecklist(ok(loadRuleSet(pack, registry)), cleanInput, { registry, llmCheck: async () => verdict, ...(ctx ? { llmContext: ctx } : {}) }).then((r) => r[2]);

    it("a fabricated quote (not in the documents) is rejected: na + llm-evidence-missing, so it raises no flag", async () => {
      const r = await run({ status: "fail", message: "RCM on security services", evidence: { quote: "Security services - Guardwell 1,20,000", location: "purchase register row 9" } });
      expect(r).toMatchObject({ status: "na", flags: ["llm-evidence-missing"], evidence: null });
      expect(r.message).toMatch(/quote does not occur in the documents/);
    });

    it("a fabricated quote cannot clear a rule either (pass is rejected the same way)", async () => {
      expect(await run({ status: "pass", evidence: { quote: "All RCM liabilities booked", location: "notes p.1" } })).toMatchObject({ status: "na", flags: ["llm-evidence-missing"] });
    });

    it("only whitespace and letter case are normalised", async () => {
      expect(await run({ status: "fail", evidence: { quote: "  legal FEES -   adv. rao\n50,000 ", location: "row 14" } })).toMatchObject({ status: "fail", flags: [] });
      expect(await run({ status: "fail", evidence: { quote: "Legal fees, Adv. Rao 50,000", location: "row 14" } })).toMatchObject({ status: "na", flags: ["llm-evidence-missing"] });
      expect(await run({ status: "fail", evidence: { quote: "Legal fees - Adv Rao 50000", location: "row 14" } })).toMatchObject({ status: "na", flags: ["llm-evidence-missing"] });
    });

    it("without an llmContext the quote is checked against the input as JSON", async () => {
      expect(await run({ status: "pass", evidence: { quote: "29ABCDE1234F1Z5", location: "invoice INV-1" } }, null)).toMatchObject({ status: "pass", flags: [] });
      expect(await run({ status: "pass", evidence: { quote: "No RCM supplies", location: "notes p.2" } }, null)).toMatchObject({ status: "na", flags: ["llm-evidence-missing"] });
    });

    it("the llmCheck receives exactly the documents text the quote is checked against", async () => {
      const seen: string[] = [];
      await runChecklist(ok(loadRuleSet(pack, registry)), cleanInput, {
        registry,
        llmContext: (rule, input) => `${rule.id}: ${input.invoices[0].no}`,
        llmCheck: async (_rule, _input, context) => {
          seen.push(context);
          return goodVerdict;
        },
      });
      expect(seen).toEqual(["gst.rcm-liability: INV-1"]);
    });

    it("an llmContext that throws gives na + llm-error", async () => {
      const r = await run(goodVerdict, () => {
        throw new Error("register unreadable");
      });
      expect(r).toMatchObject({ status: "na", flags: ["llm-error"], message: expect.stringContaining("Register unreadable.") });
    });

    it("quoteInContext / normalizeEvidenceText", () => {
      expect(normalizeEvidenceText("  A\t b\n\nC ")).toBe("a b c");
      expect(quoteInContext("b  C", "a b\nc d")).toBe(true);
      expect(quoteInContext("   ", "anything")).toBe(false);
      expect(quoteInContext("x", "")).toBe(false);
    });
  });
});

describe("mistake-promoted rules", () => {
  const proposal = {
    id: "gst.blocked-credit-motor-car",
    title: "ITC on motor car (s.17(5))",
    severity: "block",
    kind: "deterministic",
    check: "gstin-format",
    evidence: "Purchase register row",
  };

  it("turns approved, promoted MistakeLogs into rules with source mistake", async () => {
    const { rules, skipped } = rulesFromMistakeLogs([
      { id: "m1", status: "APPROVED", ruleProposal: proposal, promotedToVersion: "1.3.0" },
      { id: "m2", status: "PROPOSED", ruleProposal: proposal, promotedToVersion: null },
      { id: "m3", status: "REJECTED", ruleProposal: proposal, promotedToVersion: null },
      { id: "m4", status: "APPROVED", ruleProposal: proposal, promotedToVersion: null },
      { id: "m5", status: "APPROVED", ruleProposal: { ...proposal, severity: "fatal" }, promotedToVersion: "1.3.0" },
      { id: "m6", status: "APPROVED", ruleProposal: { ...proposal, origin: { type: "mistake" } }, promotedToVersion: "1.3.0" },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].origin).toEqual({ type: "mistake", mistakeLogId: "m1", promotedInVersion: "1.3.0" });
    expect(skipped.map((s) => s.id)).toEqual(["m2", "m3", "m4", "m5", "m6"]);
    expect(skipped[0].reason).toBe("status PROPOSED");
    expect(skipped[2].reason).toMatch(/not promoted/);
    expect(skipped[3].reason).toMatch(/invalid rule proposal/);

    const results = await runChecklist(ok(loadRuleSet(pack, registry, rules)), cleanInput, { registry });
    expect(results.find((r) => r.ruleId === proposal.id)?.source).toBe("mistake");
  });

  it("an LLM mistake rule also reports source mistake", async () => {
    const llmRule: RuleDefinition = { ...pack.rules[0], id: "gst.m-llm", origin: { type: "mistake", mistakeLogId: "m9", promotedInVersion: "1.2.0" } };
    const [r] = await runChecklist({ key: "gst", version: "1.2.0", rules: [llmRule] }, cleanInput, {
      registry,
      llmCheck: async () => ({ status: "pass", evidence: { quote: "q", location: "l" } }),
    });
    expect(r.source).toBe("mistake");
  });

  it("withPromotedRule bumps the minor version and leaves the input pack untouched", () => {
    const next = withPromotedRule(pack, proposal, "m1");
    expect(next.version).toBe("1.3.0");
    expect(next.rules).toHaveLength(4);
    expect(next.rules[3].origin).toEqual({ type: "mistake", mistakeLogId: "m1", promotedInVersion: "1.3.0" });
    expect(pack.version).toBe("1.2.0");
    expect(pack.rules).toHaveLength(3);
    expect(() => withPromotedRule(next, proposal, "m1")).toThrow(/already exists/);
    expect(() => withPromotedRule(pack, { ...proposal, kind: "magic" }, "m1")).toThrow();
  });

  it("bumpMinor", () => {
    expect(bumpMinor("1.3.2")).toBe("1.4.0");
    expect(bumpMinor("0.9.0")).toBe("0.10.0");
    expect(() => bumpMinor("v1")).toThrow(/semver/);
  });
});

describe("summary and persistence", () => {
  const r = (over: Partial<ChecklistResultItem>): ChecklistResultItem => ({
    ruleId: "x",
    title: "X",
    severity: "warn",
    status: "pass",
    message: "m",
    evidence: null,
    source: "deterministic",
    flags: [],
    ...over,
  });
  const results = [
    r({ ruleId: "a", severity: "block", status: "fail", evidence: { quote: "q", location: "l" } }),
    r({ ruleId: "b", severity: "block", status: "pass" }),
    r({ ruleId: "c", severity: "warn", status: "fail", source: "llm" }),
    r({ ruleId: "d", severity: "info", status: "na", source: "llm", flags: ["llm-evidence-missing"] }),
    r({ ruleId: "e", severity: "block", status: "na", source: "mistake" }),
  ];

  it("counts by severity, status and source", () => {
    expect(summarizeChecklist(results)).toEqual({
      total: 5,
      byStatus: { pass: 1, fail: 2, na: 2 },
      bySeverity: { block: { pass: 1, fail: 1, na: 1 }, warn: { pass: 0, fail: 1, na: 0 }, info: { pass: 0, fail: 0, na: 1 } },
      bySource: { deterministic: 2, llm: 2, mistake: 1 },
      blockingFailures: 1,
      flagged: 1,
      hasBlockingFailures: true,
    });
  });

  it("hasBlockingFailures only for block + fail", () => {
    expect(hasBlockingFailures(results)).toBe(true);
    expect(hasBlockingFailures(results.filter((x) => x.ruleId !== "a"))).toBe(false);
    expect(summarizeChecklist([]).hasBlockingFailures).toBe(false);
  });

  it("maps results to ChecklistResult rows with flags inside evidence", () => {
    const rows = toChecklistResultRows("run-1", results);
    expect(rows[0]).toEqual({ agentRunId: "run-1", ruleId: "a", severity: "block", status: "fail", message: "m", evidence: { quote: "q", location: "l" }, source: "deterministic" });
    expect(rows[1].evidence).toBeUndefined();
    expect(rows[3].evidence).toEqual({ flags: ["llm-evidence-missing"] });
  });
});
