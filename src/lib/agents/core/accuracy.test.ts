// Pure scoring functions of the accuracy harness.
import { describe, expect, it } from "vitest";
import {
  ACCURACY_THRESHOLDS,
  FIXTURE_MINIMUMS,
  FixtureExpectedSchema,
  SCOREBOARD_END,
  SCOREBOARD_START,
  canonicalOutcome,
  compareFigures,
  countFlags,
  describeFigureDiff,
  failureDetails,
  minimumFixturesFor,
  prf,
  probeVerdict,
  sameEveryRun,
  scoreAgent,
  scoreboardMarkdown,
  upsertScoreboard,
  type FixtureExpected,
  type FixtureOutcome,
  type FixtureRuns,
  type Flag,
  type ScoreContext,
} from "./accuracy";

const B = (ruleId: string): Flag => ({ ruleId, severity: "block" });
const W = (ruleId: string): Flag => ({ ruleId, severity: "warn" });
const I = (ruleId: string): Flag => ({ ruleId, severity: "info" });
const expected = (flags: Flag[], figures: Record<string, number> = { totalPaise: 100 }, extra: Partial<FixtureExpected> = {}): FixtureExpected => ({ flags, figures, deliverables: [], ...extra });
const outcome = (flags: Flag[], figures: Record<string, number> = { totalPaise: 100 }, extra: Partial<FixtureOutcome> = {}): FixtureOutcome => ({ flags, figures, deliverables: [], ...extra });
const thrice = (o: FixtureOutcome) => [o, o, o];
const CHANGED = { changed: true } as const;
/** An internal agent with a declared probe: only the core checks apply. */
const INTERNAL: ScoreContext = { internal: true, probeDeclared: true };
const fx = (id: string, exp: FixtureExpected, runs: FixtureOutcome[], over: Partial<FixtureRuns> = {}): FixtureRuns => ({ id, expected: exp, runs, probe: CHANGED, ...over });

describe("thresholds", () => {
  it("are the spec values, in one object", () => {
    expect(ACCURACY_THRESHOLDS).toEqual({ block: { recall: 0.98, precision: 0.9 }, warn: { recall: 0.9, precision: 0.8 }, figures: 1, schema: 1, replay: 1, runs: 3 });
  });
  it("fixture minimums per production agent (spec: ≥ 15, Books / Audit ≥ 10)", () => {
    expect(FIXTURE_MINIMUMS).toEqual({ gst: 15, roc: 15, tax: 15, books: 10, audit: 10 });
    expect(minimumFixturesFor("gst")).toBe(15);
    expect(minimumFixturesFor("audit")).toBe(10);
    expect(minimumFixturesFor("something-new")).toBe(15);
  });
});

describe("flag counting and P/R/F1", () => {
  it("counts per severity; wrong severity is a miss plus a false alarm", () => {
    expect(countFlags([B("a"), B("b")], [B("a"), B("c")], "block")).toEqual({ tp: 1, fp: 1, fn: 1 });
    expect(countFlags([B("a")], [W("a")], "block")).toEqual({ tp: 0, fp: 0, fn: 1 });
    expect(countFlags([B("a")], [W("a")], "warn")).toEqual({ tp: 0, fp: 1, fn: 0 });
    expect(countFlags([B("a"), B("a")], [B("a")], "block")).toEqual({ tp: 1, fp: 0, fn: 0 });
  });
  it("precision / recall / F1 with the empty conventions", () => {
    expect(prf({ tp: 0, fp: 0, fn: 0 })).toMatchObject({ precision: 1, recall: 1, f1: 1 });
    expect(prf({ tp: 1, fp: 1, fn: 0 })).toMatchObject({ precision: 0.5, recall: 1 });
    expect(prf({ tp: 0, fp: 1, fn: 1 })).toMatchObject({ precision: 0, recall: 0, f1: 0 });
    expect(prf({ tp: 3, fp: 1, fn: 1 }).f1).toBeCloseTo(0.75);
  });
});

