// Accuracy scoring (Phase 4 task 6). Pure functions: no fs, no clock, no network. The harness
// (accuracy-run.ts) runs agents over fixtures and hands the outcomes here; scripts/accuracy.ts
// prints the scoreboard. Thresholds come from the orchestrator spec ("Accuracy thresholds";
// changing one needs an ADR) and live in ONE object below.
//
// What the gate measures (hardened after the independent audit, see the framework design note):
// - Flags are scored per severity AND split by rule kind. In recorded mode (model answers replayed
//   from recorded.json) only the deterministic split is accuracy evidence and is gated on the spec
//   thresholds; the LLM split must match the recordings exactly (a code-path check: a dropped or
//   invented LLM flag is a bug in the pipeline, not model judgement); the combined row is
//   informational. In live mode (Phase 2b) the LLM split and the combined row are gated too.
// - Input sensitivity: every fixture is re-run with one input value changed (agent.probeMutation)
//   and the same recordings; some figure or flag must change. Agents that are not `internal` must
//   declare the probe.
// - Support is printed (tp/fp/fn, n/a when nothing was expected or raised) and production fixture
//   sets must not be thin: a minimum fixture count, every fixture categorised clean / typical-gap /
//   trap with at least one of each, at least one expected block and one expected warn flag.
import { z } from "zod";
import { SEVERITIES, type RuleKind, type Severity } from "./checklist";
import { formatDateTimeIst, formatInr } from "./format";
import type { Figures } from "./runner";

export const ACCURACY_THRESHOLDS = {
  block: { recall: 0.98, precision: 0.9 },
  warn: { recall: 0.9, precision: 0.8 },
  /** Share of fixtures whose computed figures are all exact (integer paise). */
  figures: 1,
  /** Share of fixtures whose deliverables match the expected shape. */
  schema: 1,
  /** Share of approved MistakeLog examples the promoted rule catches on replay. */
  replay: 1,
  /** Runs per fixture; all must give identical results. */
  runs: 3,
} as const;

export type Thresholds = {
  block: { recall: number; precision: number };
  warn: { recall: number; precision: number };
  figures: number;
  schema: number;
  replay: number;
  runs: number;
};

/** Minimum fixture count per production agent (orchestrator spec: ≥ 15; Books / Audit lighter, ≥ 10). */
export const FIXTURE_MINIMUMS: Readonly<Record<string, number>> = Object.freeze({ gst: 15, roc: 15, tax: 15, books: 10, audit: 10 });
/** Any other production agent. */
export const DEFAULT_FIXTURE_MINIMUM = 15;
/** Minimum expected flags across a production agent's fixture set. */
export const MIN_EXPECTED_FLAGS = { block: 1, warn: 1 } as const;

export const minimumFixturesFor = (agent: string) => FIXTURE_MINIMUMS[agent] ?? DEFAULT_FIXTURE_MINIMUM;

/** recorded = model answers replayed from recorded.json; live = a real provider (Phase 2b). */
export type RunMode = "recorded" | "live";

// ------------------------------------------------------------------ fixture format

export const FIXTURE_CATEGORIES = ["clean", "typical-gap", "trap"] as const;
export type FixtureCategory = (typeof FIXTURE_CATEGORIES)[number];

const SheetShapeZ = z.union([z.string().min(1), z.object({ name: z.string().min(1), columns: z.array(z.string()) })]);

export const FixtureExpectedSchema = z
  .object({
    description: z.string().optional(),
    /** clean / typical-gap / trap. Optional in the schema; required for production agents (scoreAgent). */
    category: z.enum(FIXTURE_CATEGORIES).optional(),
    /** JobTask the fixture runs as (defaults by service). */
    job: z.object({ fy: z.string().optional(), period: z.string().optional(), title: z.string().optional() }).optional(),
    flags: z.array(z.object({ ruleId: z.string().min(1), severity: z.enum(SEVERITIES) })),
    /** Integer figures; amounts in paise. Must not be empty when the agent's compute returns figures. */
    figures: z.record(z.number().int()),
    deliverables: z.array(z.object({ name: z.string().min(1), sheets: z.array(SheetShapeZ) })),
  })
  .strict();
export type FixtureExpected = z.infer<typeof FixtureExpectedSchema>;

export type Flag = { ruleId: string; severity: Severity };

