// Pure scoring functions of the accuracy harness.
import { describe, expect, it } from "vitest";
import {
  ACCURACY_THRESHOLDS,
  FixtureExpectedSchema,
  SCOREBOARD_END,
  SCOREBOARD_START,
  canonicalOutcome,
  compareFigures,
  countFlags,
  describeFigureDiff,
  failureDetails,
  prf,
  sameEveryRun,
  scoreAgent,
  scoreboardMarkdown,
  upsertScoreboard,
  type FixtureExpected,
  type FixtureOutcome,
  type Flag,
} from "./accuracy";

const B = (ruleId: string): Flag => ({ ruleId, severity: "block" });
const W = (ruleId: string): Flag => ({ ruleId, severity: "warn" });
const expected = (flags: Flag[], figures: Record<string, number> = { totalPaise: 100 }): FixtureExpected => ({ flags, figures, deliverables: [] });
const outcome = (flags: Flag[], figures: Record<string, number> = { totalPaise: 100 }, extra: Partial<FixtureOutcome> = {}): FixtureOutcome => ({ flags, figures, deliverables: [], ...extra });
const thrice = (o: FixtureOutcome) => [o, o, o];

describe("thresholds", () => {
  it("are the spec values, in one object", () => {
    expect(ACCURACY_THRESHOLDS).toEqual({ block: { recall: 0.98, precision: 0.9 }, warn: { recall: 0.9, precision: 0.8 }, figures: 1, schema: 1, replay: 1, runs: 3 });
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
  it("fixture figures must be integers (paise)", () => {
    expect(FixtureExpectedSchema.safeParse({ flags: [], figures: { totalPaise: 1.5 }, deliverables: [] }).success).toBe(false);
    expect(FixtureExpectedSchema.safeParse({ flags: [], figures: {}, deliverables: [], extra: 1 }).success).toBe(false);
  });
});

describe("determinism", () => {
  it("canonical form ignores order; any difference is caught", () => {
    const a = outcome([B("x"), W("y")], { b: 2, a: 1 }, { deliverables: [{ name: "Z", problems: ["p2", "p1"] }, { name: "A", problems: [] }] });
    const b = outcome([W("y"), B("x")], { a: 1, b: 2 }, { deliverables: [{ name: "A", problems: [] }, { name: "Z", problems: ["p1", "p2"] }] });
    expect(canonicalOutcome(a)).toBe(canonicalOutcome(b));
    expect(sameEveryRun([a, b, a])).toEqual({ ok: true });
    expect(sameEveryRun([a, a, outcome([B("x")])])).toEqual({ ok: false, differs: 2 });
    expect(sameEveryRun([])).toEqual({ ok: false, differs: 0 });
  });
});

describe("scoreAgent", () => {
  it("perfect set → P = R = 1, pass", () => {
    const s = scoreAgent("echo", "echo", [{ id: "f1", expected: expected([B("a"), W("b")]), runs: thrice(outcome([B("a"), W("b")])) }], [{ mistakeId: "m", ruleId: "r", caught: true }]);
    expect(s.pass).toBe(true);
    expect(s.severity.block).toMatchObject({ precision: 1, recall: 1 });
    expect(s.severity.warn).toMatchObject({ precision: 1, recall: 1 });
    expect(s.reasons).toEqual([]);
  });

  it("each failure kind is reported with a reason", () => {
    const s = scoreAgent(
      "echo",
      "echo",
      [
        { id: "flags", expected: expected([B("a")]), runs: thrice(outcome([W("x")])) },
        { id: "figs", expected: expected([], { totalPaise: 100 }), runs: thrice(outcome([], { totalPaise: 0 })) },
        { id: "shape", expected: expected([]), runs: thrice(outcome([], { totalPaise: 100 }, { deliverables: [{ name: "Pack", problems: ['sheet "X" missing'] }] })) },
        { id: "flaky", expected: expected([]), runs: [outcome([]), outcome([]), outcome([B("z")])] },
        { id: "short", expected: expected([]), runs: [outcome([])] },
        { id: "broken", expected: expected([]), runs: thrice(outcome([], {}, { error: "FAILED: boom" })) },
        { id: "none", expected: expected([]), runs: [] },
      ],
      [{ mistakeId: "m1", ruleId: "r1", caught: false, reason: "no" }],
    );
    expect(s.pass).toBe(false);
    expect(s.reasons).toEqual([
      "block recall 0.000 < 0.98",
      "warn precision 0.000 < 0.8",
      "figures exact on 4/7 fixtures",
      "deliverable shape valid on 5/7 fixtures",
      "mistake replay caught 0/1",
      "not identical across 3 runs: flaky, short",
      "run errors on broken, none",
    ]);
    const details = failureDetails(s).join("\n");
    expect(details).toContain("flags: missed a (block)");
    expect(details).toContain("flags: unexpected x (warn)");
    expect(details).toContain("figs: totalPaise: expected 100, got 0 (₹1.00 under)");
    expect(details).toContain('shape: Pack: sheet "X" missing');
    expect(details).toContain("mistake m1 (r1) not caught: no");
    expect(details).toContain("broken: FAILED: boom");
  });

  it("no fixtures is a failure", () => {
    expect(scoreAgent("echo", "echo", [], []).reasons).toEqual(["no fixtures"]);
  });

  it("custom thresholds are honoured (one config object)", () => {
    const fx = [{ id: "f", expected: expected([B("a"), B("b")]), runs: [outcome([B("a")])] }];
    expect(scoreAgent("x", "x", fx, [], { ...ACCURACY_THRESHOLDS, block: { recall: 0.5, precision: 0.5 }, runs: 1 }).pass).toBe(true);
  });
});

describe("scoreboard", () => {
  const s = scoreAgent("echo", "accuracy/echo", [{ id: "f1", expected: expected([B("a")]), runs: thrice(outcome([B("a")])) }], []);
  const at = new Date("2026-11-05T14:40:00Z");

  it("markdown block: agent → fixture set → check → P → R → threshold → pass/fail → date (IST)", () => {
    const md = scoreboardMarkdown([s], at);
    expect(md.startsWith(SCOREBOARD_START)).toBe(true);
    expect(md.endsWith(SCOREBOARD_END)).toBe(true);
    expect(md).toContain("| Agent | Fixture set | Check | Precision | Recall | Threshold | Pass/fail | Date (IST) |");
    expect(md).toContain("| echo | accuracy/echo (1) | block flags | 1.000 | 1.000 | R≥0.98 P≥0.9 | pass | 05 Nov 2026 20:10 IST |");
    expect(md).toContain("| **echo** | accuracy/echo (1) | **overall** | – | – | all of the above | **pass** | 05 Nov 2026 20:10 IST |");
    const bad = scoreboardMarkdown([scoreAgent("echo", "e", [{ id: "f", expected: expected([B("a")]), runs: thrice(outcome([])) }], [])], at);
    expect(bad).toContain("| block flags | 1.000 | 0.000 | R≥0.98 P≥0.9 | FAIL |");
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
});