describe("figures", () => {
  it("exact integer compare; missing and off-by-a-rupee reported", () => {
    expect(compareFigures({ a: 1, b: 2 }, { a: 1, b: 2, extra: 9 })).toEqual([]);
    const d = compareFigures({ totalPaise: 26682275, rowCount: 3 }, { totalPaise: 26682175 });
    expect(d).toEqual([
      { key: "rowCount", expected: 3, actual: null, deltaPaise: null },
      { key: "totalPaise", expected: 26682275, actual: 26682175, deltaPaise: -100 },
    ]);
    expect(describeFigureDiff(d[1])).toBe("totalPaise: expected 26682275, got 26682175 (₹1.00 under)");
    expect(describeFigureDiff(d[0])).toBe("rowCount: missing (expected 3)");
    expect(describeFigureDiff({ key: "rowCount", expected: 3, actual: 4, deltaPaise: 1 })).toBe("rowCount: expected 3, got 4");
    expect(describeFigureDiff({ key: "largestPaise", expected: 1, actual: 101, deltaPaise: 100 })).toContain("₹1.00 over");
  });
  it("fixture figures must be integers (paise); category is one of clean / typical-gap / trap", () => {
    expect(FixtureExpectedSchema.safeParse({ flags: [], figures: { totalPaise: 1.5 }, deliverables: [] }).success).toBe(false);
    expect(FixtureExpectedSchema.safeParse({ flags: [], figures: {}, deliverables: [], extra: 1 }).success).toBe(false);
    for (const category of ["clean", "typical-gap", "trap"]) expect(FixtureExpectedSchema.safeParse({ category, flags: [], figures: {}, deliverables: [] }).success).toBe(true);
    expect(FixtureExpectedSchema.safeParse({ category: "edge", flags: [], figures: {}, deliverables: [] }).success).toBe(false);
  });
});

describe("determinism and input sensitivity", () => {
  it("canonical form ignores order and requested tasks; any difference is caught", () => {
    const a = outcome([B("x"), W("y")], { b: 2, a: 1 }, { deliverables: [{ name: "Z", problems: ["p2", "p1"] }, { name: "A", problems: [] }], requestedTasks: ["t1"] });
    const b = outcome([W("y"), B("x")], { a: 1, b: 2 }, { deliverables: [{ name: "A", problems: [] }, { name: "Z", problems: ["p1", "p2"] }] });
    expect(canonicalOutcome(a)).toBe(canonicalOutcome(b));
    expect(sameEveryRun([a, b, a])).toEqual({ ok: true });
    expect(sameEveryRun([a, a, outcome([B("x")])])).toEqual({ ok: false, differs: 2 });
    expect(sameEveryRun([])).toEqual({ ok: false, differs: 0 });
  });

  it("probeVerdict: a figure or a flag must move, on a successful run, after a real input change", () => {
    const base = outcome([W("a")], { totalPaise: 100 });
    expect(probeVerdict(base, outcome([W("a")], { totalPaise: 200 }), true)).toEqual({ changed: true });
    expect(probeVerdict(base, outcome([W("a"), B("dup")], { totalPaise: 100 }), true)).toEqual({ changed: true });
    expect(probeVerdict(base, outcome([W("a")], { totalPaise: 100 }, { deliverables: [{ name: "x", problems: ["p"] }] }), true)).toMatchObject({ changed: false, reason: expect.stringMatching(/does not depend on the input/) });
    expect(probeVerdict(base, base, false)).toEqual({ changed: false, reason: "probeMutation left the input unchanged" });
    expect(probeVerdict(base, outcome([], {}, { error: "FAILED: bad" }), true)).toEqual({ changed: false, reason: "run on the mutated input failed: FAILED: bad" });
    expect(probeVerdict(outcome([], {}, { error: "FAILED: x" }), base, true)).toMatchObject({ changed: false, reason: "baseline run failed: FAILED: x" });
    expect(probeVerdict(undefined, base, true)).toMatchObject({ changed: false, reason: "baseline run failed" });
  });
});