/** What one run of an agent on one fixture produced. */
export type FixtureOutcome = {
  flags: Flag[];
  figures: Figures;
  /** One entry per expected (or unexpected) deliverable; empty problems = shape valid. */
  deliverables: { name: string; problems: string[] }[];
  error?: string;
  /** Router tasks the run asked for (not part of the canonical outcome). */
  requestedTasks?: string[];
};

/** Result of re-running a fixture on probe-mutated input with the same recordings. */
export type ProbeOutcome = { changed: boolean; reason?: string };

export type FixtureRuns = {
  id: string;
  expected: FixtureExpected;
  runs: FixtureOutcome[];
  /** Input-sensitivity probe; absent when the agent declares no probeMutation. */
  probe?: ProbeOutcome;
  /** Recorded tasks no run asked for (stale recordings; reported, not gated). */
  unusedRecordings?: string[];
};
export type ReplayOutcome = { mistakeId: string; ruleId: string; caught: boolean; reason?: string };

// ------------------------------------------------------------------ flags

export type Counts = { tp: number; fp: number; fn: number };
export type Prf = Counts & { precision: number; recall: number; f1: number };

const key = (f: Flag) => `${f.severity}\u0000${f.ruleId}`;

/** Set comparison of flags of one severity (a flag raised at the wrong severity is a miss + a false alarm). */
export function countFlags(expected: Flag[], actual: Flag[], severity: Severity): Counts {
  const want = new Set(expected.filter((f) => f.severity === severity).map(key));
  const got = new Set(actual.filter((f) => f.severity === severity).map(key));
  let tp = 0;
  for (const k of got) if (want.has(k)) tp += 1;
  return { tp, fp: got.size - tp, fn: want.size - tp };
}

export const addCounts = (a: Counts, b: Counts): Counts => ({ tp: a.tp + b.tp, fp: a.fp + b.fp, fn: a.fn + b.fn });

