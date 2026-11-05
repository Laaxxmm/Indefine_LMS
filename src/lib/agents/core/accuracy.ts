// Accuracy scoring (Phase 4 task 6). Pure functions: no fs, no clock, no network. The harness
// (accuracy-run.ts) runs agents over fixtures and hands the outcomes here; scripts/accuracy.ts
// prints the scoreboard. Thresholds come from the orchestrator spec ("Accuracy thresholds";
// changing one needs an ADR) and live in ONE object below.
import { z } from "zod";
import { SEVERITIES, type Severity } from "./checklist";
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

// ------------------------------------------------------------------ fixture format

const SheetShapeZ = z.union([z.string().min(1), z.object({ name: z.string().min(1), columns: z.array(z.string()) })]);

export const FixtureExpectedSchema = z
  .object({
    description: z.string().optional(),
    /** JobTask the fixture runs as (defaults by service). */
    job: z.object({ fy: z.string().optional(), period: z.string().optional(), title: z.string().optional() }).optional(),
    flags: z.array(z.object({ ruleId: z.string().min(1), severity: z.enum(SEVERITIES) })),
    /** Integer figures; amounts in paise. */
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
};

export type FixtureRuns = { id: string; expected: FixtureExpected; runs: FixtureOutcome[] };
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

/** Precision / recall / F1. Nothing raised and nothing expected counts as perfect (1.0). */
export function prf(c: Counts): Prf {
  const precision = c.tp + c.fp === 0 ? 1 : c.tp / (c.tp + c.fp);
  const recall = c.tp + c.fn === 0 ? 1 : c.tp / (c.tp + c.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { ...c, precision, recall, f1 };
}

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

// ------------------------------------------------------------------ determinism

/** Stable form of an outcome for the N-runs comparison. */
export function canonicalOutcome(o: FixtureOutcome): string {
  return JSON.stringify({
    flags: [...o.flags].map(key).sort(),
    figures: Object.keys(o.figures)
      .sort()
      .map((k) => [k, o.figures[k]]),
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

// ------------------------------------------------------------------ agent score

export type AgentScore = {
  agent: string;
  fixtureSet: string;
  fixtures: number;
  severity: Record<Severity, Prf>;
  figures: { exact: number; total: number; share: number; diffs: { fixtureId: string; diffs: FigureDiff[] }[] };
  schema: { valid: number; total: number; share: number; problems: { fixtureId: string; problems: string[] }[] };
  replay: { caught: number; total: number; share: number; misses: ReplayOutcome[] };
  determinism: { runs: number; ok: boolean; failures: string[] };
  flagDiffs: { fixtureId: string; missed: Flag[]; unexpected: Flag[] }[];
  errors: { fixtureId: string; error: string }[];
  pass: boolean;
  reasons: string[];
};

const share = (n: number, total: number) => (total === 0 ? 1 : n / total);

export function scoreAgent(agent: string, fixtureSet: string, fixtures: FixtureRuns[], replay: ReplayOutcome[], t: Thresholds = ACCURACY_THRESHOLDS): AgentScore {
  const totals: Record<Severity, Counts> = { block: { tp: 0, fp: 0, fn: 0 }, warn: { tp: 0, fp: 0, fn: 0 }, info: { tp: 0, fp: 0, fn: 0 } };
  const figureDiffs: AgentScore["figures"]["diffs"] = [];
  const schemaProblems: AgentScore["schema"]["problems"] = [];
  const flagDiffs: AgentScore["flagDiffs"] = [];
  const errors: AgentScore["errors"] = [];
  const nondeterministic: string[] = [];
  let figuresOk = 0;
  let schemaOk = 0;

  for (const fx of fixtures) {
    const first = fx.runs[0];
    if (!first) {
      errors.push({ fixtureId: fx.id, error: "no runs" });
      continue;
    }
    for (const r of fx.runs) if (r.error) errors.push({ fixtureId: fx.id, error: r.error });
    for (const s of SEVERITIES) totals[s] = addCounts(totals[s], countFlags(fx.expected.flags, first.flags, s));
    const want = new Set(fx.expected.flags.map(key));
    const got = new Set(first.flags.map(key));
    const missed = fx.expected.flags.filter((f) => !got.has(key(f)));
    const unexpected = first.flags.filter((f) => !want.has(key(f)));
    if (missed.length || unexpected.length) flagDiffs.push({ fixtureId: fx.id, missed, unexpected });
    const diffs = compareFigures(fx.expected.figures, first.figures);
    if (diffs.length) figureDiffs.push({ fixtureId: fx.id, diffs });
    else figuresOk += 1;
    const problems = first.deliverables.flatMap((d) => d.problems.map((p) => `${d.name}: ${p}`));
    if (problems.length) schemaProblems.push({ fixtureId: fx.id, problems });
    else schemaOk += 1;
    if (fx.runs.length < t.runs || !sameEveryRun(fx.runs).ok) nondeterministic.push(fx.id);
  }

  const severity = { block: prf(totals.block), warn: prf(totals.warn), info: prf(totals.info) };
  const n = fixtures.length;
  // A fixture with no runs counts as neither exact nor valid.
  const figures = { exact: figuresOk, total: n, share: share(figuresOk, n), diffs: figureDiffs };
  const schema = { valid: schemaOk, total: n, share: share(schemaOk, n), problems: schemaProblems };
  const misses = replay.filter((r) => !r.caught);
  const rep = { caught: replay.length - misses.length, total: replay.length, share: share(replay.length - misses.length, replay.length), misses };

  const reasons: string[] = [];
  if (n === 0) reasons.push("no fixtures");
  for (const s of ["block", "warn"] as const) {
    if (severity[s].recall < t[s].recall) reasons.push(`${s} recall ${severity[s].recall.toFixed(3)} < ${t[s].recall}`);
    if (severity[s].precision < t[s].precision) reasons.push(`${s} precision ${severity[s].precision.toFixed(3)} < ${t[s].precision}`);
  }
  if (figures.share < t.figures) reasons.push(`figures exact on ${figures.exact}/${n} fixtures`);
  if (schema.share < t.schema) reasons.push(`deliverable shape valid on ${schema.valid}/${n} fixtures`);
  if (rep.share < t.replay) reasons.push(`mistake replay caught ${rep.caught}/${rep.total}`);
  if (nondeterministic.length) reasons.push(`not identical across ${t.runs} runs: ${nondeterministic.join(", ")}`);
  if (errors.length) reasons.push(`run errors on ${[...new Set(errors.map((e) => e.fixtureId))].join(", ")}`);

  return {
    agent,
    fixtureSet,
    fixtures: n,
    severity,
    figures,
    schema,
    replay: rep,
    determinism: { runs: t.runs, ok: nondeterministic.length === 0, failures: nondeterministic },
    flagDiffs,
    errors,
    pass: reasons.length === 0,
    reasons,
  };
}

// ------------------------------------------------------------------ scoreboard

export const SCOREBOARD_START = "<!-- accuracy-scoreboard:start -->";
export const SCOREBOARD_END = "<!-- accuracy-scoreboard:end -->";

const f3 = (x: number) => x.toFixed(3);
const pf = (ok: boolean) => (ok ? "pass" : "FAIL");

/** Markdown block: agent → fixture set → check → precision → recall → threshold → pass/fail → date (IST). */
export function scoreboardMarkdown(scores: AgentScore[], at: Date, t: Thresholds = ACCURACY_THRESHOLDS): string {
  const date = `${formatDateTimeIst(at)} IST`;
  const lines = [
    SCOREBOARD_START,
    `_Generated by \`scripts/accuracy.ts\` on ${date}. Thresholds: block R≥${t.block.recall} P≥${t.block.precision}; warn R≥${t.warn.recall} P≥${t.warn.precision}; figures, schema, replay 100%; ${t.runs} identical runs._`,
    "",
    "| Agent | Fixture set | Check | Precision | Recall | Threshold | Pass/fail | Date (IST) |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const s of scores) {
    const set = `${s.fixtureSet} (${s.fixtures})`;
    for (const sev of ["block", "warn"] as const) {
      const p = s.severity[sev];
      const ok = p.recall >= t[sev].recall && p.precision >= t[sev].precision;
      lines.push(`| ${s.agent} | ${set} | ${sev} flags | ${f3(p.precision)} | ${f3(p.recall)} | R≥${t[sev].recall} P≥${t[sev].precision} | ${pf(ok)} | ${date} |`);
    }
    lines.push(`| ${s.agent} | ${set} | figures exact | – | – | ${s.figures.exact}/${s.figures.total} · need 100% | ${pf(s.figures.share >= t.figures)} | ${date} |`);
    lines.push(`| ${s.agent} | ${set} | deliverable schema | – | – | ${s.schema.valid}/${s.schema.total} · need 100% | ${pf(s.schema.share >= t.schema)} | ${date} |`);
    lines.push(`| ${s.agent} | ${set} | mistake replay | – | – | ${s.replay.caught}/${s.replay.total} · need 100% | ${pf(s.replay.share >= t.replay)} | ${date} |`);
    lines.push(`| ${s.agent} | ${set} | ${t.runs}× identical | – | – | ${s.fixtures - s.determinism.failures.length}/${s.fixtures} · need all | ${pf(s.determinism.ok)} | ${date} |`);
    lines.push(`| **${s.agent}** | ${set} | **overall** | – | – | all of the above | **${pf(s.pass)}** | ${date} |`);
  }
  lines.push(SCOREBOARD_END);
  return lines.join("\n");
}

/**
 * Put the scoreboard block into a document: replace an existing marked block, else the body of a
 * "## Accuracy scoreboard" section (heading kept), else append. Nothing else in the file changes.
 */
export function upsertScoreboard(existing: string | null, block: string): string {
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
  for (const d of s.flagDiffs) {
    const fmt = (fs: Flag[]) => fs.map((f) => `${f.ruleId} (${f.severity})`).join(", ");
    if (d.missed.length) out.push(`  - ${d.fixtureId}: missed ${fmt(d.missed)}`);
    if (d.unexpected.length) out.push(`  - ${d.fixtureId}: unexpected ${fmt(d.unexpected)}`);
  }
  for (const d of s.figures.diffs) out.push(`  - ${d.fixtureId}: ${d.diffs.map(describeFigureDiff).join("; ")}`);
  for (const p of s.schema.problems) out.push(`  - ${p.fixtureId}: ${p.problems.join("; ")}`);
  for (const m of s.replay.misses) out.push(`  - mistake ${m.mistakeId} (${m.ruleId}) not caught${m.reason ? `: ${m.reason}` : ""}`);
  for (const e of s.errors) out.push(`  - ${e.fixtureId}: ${e.error}`);
  return out;
}