describe("scoreAgent", () => {
  it("perfect set → P = R = 1, pass", () => {
    const s = scoreAgent("echo", "echo", [fx("f1", expected([B("a"), W("b")]), thrice(outcome([B("a"), W("b")])))], [{ mistakeId: "m", ruleId: "r", caught: true }], ACCURACY_THRESHOLDS, INTERNAL);
    expect(s.pass).toBe(true);
    expect(s.severity.block).toMatchObject({ precision: 1, recall: 1 });
    expect(s.severity.warn).toMatchObject({ precision: 1, recall: 1 });
    expect(s.sensitivity).toEqual({ declared: true, changed: 1, total: 1, ok: true, failures: [] });
    expect(s.mode).toBe("recorded");
    expect(s.reasons).toEqual([]);
  });

  it("each failure kind is reported with a reason", () => {
    const s = scoreAgent(
      "echo",
      "echo",
      [
        fx("flags", expected([B("a")]), thrice(outcome([W("x")]))),
        fx("figs", expected([], { totalPaise: 100 }), thrice(outcome([], { totalPaise: 0 }))),
        fx("shape", expected([]), thrice(outcome([], { totalPaise: 100 }, { deliverables: [{ name: "Pack", problems: ['sheet "X" missing'] }] }))),
        fx("flaky", expected([]), [outcome([]), outcome([]), outcome([B("z")])]),
        fx("short", expected([]), [outcome([])]),
        fx("broken", expected([]), thrice(outcome([], {}, { error: "FAILED: boom" }))),
        fx("none", expected([]), []),
      ],
      [{ mistakeId: "m1", ruleId: "r1", caught: false, reason: "no" }],
      ACCURACY_THRESHOLDS,
      INTERNAL,
    );
    expect(s.pass).toBe(false);
    expect(s.reasons).toEqual([
      "block recall (deterministic rules) 0.000 < 0.98",
      "warn precision (deterministic rules) 0.000 < 0.8",
      "figures exact on 4/7 fixtures",
      "deliverable shape valid on 5/7 fixtures",
      "mistake replay caught 0/1",
      "not identical across 3 runs: flaky, short",
      "run errors on broken, none",
    ]);
    const details = failureDetails(s).join("\n");
    expect(details).toContain("flags: missed a (block, deterministic)");
    expect(details).toContain("flags: unexpected x (warn, deterministic)");
    expect(details).toContain("figs: totalPaise: expected 100, got 0 (₹1.00 under)");
    expect(details).toContain('shape: Pack: sheet "X" missing');
    expect(details).toContain("mistake m1 (r1) not caught: no");
    expect(details).toContain("broken: FAILED: boom");
  });

  it("no fixtures is a failure", () => {
    expect(scoreAgent("echo", "echo", [], [], ACCURACY_THRESHOLDS, INTERNAL).reasons).toEqual(["no fixtures"]);
  });

  it("custom thresholds are honoured (one config object)", () => {
    const f = [fx("f", expected([B("a"), B("b")]), [outcome([B("a")])])];
    expect(scoreAgent("x", "x", f, [], { ...ACCURACY_THRESHOLDS, block: { recall: 0.5, precision: 0.5 }, runs: 1 }, INTERNAL).pass).toBe(true);
  });

  describe("split by rule kind, mode-aware gating", () => {
    const kinds = { "det.b": "deterministic", "llm.b": "llm", "det.w": "deterministic", "llm.w": "llm" } as const;
    // 20 fixtures: the deterministic block rule is right everywhere; the LLM warn rule misses once.
    const set = (llmMiss: boolean) =>
      Array.from({ length: 20 }, (_, i) => {
        const want = i % 2 ? [B("det.b"), W("llm.w")] : [];
        const got = llmMiss && i === 1 ? [B("det.b")] : want;
        return fx(`f${i}`, expected(want), thrice(outcome(got)));
      });

    it("recorded mode: deterministic split on thresholds; any LLM discrepancy fails as code path; combined is informational", () => {
      const ok = scoreAgent("x", "x", set(false), [], ACCURACY_THRESHOLDS, { ...INTERNAL, ruleKinds: kinds });
      expect(ok.pass).toBe(true);
      expect(ok.split.block.deterministic).toMatchObject({ tp: 10, fp: 0, fn: 0 });
      expect(ok.split.warn.llm).toMatchObject({ tp: 10, fp: 0, fn: 0 });
      expect(ok.split.warn.deterministic).toMatchObject({ tp: 0, fp: 0, fn: 0 });

      // One LLM miss in 10 = recall 0.9, which would pass the warn threshold — but in recorded mode the
      // recording decided the answer, so a dropped flag is a pipeline bug.
      const miss = scoreAgent("x", "x", set(true), [], ACCURACY_THRESHOLDS, { ...INTERNAL, ruleKinds: kinds });
      expect(miss.split.warn.llm.recall).toBeCloseTo(0.9);
      expect(miss.reasons).toEqual(["warn LLM flags do not match the recorded verdicts (code path): 1 missed, 0 unexpected"]);
      const md = scoreboardMarkdown([miss], new Date("2026-11-05T14:40:00Z"));
      expect(md).toContain("| warn flags · LLM rules (recorded: code path) | 1.000 | 0.900 | 9/0/1 | match recordings exactly | FAIL |");
      expect(md).toContain("| warn flags · all rules | 1.000 | 0.900 | 9/0/1 | informational (recorded mode) | info |");
      expect(md).toContain("Mode: **recorded**");
    });

    it("live mode: LLM and combined rows are gated on the thresholds", () => {
      const live = scoreAgent("x", "x", set(true), [], ACCURACY_THRESHOLDS, { ...INTERNAL, ruleKinds: kinds, mode: "live" });
      expect(live.pass).toBe(true); // recall 0.9 ≥ 0.9
      const md = scoreboardMarkdown([live], new Date("2026-11-05T14:40:00Z"));
      expect(md).toContain("| warn flags · LLM rules | 1.000 | 0.900 | 9/0/1 | R≥0.9 P≥0.8 | pass |");
      expect(md).toContain("| warn flags · all rules | 1.000 | 0.900 | 9/0/1 | R≥0.9 P≥0.8 | pass |");
      expect(md).toContain("| 3× identical |");
      expect(md).toContain("Mode: **live**");
      const worse = set(true);
      worse[3] = fx("f3", expected([B("det.b"), W("llm.w")]), thrice(outcome([B("det.b")])));
      const fail = scoreAgent("x", "x", worse, [], ACCURACY_THRESHOLDS, { ...INTERNAL, ruleKinds: kinds, mode: "live" });
      expect(fail.reasons).toEqual(["warn recall (LLM rules) 0.800 < 0.9", "warn recall (all rules) 0.800 < 0.9"]);
    });

    it("a flag whose rule the pack does not know is deterministic (gated) and reported", () => {
      const s = scoreAgent("x", "x", [fx("f", expected([W("gone.rule")]), thrice(outcome([])))], [], ACCURACY_THRESHOLDS, { ...INTERNAL, ruleKinds: kinds });
      expect(s.split.warn.deterministic).toMatchObject({ fn: 1 });
      expect(s.unknownRules).toEqual(["gone.rule"]);
      expect(s.reasons).toContain("expected flag(s) for rule(s) not in the checklist pack: gone.rule (missing _mistakes promotion?)");
    });
  });

  describe("input sensitivity", () => {
    const one = (probe?: FixtureRuns["probe"]) => [fx("f", expected([]), thrice(outcome([])), { probe })];
    it("a production agent without probeMutation fails: not declared", () => {
      const s = scoreAgent("x", "x", one(undefined), [], ACCURACY_THRESHOLDS, { internal: false, probeDeclared: false, minimumFixtures: 1 });
      expect(s.sensitivity.ok).toBe(false);
      expect(s.reasons).toContain("input sensitivity: not declared (agents that are not internal must define probeMutation)");
      expect(scoreboardMarkdown([s], new Date())).toContain("| input sensitivity | – | – | – | not declared · required (agent is not internal) | FAIL |");
    });
    it("an internal agent without probeMutation is shown, not gated", () => {
      const s = scoreAgent("x", "x", one(undefined), [], ACCURACY_THRESHOLDS, { internal: true, probeDeclared: false });
      expect(s.pass).toBe(true);
      expect(scoreboardMarkdown([s], new Date())).toContain("| input sensitivity | – | – | – | not declared · internal agent, not gated | info |");
    });
    it("a declared probe that changes nothing (or never ran) fails, with the reason", () => {
      const s = scoreAgent("x", "x", one({ changed: false, reason: "same figures and flags after one input value changed: the result does not depend on the input" }), [], ACCURACY_THRESHOLDS, INTERNAL);
      expect(s.reasons).toEqual(["input sensitivity: result unchanged or probe failed on f"]);
      expect(failureDetails(s).join("\n")).toContain("f: input sensitivity — same figures and flags");
      expect(scoreAgent("x", "x", one(undefined), [], ACCURACY_THRESHOLDS, INTERNAL).sensitivity.failures).toEqual([{ fixtureId: "f", reason: "probe not run" }]);
    });
    it("defaults are fail-closed: a context-less score is a production agent with no probe", () => {
      const s = scoreAgent("gst", "gst", one(CHANGED), []);
      expect(s.internal).toBe(false);
      expect(s.reasons).toContain("input sensitivity: not declared (agents that are not internal must define probeMutation)");
      expect(s.reasons.some((r) => r.startsWith("thin fixture set: 1 fixture(s), gst needs at least 15"))).toBe(true);
    });
  });

  describe("thin fixture sets (production agents)", () => {
    const PROD: ScoreContext = { internal: false, probeDeclared: true };
    const full = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const category = (["clean", "typical-gap", "trap"] as const)[i % 3];
        const flags = category === "trap" ? [B("b")] : category === "typical-gap" ? [W("w")] : [];
        return fx(`f${i}`, expected(flags, { totalPaise: 100 }, { category }), thrice(outcome(flags)));
      });

    it("a full set passes (books: 10)", () => {
      const s = scoreAgent("books", "books", full(10), [], ACCURACY_THRESHOLDS, PROD);
      expect(s.reasons).toEqual([]);
      expect(s.support).toMatchObject({ minimum: 10, categories: { clean: 4, "typical-gap": 3, trap: 3 }, expected: { block: 3, warn: 3, info: 0 }, problems: [] });
      expect(scoreboardMarkdown([s], new Date())).toContain("| fixture set | – | – | – | clean 4 / typical-gap 3 / trap 3; expected block 3, warn 3 · need ≥10 fixtures, every category, ≥1 block & ≥1 warn expected | pass |");
    });

    it("too few fixtures, missing categories and no block / warn support all fail", () => {
      const thin = [fx("a", expected([], { totalPaise: 1 }, { category: "clean" }), thrice(outcome([], { totalPaise: 1 }))), fx("b", expected([]), thrice(outcome([])))];
      const s = scoreAgent("gst", "gst", thin, [], ACCURACY_THRESHOLDS, PROD);
      expect(s.support.problems).toEqual([
        "thin fixture set: 2 fixture(s), gst needs at least 15",
        "thin fixture set: no category (clean / typical-gap / trap) on b",
        "thin fixture set: no typical-gap fixture",
        "thin fixture set: no trap fixture",
        "thin fixture set: 0 expected block flag(s) across the set, need at least 1",
        "thin fixture set: 0 expected warn flag(s) across the set, need at least 1",
      ]);
      expect(s.pass).toBe(false);
      expect(scoreboardMarkdown([s], new Date())).toMatch(/\| fixture set \| – \| – \| – \| clean 1 \/ typical-gap 0 \/ trap 0 \/ none 1; expected block 0, warn 0 · need ≥15 fixtures.* \| FAIL \|/);
    });

    it("empty expected figures when compute returns figures fail for every agent (internal too)", () => {
      const s = scoreAgent("echo", "echo", [fx("nofig", expected([], {}), thrice(outcome([], { totalPaise: 5 })))], [], ACCURACY_THRESHOLDS, INTERNAL);
      expect(s.reasons).toEqual(["thin fixture set: nofig has empty expected figures but compute returns figures"]);
      const okEmpty = scoreAgent("echo", "echo", [fx("nofig", expected([], {}), thrice(outcome([], {})))], [], ACCURACY_THRESHOLDS, INTERNAL);
      expect(okEmpty.pass).toBe(true);
    });

    it("internal agents are exempt from count / category / support rules", () => {
      const s = scoreAgent("echo", "echo", [fx("only", expected([]), thrice(outcome([])))], [], ACCURACY_THRESHOLDS, INTERNAL);
      expect(s.pass).toBe(true);
      expect(s.support.minimum).toBeNull();
    });
  });

  it("stale recordings are noted, not gated", () => {
    const s = scoreAgent("echo", "echo", [fx("f", expected([]), thrice(outcome([])), { unusedRecordings: ["system.echo-extract"] })], [], ACCURACY_THRESHOLDS, INTERNAL);
    expect(s.pass).toBe(true);
    expect(s.notes).toEqual(["f: recorded.json has responses no run asked for (system.echo-extract); remove stale recordings"]);
  });
});