/** Precision / recall / F1. Nothing raised and nothing expected counts as perfect (1.0); the scoreboard prints n/a. */
export function prf(c: Counts): Prf {
  const precision = c.tp + c.fp === 0 ? 1 : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? 1 : c.tp / (c.tp + c.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { ...c, precision, recall, f1 };
}

/** No flag expected and none raised: P/R carry no information. */
export const noSupport = (c: Counts) => c.tp + c.fp + c.fn === 0;

/** Rule kind of a flag; a rule the pack does not know is treated as deterministic (so it is gated). */
export const kindOf = (ruleKinds: Readonly<Record<string, RuleKind>> | undefined, ruleId: string): RuleKind => ruleKinds?.[ruleId] ?? "deterministic";

// ------------------------------------------------------------------ figures

export type FigureDiff = { key: string; expected: number; actual: number | null; deltaPaise: number | null };

/** Every expected figure must match exactly (integer paise). Extra computed figures are not scored. */
export function compareFigures(expected: Figures, actual: Figures): FigureDiff[] {
  const diffs: FigureDiff[] = [];
  for (const k of Object.keys(expected).sort()) {
    const a = Object.prototype.hasOwnProperty.call(actual, k) ? actual[k] : null;
    if (a === null || a === undefined) diffs.push({ key: k, expected: expected[k], actual: null, deltaPaise: null });
    else if (a !== expected[k]) diffs.push({ key: k, expected: expected[k], actual: a, deltaPaise: a - expected[k] });
  }
  return diffs;
}

export function describeFigureDiff(d: FigureDiff): string {
  if (d.actual === null) return `${d.key}: missing (expected ${d.expected})`;
  const rupees = d.key.toLowerCase().includes("paise") ? ` (₹${formatInr(Math.abs(d.deltaPaise!) / 100)} ${d.deltaPaise! > 0 ? "over" : "under"})` : "";
  return `${d.key}: expected ${d.expected}, got ${d.actual}${rupees}`;
}

// ------------------------------------------------------------------ determinism / sensitivity

const flagsAndFigures = (o: FixtureOutcome) => ({
  flags: [...o.flags].map(key).sort(),
  figures: Object.keys(o.figures)
    .sort()
    .map((k) => [k, o.figures[k]]),
});

/** Stable form of an outcome for the N-runs comparison. */
export function canonicalOutcome(o: FixtureOutcome): string {
  return JSON.stringify({
    ...flagsAndFigures(o),
    deliverables: [...o.deliverables].sort((a, b) => (a.name < b.name ? -1 : 1)).map((d) => [d.name, [...d.problems].sort()]),
    error: o.error ?? null,
  });
}

/** All runs identical? `differs` is the 0-based index of the first run that is not. */
export function sameEveryRun(runs: FixtureOutcome[]): { ok: boolean; differs?: number } {
  if (runs.length === 0) return { ok: false, differs: 0 };
  const first = canonicalOutcome(runs[0]);
  const i = runs.findIndex((r) => canonicalOutcome(r) !== first);
  return i < 0 ? { ok: true } : { ok: false, differs: i };
}

/** Input-sensitivity verdict: the probe run must succeed and differ in at least one figure or flag. */
export function probeVerdict(baseline: FixtureOutcome | undefined, mutated: FixtureOutcome, inputChanged: boolean): ProbeOutcome {
  if (!inputChanged) return { changed: false, reason: "probeMutation left the input unchanged" };
  if (!baseline || baseline.error) return { changed: false, reason: `baseline run failed${baseline?.error ? `: ${baseline.error}` : ""}` };
  if (mutated.error) return { changed: false, reason: `run on the mutated input failed: ${mutated.error}` };
  if (JSON.stringify(flagsAndFigures(baseline)) !== JSON.stringify(flagsAndFigures(mutated))) return { changed: true };
  return { changed: false, reason: "same figures and flags after one input value changed: the result does not depend on the input" };
}

// ------------------------------------------------------------------ agent score

export type KindSplit = Record<RuleKind, Prf>;

export type AgentScore = {
  agent: string;
  fixtureSet: string;
  fixtures: number;
  mode: RunMode;
  internal: boolean;
  /** Combined per severity (informational in recorded mode). */
  severity: Record<Severity, Prf>;
  /** block / warn split by the rule kind of each flag. */
  split: Record<"block" | "warn", KindSplit>;
  figures: { exact: number; total: number; share: number; diffs: { fixtureId: string; diffs: FigureDiff[] }[] };
  schema: { valid: number; total: number; share: number; problems: { fixtureId: string; problems: string[] }[] };
  replay: { caught: number; total: number; share: number; misses: ReplayOutcome[] };
  determinism: { runs: number; ok: boolean; failures: string[] };
  sensitivity: { declared: boolean; changed: number; total: number; ok: boolean; failures: { fixtureId: string; reason: string }[] };
  support: {
    minimum: number | null;
    categories: Record<FixtureCategory, number>;
    uncategorised: string[];
    expected: Record<Severity, number>;
    /** "thin fixture set: …" problems (production agents), plus empty-figures problems (all agents). */
    problems: string[];
  };
  flagDiffs: { fixtureId: string; missed: Flag[]; unexpected: Flag[] }[];
  ruleKinds: Readonly<Record<string, RuleKind>>;
  /** Expected flags naming a rule the checklist pack does not have (e.g. a missing _mistakes promotion). */
  unknownRules: string[];
  errors: { fixtureId: string; error: string }[];
  /** Not gated: stale recordings and the like. */
  notes: string[];
  pass: boolean;
  reasons: string[];
};

export type ScoreContext = {
  mode?: RunMode;
  /** Framework test agents are exempt from the thin-set rules and may omit probeMutation. */
  internal?: boolean;
  /** Does the agent declare probeMutation? */
  probeDeclared?: boolean;
  /** ruleId → kind for every rule of the pack the fixtures ran with. */
  ruleKinds?: Readonly<Record<string, RuleKind>>;
  /** Minimum fixture count (production agents). Default minimumFixturesFor(agent). */
  minimumFixtures?: number;
};

const share = (n: number, total: number) => (total === 0 ? 1 : n / total);
const zeroCounts = (): Counts => ({ tp: 0, fp: 0, fn: 0 });
const meets = (p: Prf, th: { recall: number; precision: number }) => p.recall >= th.recall && p.precision >= th.precision;

/**
 * Score one agent. `ctx` defaults are fail-closed: a production agent (internal false), recorded
 * mode, no probe declared.
 */
export function scoreAgent(agent: string, fixtureSet: string, fixtures: FixtureRuns[], replay: ReplayOutcome[], t: Thresholds = ACCURACY_THRESHOLDS, ctx: ScoreContext = {}): AgentScore {
  const mode = ctx.mode ?? "recorded";
  const internal = ctx.internal ?? false;
  const ruleKinds = ctx.ruleKinds ?? {};
  const totals: Record<Severity, Counts> = { block: zeroCounts(), warn: zeroCounts(), info: zeroCounts() };
  const splitTotals: Record<"block" | "warn", Record<RuleKind, Counts>> = {
    block: { deterministic: zeroCounts(), llm: zeroCounts() },
    warn: { deterministic: zeroCounts(), llm: zeroCounts() },
  };
  const figureDiffs: AgentScore["figures"]["diffs"] = [];
  const schemaProblems: AgentScore["schema"]["problems"] = [];
  const flagDiffs: AgentScore["flagDiffs"] = [];
  const errors: AgentScore["errors"] = [];
  const nondeterministic: string[] = [];
  const sensitivityFailures: AgentScore["sensitivity"]["failures"] = [];
  const categories: Record<FixtureCategory, number> = { clean: 0, "typical-gap": 0, trap: 0 };
  const uncategorised: string[] = [];
  const expectedCount: Record<Severity, number> = { block: 0, warn: 0, info: 0 };
  const emptyFigures: string[] = [];
  const unknownRules = new Set<string>();
  const notes: string[] = [];
  let figuresOk = 0;
  let schemaOk = 0;
  let probed = 0;

  for (const fx of fixtures) {
    if (fx.expected.category) categories[fx.expected.category] += 1;
    else uncategorised.push(fx.id);
    for (const f of new Set(fx.expected.flags.map(key))) expectedCount[f.split("\u0000")[0] as Severity] += 1;
    if (ctx.ruleKinds) for (const f of fx.expected.flags) if (!Object.prototype.hasOwnProperty.call(ctx.ruleKinds, f.ruleId)) unknownRules.add(f.ruleId);
    if (fx.unusedRecordings?.length) notes.push(`${fx.id}: recorded.json has responses no run asked for (${fx.unusedRecordings.join(", ")}); remove stale recordings`);

    const first = fx.runs[0];
    if (!first) {
      errors.push({ fixtureId: fx.id, error: "no runs" });
      continue;
    }
    for (const r of fx.runs) if (r.error) errors.push({ fixtureId: fx.id, error: r.error });
    for (const s of SEVERITIES) totals[s] = addCounts(totals[s], countFlags(fx.expected.flags, first.flags, s));
    for (const s of ["block", "warn"] as const) {
      for (const kind of ["deterministic", "llm"] as const) {
        const ofKind = (fs: Flag[]) => fs.filter((f) => kindOf(ruleKinds, f.ruleId) === kind);
        splitTotals[s][kind] = addCounts(splitTotals[s][kind], countFlags(ofKind(fx.expected.flags), ofKind(first.flags), s));
      }
    }
    const want = new Set(fx.expected.flags.map(key));
    const got = new Set(first.flags.map(key));
    const missed = fx.expected.flags.filter((f) => !got.has(key(f)));
    const unexpected = first.flags.filter((f) => !want.has(key(f)));
    if (missed.length || unexpected.length) flagDiffs.push({ fixtureId: fx.id, missed, unexpected });
    const diffs = compareFigures(fx.expected.figures, first.figures);
    if (diffs.length) figureDiffs.push({ fixtureId: fx.id, diffs });
    else figuresOk += 1;
    if (!first.error && Object.keys(first.figures).length > 0 && Object.keys(fx.expected.figures).length === 0) emptyFigures.push(fx.id);
    const problems = first.deliverables.flatMap((d) => d.problems.map((p) => `${d.name}: ${p}`));
    if (problems.length) schemaProblems.push({ fixtureId: fx.id, problems });
    else schemaOk += 1;
    if (fx.runs.length < t.runs || !sameEveryRun(fx.runs).ok) nondeterministic.push(fx.id);
    if (ctx.probeDeclared) {
      if (fx.probe?.changed) probed += 1;
      else sensitivityFailures.push({ fixtureId: fx.id, reason: fx.probe?.reason ?? "probe not run" });
    }
  }

  const severity = { block: prf(totals.block), warn: prf(totals.warn), info: prf(totals.info) };
  const split = {
    block: { deterministic: prf(splitTotals.block.deterministic), llm: prf(splitTotals.block.llm) },
    warn: { deterministic: prf(splitTotals.warn.deterministic), llm: prf(splitTotals.warn.llm) },
  };
  const n = fixtures.length;
  // A fixture with no runs counts as neither exact nor valid.
  const figures = { exact: figuresOk, total: n, share: share(figuresOk, n), diffs: figureDiffs };
  const schema = { valid: schemaOk, total: n, share: share(schemaOk, n), problems: schemaProblems };
  const misses = replay.filter((r) => !r.caught);
  const rep = { caught: replay.length - misses.length, total: replay.length, share: share(replay.length - misses.length, replay.length), misses };
  const declared = ctx.probeDeclared ?? false;
  const sensitivity = { declared, changed: probed, total: n, ok: declared ? sensitivityFailures.length === 0 && n > 0 : internal, failures: sensitivityFailures };

  // Thin-set rules (production agents) + empty expected figures (every agent).
  const minimum = internal ? null : (ctx.minimumFixtures ?? minimumFixturesFor(agent));
  const supportProblems: string[] = [];
  if (minimum !== null) {
    if (n < minimum) supportProblems.push(`thin fixture set: ${n} fixture(s), ${agent} needs at least ${minimum}`);
    if (uncategorised.length) supportProblems.push(`thin fixture set: no category (clean / typical-gap / trap) on ${uncategorised.join(", ")}`);
    for (const c of FIXTURE_CATEGORIES) if (categories[c] === 0) supportProblems.push(`thin fixture set: no ${c} fixture`);
    for (const s of ["block", "warn"] as const) {
      if (expectedCount[s] < MIN_EXPECTED_FLAGS[s]) supportProblems.push(`thin fixture set: ${expectedCount[s]} expected ${s} flag(s) across the set, need at least ${MIN_EXPECTED_FLAGS[s]}`);
    }
  }
  for (const id of emptyFigures) supportProblems.push(`thin fixture set: ${id} has empty expected figures but compute returns figures`);

  const reasons: string[] = [];
  if (n === 0) reasons.push("no fixtures");
  for (const s of ["block", "warn"] as const) {
    const det = split[s].deterministic;
    if (det.recall < t[s].recall) reasons.push(`${s} recall (deterministic rules) ${det.recall.toFixed(3)} < ${t[s].recall}`);
    if (det.precision < t[s].precision) reasons.push(`${s} precision (deterministic rules) ${det.precision.toFixed(3)} < ${t[s].precision}`);
    const llm = split[s].llm;
    if (mode === "recorded") {
      if (llm.fn || llm.fp) reasons.push(`${s} LLM flags do not match the recorded verdicts (code path): ${llm.fn} missed, ${llm.fp} unexpected`);
    } else {
      if (llm.recall < t[s].recall) reasons.push(`${s} recall (LLM rules) ${llm.recall.toFixed(3)} < ${t[s].recall}`);
      if (llm.precision < t[s].precision) reasons.push(`${s} precision (LLM rules) ${llm.precision.toFixed(3)} < ${t[s].precision}`);
      if (severity[s].recall < t[s].recall) reasons.push(`${s} recall (all rules) ${severity[s].recall.toFixed(3)} < ${t[s].recall}`);
      if (severity[s].precision < t[s].precision) reasons.push(`${s} precision (all rules) ${severity[s].precision.toFixed(3)} < ${t[s].precision}`);
    }
  }
  if (unknownRules.size) reasons.push(`expected flag(s) for rule(s) not in the checklist pack: ${[...unknownRules].sort().join(", ")} (missing _mistakes promotion?)`);
  if (figures.share < t.figures) reasons.push(`figures exact on ${figures.exact}/${n} fixtures`);
  if (schema.share < t.schema) reasons.push(`deliverable shape valid on ${schema.valid}/${n} fixtures`);
  if (rep.share < t.replay) reasons.push(`mistake replay caught ${rep.caught}/${rep.total}`);
  if (nondeterministic.length) reasons.push(`not identical across ${t.runs} runs: ${nondeterministic.join(", ")}`);
  if (!declared && !internal) reasons.push("input sensitivity: not declared (agents that are not internal must define probeMutation)");
  if (declared && sensitivityFailures.length) reasons.push(`input sensitivity: result unchanged or probe failed on ${sensitivityFailures.map((f) => f.fixtureId).join(", ")}`);
  reasons.push(...supportProblems);
  if (errors.length) reasons.push(`run errors on ${[...new Set(errors.map((e) => e.fixtureId))].join(", ")}`);

  return {
    agent,
    fixtureSet,
    fixtures: n,
    mode,
    internal,
    severity,
    split,
    figures,
    schema,
    replay: rep,
    determinism: { runs: t.runs, ok: nondeterministic.length === 0, failures: nondeterministic },
    sensitivity,
    support: { minimum, categories, uncategorised, expected: expectedCount, problems: supportProblems },
    flagDiffs,
    ruleKinds,
    unknownRules: [...unknownRules].sort(),
    errors,
    notes,
    pass: reasons.length === 0,
    reasons,
  };
}

// ------------------------------------------------------------------ scoreboard

export const SCOREBOARD_START = "<!-- accuracy-scoreboard:start -->";
export const SCOREBOARD_END = "<!-- accuracy-scoreboard:end -->";

const f3 = (x: number) => x.toFixed(3);
const pf = (ok: boolean) => (ok ? "pass" : "FAIL");
const pr = (p: Prf) => (noSupport(p) ? ["n/a", "n/a"] : [f3(p.precision), f3(p.recall)]);
const tpfpfn = (c: Counts) => `${c.tp}/${c.fp}/${c.fn}`;

export function modeLabel(mode: RunMode): string {
  return mode === "recorded"
    ? "**recorded** (model answers replayed from recorded.json: deterministic flags gated on the thresholds; LLM flags gated as code path only — they must match the recordings exactly; the combined row is informational; live-provider gating of LLM rules is Phase 2b)"
    : "**live** (model answers from a live provider: deterministic, LLM and combined flags all gated on the thresholds)";
}

/** Markdown block: agent → fixture set → check → precision → recall → tp/fp/fn → threshold → pass/fail → date (IST). */
export function scoreboardMarkdown(scores: AgentScore[], at: Date, t: Thresholds = ACCURACY_THRESHOLDS): string {
  const date = `${formatDateTimeIst(at)} IST`;
  const modes = [...new Set(scores.map((s) => s.mode))];
  const lines = [
    SCOREBOARD_START,
    `_Generated by \`scripts/accuracy.ts\` on ${date}. Mode: ${modes.map(modeLabel).join("; ") || modeLabel("recorded")}. Thresholds: block R≥${t.block.recall} P≥${t.block.precision}; warn R≥${t.warn.recall} P≥${t.warn.precision}; figures, schema, replay, input sensitivity 100%; ${t.runs} identical runs. tp/fp/fn = support; n/a = nothing expected or raised._`,
    "",
    "| Agent | Fixture set | Check | Precision | Recall | tp/fp/fn | Threshold | Pass/fail | Date (IST) |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const s of scores) {
    const set = `${s.fixtureSet} (${s.fixtures})`;
    const row = (check: string, p: Prf | null, threshold: string, status: string) => {
      const [P, R] = p ? pr(p) : ["–", "–"];
      lines.push(`| ${s.agent} | ${set} | ${check} | ${P} | ${R} | ${p ? tpfpfn(p) : "–"} | ${threshold} | ${status} | ${date} |`);
    };
    const live = s.mode === "live";
    for (const sev of ["block", "warn"] as const) {
      const th = `R≥${t[sev].recall} P≥${t[sev].precision}`;
      const det = s.split[sev].deterministic;
      row(`${sev} flags · deterministic rules`, det, th, noSupport(det) ? "n/a" : pf(meets(det, t[sev])));
      const llm = s.split[sev].llm;
      if (live) row(`${sev} flags · LLM rules`, llm, th, noSupport(llm) ? "n/a" : pf(meets(llm, t[sev])));
      else row(`${sev} flags · LLM rules (recorded: code path)`, llm, "match recordings exactly", noSupport(llm) ? "n/a" : pf(llm.fp === 0 && llm.fn === 0));
      const all = s.severity[sev];
      if (live) row(`${sev} flags · all rules`, all, th, noSupport(all) ? "n/a" : pf(meets(all, t[sev])));
      else row(`${sev} flags · all rules`, all, "informational (recorded mode)", "info");
    }
    row("info flags", s.severity.info, "not thresholded", "info");
    row("figures exact", null, `${s.figures.exact}/${s.figures.total} · need 100%`, pf(s.figures.share >= t.figures));
    row("deliverable schema", null, `${s.schema.valid}/${s.schema.total} · need 100%`, pf(s.schema.share >= t.schema));
    row("mistake replay", null, `${s.replay.caught}/${s.replay.total} · need 100%`, pf(s.replay.share >= t.replay));
    if (s.sensitivity.declared) row("input sensitivity", null, `${s.sensitivity.changed}/${s.sensitivity.total} changed · need all`, pf(s.sensitivity.ok));
    else if (s.internal) row("input sensitivity", null, "not declared · internal agent, not gated", "info");
    else row("input sensitivity", null, "not declared · required (agent is not internal)", "FAIL");
    row(live ? `${t.runs}× identical` : `${t.runs}× identical (code path)`, null, `${s.fixtures - s.determinism.failures.length}/${s.fixtures} · need all`, pf(s.determinism.ok));
    const c = s.support.categories;
    const shape = `clean ${c.clean} / typical-gap ${c["typical-gap"]} / trap ${c.trap}${s.support.uncategorised.length ? ` / none ${s.support.uncategorised.length}` : ""}; expected block ${s.support.expected.block}, warn ${s.support.expected.warn}`;
    const need = s.support.minimum === null ? "internal agent: exempt" : `need ≥${s.support.minimum} fixtures, every category, ≥${MIN_EXPECTED_FLAGS.block} block & ≥${MIN_EXPECTED_FLAGS.warn} warn expected`;
    row("fixture set", null, `${shape} · ${need}`, s.support.problems.length ? "FAIL" : s.support.minimum === null ? "info" : "pass");
    lines.push(`| **${s.agent}** | ${set} | **overall** | – | – | – | all of the above | **${pf(s.pass)}** | ${date} |`);
  }
  lines.push(SCOREBOARD_END);
  return lines.join("\n");
}

/**
 * Put the scoreboard block into a document: replace an existing marked block, else the body of a
 * "## Accuracy scoreboard" section (heading kept), else append. The block keeps its start / end
 * markers, so the next write replaces it in place. Nothing else in the file changes.
 */
export function upsertScoreboard(existing: string | null, block: string): string {
  if (!block.startsWith(SCOREBOARD_START) || !block.endsWith(SCOREBOARD_END)) throw new Error("scoreboard block must start and end with its markers");
  if (!existing) return `${block}\n`;
  const s = existing.indexOf(SCOREBOARD_START);
  const e = existing.indexOf(SCOREBOARD_END);
  if (s >= 0 && e > s) return existing.slice(0, s) + block + existing.slice(e + SCOREBOARD_END.length);
  const heading = /^## Accuracy scoreboard[^\n]*\n/m.exec(existing);
  if (heading) {
    const bodyStart = heading.index + heading[0].length;
    const next = existing.slice(bodyStart).search(/^## /m);
    const bodyEnd = next < 0 ? existing.length : bodyStart + next;
    return `${existing.slice(0, bodyStart)}${block}\n\n${existing.slice(bodyEnd)}`;
  }
  return `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
}

/** Human-readable failure details for the CLI. */
export function failureDetails(s: AgentScore): string[] {
  const out = [...s.reasons.map((r) => `- ${r}`)];
  const fmt = (fs: Flag[]) => fs.map((f) => `${f.ruleId} (${f.severity}, ${kindOf(s.ruleKinds, f.ruleId)})`).join(", ");
  for (const d of s.flagDiffs) {
    if (d.missed.length) out.push(`  - ${d.fixtureId}: missed ${fmt(d.missed)}`);
    if (d.unexpected.length) out.push(`  - ${d.fixtureId}: unexpected ${fmt(d.unexpected)}`);
  }
  for (const d of s.figures.diffs) out.push(`  - ${d.fixtureId}: ${d.diffs.map(describeFigureDiff).join("; ")}`);
  for (const p of s.schema.problems) out.push(`  - ${p.fixtureId}: ${p.problems.join("; ")}`);
  for (const m of s.replay.misses) out.push(`  - mistake ${m.mistakeId} (${m.ruleId}) not caught${m.reason ? `: ${m.reason}` : ""}`);
  for (const f of s.sensitivity.failures) out.push(`  - ${f.fixtureId}: input sensitivity — ${f.reason}`);
  for (const e of s.errors) out.push(`  - ${e.fixtureId}: ${e.error}`);
  return out;
}
