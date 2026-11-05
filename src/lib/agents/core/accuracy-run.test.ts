// Accuracy harness self-tests (Phase 4 QA gate): the perfect echo fixture set scores P = R = 1 and
// passes; a corrupted fixture (flags altered, a figure off by ₹1) is detected and fails; a
// nondeterministic model is caught by the 3-run check; broken fixtures fail loudly.
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { echoAgent, ECHO_EXTRACT_TASK } from "@/lib/agents/echo";
import { createRecordedRouter } from "./recorded-router";
import {
  DEFAULT_FIXTURES_ROOT,
  agentsWithFixtures,
  loadApprovedMistakes,
  loadFixtures,
  packWithMistakes,
  runAgentAccuracy,
  runFixtureOnce,
} from "./accuracy-run";
import { scoreboardMarkdown } from "./accuracy";

const SELFTEST = "tests/fixtures/accuracy-selftest";

describe("accuracy harness self-test", () => {
  it("perfect echo fixtures → block and warn P = R = 1, figures / schema / replay 100%, 3 identical runs, pass", async () => {
    const s = await runAgentAccuracy(echoAgent);
    expect(s.fixtures).toBeGreaterThanOrEqual(6);
    expect(s.severity.block).toMatchObject({ precision: 1, recall: 1 });
    expect(s.severity.warn).toMatchObject({ precision: 1, recall: 1 });
    expect(s.severity.info).toMatchObject({ precision: 1, recall: 1 });
    expect(s.figures.share).toBe(1);
    expect(s.schema.share).toBe(1);
    expect(s.replay).toMatchObject({ caught: 1, total: 1, share: 1 });
    expect(s.determinism).toEqual({ runs: 3, ok: true, failures: [] });
    expect(s.reasons).toEqual([]);
    expect(s.pass).toBe(true);
    expect(scoreboardMarkdown([s], new Date("2026-11-05T14:40:00Z"))).toContain("| **echo** | accuracy/echo (6) | **overall** | – | – | all of the above | **pass** |");
  });

  it("corrupted fixture (expected flags altered, a figure off by ₹1) → detected, fail", async () => {
    const s = await runAgentAccuracy(echoAgent, { root: SELFTEST });
    expect(s.pass).toBe(false);
    expect(s.severity.block.recall).toBe(0);
    expect(s.flagDiffs).toEqual([
      { fixtureId: "corrupted-typical-gap", missed: [{ ruleId: "echo.duplicate-refs", severity: "block" }], unexpected: [{ ruleId: "echo.weekend-dates", severity: "info" }] },
    ]);
    expect(s.figures.diffs).toEqual([{ fixtureId: "corrupted-typical-gap", diffs: [{ key: "totalPaise", expected: 26682275, actual: 26682175, deltaPaise: -100 }] }]);
    expect(s.reasons).toEqual(["block recall 0.000 < 0.98", "figures exact on 0/1 fixtures"]);
  });

  it("determinism check catches a nondeterministic model", async () => {
    const s = await runAgentAccuracy(echoAgent, {
      routerFor: (fx, run) =>
        createRecordedRouter((req) => {
          const out = structuredClone(fx.recorded[req.task]) as { rows?: { amountPaise: number }[] };
          // The third run's "model" reads one amount differently.
          if (req.task === ECHO_EXTRACT_TASK && run === 2 && out.rows?.length) out.rows[0].amountPaise += 1;
          return out;
        }),
    });
    expect(s.pass).toBe(false);
    expect(s.determinism.ok).toBe(false);
    expect(s.determinism.failures.length).toBe(s.fixtures);
    expect(s.reasons.some((r) => r.startsWith("not identical across 3 runs"))).toBe(true);
    // Run 1 is still the scored run, so P/R and figures are unaffected.
    expect(s.severity.block.recall).toBe(1);
    expect(s.figures.share).toBe(1);
  });

  it("a mistake whose example the promoted rule does not catch fails replay", async () => {
    const root = mkdtempSync(join(tmpdir(), "accuracy-"));
    cpSync(join(DEFAULT_FIXTURES_ROOT, "echo"), join(root, "echo"), { recursive: true });
    writeFileSync(
      join(root, "echo", "_mistakes", "zz-missed.json"),
      JSON.stringify({
        id: "mistake-echo-999",
        ruleProposal: { id: "echo.over-crore", title: "Over ₹1 crore", severity: "warn", kind: "deterministic", check: "echo.amount-over", evidence: "row", params: { limitPaise: 1000000000 } },
        example: { extracted: { rows: [{ ref: "A", party: "P", date: "2026-10-05", amountPaise: 100 }] } },
      }),
    );
    const s = await runAgentAccuracy(echoAgent, { root });
    expect(s.replay).toMatchObject({ caught: 1, total: 2 });
    expect(s.reasons).toContain("mistake replay caught 1/2");
  });

  it("missing deliverable, run failure and missing recordings are failures, not passes", async () => {
    const [fx] = loadFixtures(DEFAULT_FIXTURES_ROOT, "echo").filter((f) => f.id === "clean-register");
    const pack = packWithMistakes(echoAgent, []);
    const noRecord = await runFixtureOnce(echoAgent, { ...fx, recorded: {} }, pack);
    expect(noRecord.error).toMatch(/^FAILED: No recorded model response/);
    const wrongName = await runFixtureOnce(echoAgent, { ...fx, expected: { ...fx.expected, deliverables: [{ name: "GST pack", sheets: ["Summary"] }] } }, pack);
    expect(wrongName.deliverables).toEqual([
      { name: "GST pack", problems: ["not produced"] },
      { name: "ACCURACY_Echo-register_2026-10_v1.xlsx", problems: ["unexpected deliverable"] },
    ]);
    const wrongSheets = await runFixtureOnce(echoAgent, { ...fx, expected: { ...fx.expected, deliverables: [{ name: "Echo register", sheets: ["Register"] }] } }, pack);
    expect(wrongSheets.deliverables[0].problems).toEqual(["unexpected sheet(s): Summary"]);
  });

  it("loaders: agents with fixtures, fixture validation, mistake validation", () => {
    // Production agents add their own fixture folders; echo must always be among them.
    expect(agentsWithFixtures(DEFAULT_FIXTURES_ROOT)).toContain("echo");
    expect(agentsWithFixtures("does/not/exist")).toEqual([]);
    expect(loadApprovedMistakes(DEFAULT_FIXTURES_ROOT, "echo").map((m) => m.id)).toEqual(["mistake-echo-001"]);
    expect(loadApprovedMistakes(SELFTEST, "echo")).toEqual([]);
    expect(packWithMistakes(echoAgent, loadApprovedMistakes(DEFAULT_FIXTURES_ROOT, "echo")).version).toBe("1.1.0");

    const root = mkdtempSync(join(tmpdir(), "accuracy-bad-"));
    mkdirSync(join(root, "echo", "bad"), { recursive: true });
    writeFileSync(join(root, "echo", "bad", "expected.json"), JSON.stringify({ flags: [], figures: { total: 1.5 }, deliverables: [] }));
    expect(() => loadFixtures(root, "echo")).toThrow(/bad\/expected.json: figures.total/);
    mkdirSync(join(root, "echo2", "_mistakes"), { recursive: true });
    writeFileSync(join(root, "echo2", "_mistakes", "m.json"), JSON.stringify({ id: "m" }));
    expect(() => loadApprovedMistakes(root, "echo2")).toThrow(/m.json: ruleProposal/);
    mkdirSync(join(root, "echo3", "noinput"), { recursive: true });
    writeFileSync(join(root, "echo3", "noinput", "expected.json"), JSON.stringify({ flags: [], figures: {}, deliverables: [] }));
    expect(loadFixtures(root, "echo3")).toEqual([{ id: "noinput", expected: { flags: [], figures: {}, deliverables: [] }, recorded: {}, inputFiles: [] }]);
  });
});