describe("scoreboard", () => {
  const s = scoreAgent("echo", "accuracy/echo", [fx("f1", expected([B("a"), I("i")]), thrice(outcome([B("a"), I("i")])))], [], ACCURACY_THRESHOLDS, INTERNAL);
  const at = new Date("2026-11-05T14:40:00Z");

  it("markdown block: agent → fixture set → check → P → R → tp/fp/fn → threshold → pass/fail → date (IST)", () => {
    const md = scoreboardMarkdown([s], at);
    expect(md.startsWith(SCOREBOARD_START)).toBe(true);
    expect(md.endsWith(SCOREBOARD_END)).toBe(true);
    expect(md).toContain("| Agent | Fixture set | Check | Precision | Recall | tp/fp/fn | Threshold | Pass/fail | Date (IST) |");
    expect(md).toContain("| echo | accuracy/echo (1) | block flags · deterministic rules | 1.000 | 1.000 | 1/0/0 | R≥0.98 P≥0.9 | pass | 05 Nov 2026 20:10 IST |");
    expect(md).toContain("| echo | accuracy/echo (1) | block flags · LLM rules (recorded: code path) | n/a | n/a | 0/0/0 | match recordings exactly | n/a | 05 Nov 2026 20:10 IST |");
    expect(md).toContain("| echo | accuracy/echo (1) | warn flags · deterministic rules | n/a | n/a | 0/0/0 | R≥0.9 P≥0.8 | n/a |");
    expect(md).toContain("| echo | accuracy/echo (1) | info flags | 1.000 | 1.000 | 1/0/0 | not thresholded | info |");
    expect(md).toContain("| echo | accuracy/echo (1) | input sensitivity | – | – | – | 1/1 changed · need all | pass |");
    expect(md).toContain("| echo | accuracy/echo (1) | 3× identical (code path) | – | – | – | 1/1 · need all | pass |");
    expect(md).toContain("| **echo** | accuracy/echo (1) | **overall** | – | – | – | all of the above | **pass** | 05 Nov 2026 20:10 IST |");
    const bad = scoreboardMarkdown([scoreAgent("echo", "e", [fx("f", expected([B("a")]), thrice(outcome([])))], [], ACCURACY_THRESHOLDS, INTERNAL)], at);
    expect(bad).toContain("| block flags · deterministic rules | 1.000 | 0.000 | 0/0/1 | R≥0.98 P≥0.9 | FAIL |");
  });

  it("upsert: new file, marked block, section body, or append — rest of the file untouched", () => {
    const block = `${SCOREBOARD_START}\nNEW\n${SCOREBOARD_END}`;
    expect(upsertScoreboard(null, block)).toBe(`${block}\n`);
    expect(upsertScoreboard(`# P\nbefore\n${SCOREBOARD_START}\nOLD\n${SCOREBOARD_END}\nafter\n`, block)).toBe(`# P\nbefore\n${block}\nafter\n`);
    const progress = "# PROGRESS\n## Accuracy scoreboard     (agent → …)\n_None yet (from Phase 5)._\n\n## Decisions (ADR index)\n- x\n";
    expect(upsertScoreboard(progress, block)).toBe(`# PROGRESS\n## Accuracy scoreboard     (agent → …)\n${block}\n\n## Decisions (ADR index)\n- x\n`);
    expect(upsertScoreboard("# Notes\n## Accuracy scoreboard\nold", block)).toBe(`# Notes\n## Accuracy scoreboard\n${block}\n\n`);
    expect(upsertScoreboard("# Other\ntext\n\n", block)).toBe(`# Other\ntext\n\n${block}\n`);
  });

  it("upsert keeps the markers: repeated writes replace in place, never duplicate", () => {
    const md = scoreboardMarkdown([s], at);
    const once = upsertScoreboard("# PROGRESS\n## Accuracy scoreboard\nold\n\n## Next\n", md);
    const twice = upsertScoreboard(once, scoreboardMarkdown([s], new Date("2026-11-06T04:00:00Z")));
    for (const doc of [once, twice]) {
      expect(doc.split(SCOREBOARD_START)).toHaveLength(2);
      expect(doc.split(SCOREBOARD_END)).toHaveLength(2);
      expect(doc).toContain("## Next");
    }
    expect(twice).toContain("06 Nov 2026");
    expect(twice).not.toContain("05 Nov 2026 20:10");
    expect(() => upsertScoreboard("x", "no markers")).toThrow(/markers/);
  });
});
