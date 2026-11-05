// Accuracy harness runner: loads fixtures from disk and runs the REAL agent pipeline (runAgent)
// against them with all I/O mocked — an in-memory database, an in-memory deliverable store, the
// fixture's input/ files and a recorded-response router keyed by task. No network, no wall clock
// in any scored value. Each fixture runs N times (default 3) and must give identical results.
//
//   fixtures/accuracy/{agent}/{fixtureId}/input/…        files the agent reads (InputSource "fixture")
//   fixtures/accuracy/{agent}/{fixtureId}/recorded.json  { "<router task>": <model output>, … }
//   fixtures/accuracy/{agent}/{fixtureId}/expected.json  { flags, figures, deliverables } (FixtureExpectedSchema)
//   fixtures/accuracy/{agent}/_mistakes/*.json           approved MistakeLog rules: { id, pattern, ruleProposal, example }
//
// Approved mistakes are promoted into the fixture pack (as decideMistake would) and replayed.
//
// Input sensitivity: after its N runs, every fixture runs once more on agent.probeMutation(input)
// with the SAME recorded responses; at least one figure or flag must differ from run 1, or the
// agent is not reading its input (audit C1). Flags are split by the rule kind from the pack.
//
// ADR-008: the run's guardrail outcomes (abstentions, disagreements, out-of-scope rules from the
// checklist flags; ungrounded / scope-violation / agreement counts from its `guardrail-run`
// AuditEvent) are collected per run; the agent's scope and task schemas are checked statically.
// `<task>#2` recordings answer the agreement re-ask; without one the single answer is reused and
// noted. A fixture whose expected.json names an `error` must fail with it and is not probed.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { FirmService } from "@prisma/client";
import { z } from "zod";
import {
  ACCURACY_THRESHOLDS,
  FixtureExpectedSchema,
  probeVerdict,
  scoreAgent,
  type AgentScore,
  type FixtureExpected,
  type FixtureOutcome,
  type FixtureRuns,
  type GuardrailOutcome,
  type ReplayOutcome,
  type RunMode,
  type Thresholds,
} from "./accuracy";
import { MistakeRuleProposalSchema, withPromotedRule, type ChecklistPack, type ResultFlag, type RuleDefinition, type RuleKind } from "./checklist";
import { taskLabel, validateScope } from "./guardrails/scope";
import { hasAbstainOption, unboundedStrings } from "./guardrails/schema";
import { GUARDRAIL_RUN_ACTION, type GuardrailStats } from "./guardrails/session";
import { staticInputSource } from "./inputs";
import { createMemoryDb } from "./memory-db";
import { createMemoryStore } from "./memory-store";
import { replayMistake } from "./mistakes";
import { checkWorkbookShape } from "./preview";
import { SECOND_OPINION_SUFFIX, createRecordedRouter, type RecordedResponses, type RecordedRouter } from "./recorded-router";
import { jobFolder, runAgent, type AnyAgent, type InputFile, type ModelRouterLike } from "./runner";

export const DEFAULT_FIXTURES_ROOT = "fixtures/accuracy";
export const FIXTURE_CLIENT_CODE = "ACCURACY";
/** Pinned clock for fixture runs (deliverable headers only; nothing scored depends on it). */
export const FIXTURE_NOW = new Date("2026-11-05T06:30:00.000Z");

export type FixtureCase = { id: string; expected: FixtureExpected; recorded: RecordedResponses; inputFiles: InputFile[] };

export const ApprovedMistakeSchema = z.object({ id: z.string().min(1), pattern: z.string().optional(), ruleProposal: MistakeRuleProposalSchema, example: z.unknown() });
export type ApprovedMistake = z.infer<typeof ApprovedMistakeSchema>;

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;
const dirs = (p: string) => (existsSync(p) ? readdirSync(p).filter((n) => statSync(join(p, n)).isDirectory()).sort() : []);

/** Agents that have a fixture folder under `root`. */
export function agentsWithFixtures(root: string): string[] {
  return dirs(root).filter((a) => !a.startsWith("_") && !a.startsWith("."));
}

export function loadFixtures(root: string, agent: string): FixtureCase[] {
  const base = join(root, agent);
  return dirs(base)
    .filter((id) => !id.startsWith("_") && !id.startsWith("."))
    .map((id) => {
      const dir = join(base, id);
      const parsed = FixtureExpectedSchema.safeParse(readJson(join(dir, "expected.json")));
      if (!parsed.success) throw new Error(`${agent}/${id}/expected.json: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      const inputDir = join(dir, "input");
      const inputFiles: InputFile[] = existsSync(inputDir)
        ? readdirSync(inputDir)
            .filter((n) => statSync(join(inputDir, n)).isFile())
            .sort()
            .map((name) => ({ name, source: "fixture" as const, bytes: readFileSync(join(inputDir, name)) }))
        : [];
      const recordedPath = join(dir, "recorded.json");
      const recorded = existsSync(recordedPath) ? (readJson(recordedPath) as RecordedResponses) : {};
      return { id, expected: parsed.data, recorded, inputFiles };
    });
}

export function loadApprovedMistakes(root: string, agent: string): ApprovedMistake[] {
  const dir = join(root, agent, "_mistakes");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => {
      const p = ApprovedMistakeSchema.safeParse(readJson(join(dir, n)));
      if (!p.success) throw new Error(`${agent}/_mistakes/${n}: ${p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return p.data;
    });
}

/** The agent's default pack with every approved mistake promoted, in order (minor bump each). */
export function packWithMistakes(def: AnyAgent, mistakes: ApprovedMistake[]): ChecklistPack {
  return mistakes.reduce((pack, m) => withPromotedRule(pack, m.ruleProposal, m.id), def.defaultChecklist);
}

const DEFAULT_PERIOD: Partial<Record<FirmService, string>> = { GST: "2026-10", Books: "2026-10", TDS: "Q2" };

/** One run of the real pipeline on one fixture, with mocked I/O. */
export async function runFixtureOnce(def: AnyAgent, fx: FixtureCase, pack: ChecklistPack, router?: ModelRouterLike): Promise<FixtureOutcome> {
  const db = createMemoryDb({ now: () => FIXTURE_NOW });
  const store = createMemoryStore();
  const fy = fx.expected.job?.fy ?? "2026-27";
  const period = fx.expected.job?.period ?? DEFAULT_PERIOD[def.service] ?? "Annual";
  db.seed("client", [{ id: "fixture-client", name: `Fixture ${fx.id}` }]);
  db.seed("firmClient", [{ id: "fixture-firm-client", lmsClientId: "fixture-client", clientCode: FIXTURE_CLIENT_CODE }]);
  db.seed("jobTask", [
    { id: "fixture-job", firmClientId: "fixture-firm-client", service: def.service, fy, period, title: fx.expected.job?.title ?? def.title, state: "ASSIGNED", assigneeId: "fixture-preparer", reviewerId: "fixture-reviewer" },
  ]);
  const [major, minor, patch] = pack.version.split(".").map(Number);
  db.seed("sopPack", [{ key: def.sopPackKey, version: pack.version, major, minor, patch, title: def.title, checklist: pack }]);

  let n = 0;
  const modelRouter = router ?? createRecordedRouter(fx.recorded);
  const requested = () => ("asked" in modelRouter ? [...(modelRouter as RecordedRouter).asked] : undefined);
  const out = await runAgent(def, "fixture-job", {
    db,
    router: modelRouter,
    store,
    inputs: staticInputSource(fx.inputFiles),
    now: () => FIXTURE_NOW,
    ids: () => `${fx.id}-run-${++n}`,
  });
  if (!out.ok) {
    const runId = out.code === "FAILED" ? out.runId : null;
    return { flags: [], figures: {}, deliverables: [], error: `${out.code}: ${out.reason}`, requestedTasks: requested(), guardrails: runId && def.scope ? guardrailOutcome(db, runId) : undefined };
  }

  const checklist = (db.tables.checklistResult as { agentRunId: string; ruleId: string; severity: string; status: string }[]).filter((r) => r.agentRunId === out.runId);
  const flags = checklist.filter((r) => r.status === "fail").map((r) => ({ ruleId: r.ruleId, severity: r.severity as RuleDefinition["severity"] }));
  const statuses = Object.fromEntries(checklist.map((r) => [r.ruleId, r.status as "pass" | "fail" | "na"]));

  const working = jobFolder({ clientCode: FIXTURE_CLIENT_CODE, fy, service: def.service, period }, "Working");
  const deliverables: FixtureOutcome["deliverables"] = [];
  const files = store.list(working.path);
  const slug = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const matched = new Set<string>();
  for (const want of fx.expected.deliverables) {
    const file = files.find((f) => f.includes(`_${slug(want.name)}_`));
    if (!file) {
      deliverables.push({ name: want.name, problems: ["not produced"] });
      continue;
    }
    matched.add(file);
    const bytes = (await store.read("memory-drive", working.path, file)) as Buffer;
    const problems = file.endsWith(".xlsx")
      ? await checkWorkbookShape(bytes, want.sheets)
      : bytes.subarray(0, 2).toString() === "PK"
        ? []
        : ["not a valid Office file"];
    deliverables.push({ name: want.name, problems });
  }
  for (const f of files.filter((x) => !matched.has(x))) deliverables.push({ name: f, problems: ["unexpected deliverable"] });
  return { flags, figures: out.figures, deliverables, requestedTasks: requested(), guardrails: def.scope ? guardrailOutcome(db, out.runId) : undefined, statuses };
}

/** Rules whose outcome follows a model task's output: the ruleIds the scope's task specs declare (LLM rules excluded later). */
export const modelDependentRulesOf = (def: AnyAgent): string[] => [...new Set((def.scope?.tasks ?? []).flatMap((t) => [...(t.ruleIds ?? [])]))].sort();

/** ADR-008 outcomes of one run: checklist flags + the run's guardrail-run AuditEvent counts. */
function guardrailOutcome(db: ReturnType<typeof createMemoryDb>, runId: string): GuardrailOutcome | undefined {
  const event = (db.tables.auditEvent as { action: string; entityId: string | null; meta: unknown }[]).find((e) => e.action === GUARDRAIL_RUN_ACTION && e.entityId === runId);
  const stats = (event?.meta ?? null) as Partial<GuardrailStats> | null;
  const results = (db.tables.checklistResult as { agentRunId: string; ruleId: string; evidence: unknown }[]).filter((r) => r.agentRunId === runId);
  if (!stats && !results.length) return undefined;
  const withFlag = (flag: ResultFlag) => results.filter((r) => ((r.evidence as { flags?: string[] } | null)?.flags ?? []).includes(flag)).map((r) => r.ruleId).sort();
  return {
    insufficientEvidence: withFlag("insufficient-evidence"),
    disagreements: withFlag("model-disagreement"),
    outOfScope: withFlag("out-of-scope"),
    ungrounded: stats?.ungrounded ?? 0,
    scopeViolations: stats?.scopeViolations ?? 0,
    agreementChecks: stats?.agreementChecks ?? 0,
    wrongInput: stats?.wrongInput ?? 0,
  };
}

/** Static ADR-008 checks of an agent's scope and task schemas (no runs needed). */
export function staticGuardrailChecks(def: AnyAgent): { scopeDeclared: boolean; scopeProblems: string[]; modelTasks: number; unbounded: string[]; notAbstainable: string[] } {
  if (!def.scope) return { scopeDeclared: false, scopeProblems: [], modelTasks: 0, unbounded: [], notAbstainable: [] };
  const tasks = def.scope.tasks;
  return {
    scopeDeclared: true,
    scopeProblems: validateScope(def),
    modelTasks: tasks.length,
    unbounded: tasks.flatMap((t) => unboundedStrings(t.schema).map((p) => `${taskLabel(t)}: ${p}`)),
    notAbstainable: tasks.filter((t) => !hasAbstainOption(t.schema)).map(taskLabel),
  };
}

const sameFiles = (a: InputFile[], b: InputFile[]) => a.length === b.length && a.every((f, i) => f.name === b[i].name && f.bytes.equals(b[i].bytes));
const copyFiles = (files: InputFile[]): InputFile[] => files.map((f) => ({ ...f, bytes: Buffer.from(f.bytes) }));

/** ruleId → kind for every rule of a pack. */
export const ruleKindsOf = (pack: ChecklistPack): Record<string, RuleKind> => Object.fromEntries(pack.rules.map((r) => [r.id, r.kind]));

export type AccuracyOptions = {
  root?: string;
  runs?: number;
  thresholds?: Thresholds;
  /**
   * "recorded" (default): model answers come from recorded.json, LLM flags are gated as code path
   * only. "live" (Phase 2b): routerFor must supply a live provider; LLM flags are gated on the
   * thresholds like deterministic ones.
   */
  mode?: RunMode;
  /** Replace the recorded router (determinism self-test; Phase 2b live providers). Run index `runs` is the probe run. */
  routerFor?: (fx: FixtureCase, run: number) => ModelRouterLike;
};

/** Score one agent over its fixture set. */
export async function runAgentAccuracy(def: AnyAgent, opts: AccuracyOptions = {}): Promise<AgentScore> {
  const root = opts.root ?? DEFAULT_FIXTURES_ROOT;
  const t = opts.thresholds ?? ACCURACY_THRESHOLDS;
  const runs = opts.runs ?? t.runs;
  const mode = opts.mode ?? "recorded";
  if (mode === "live" && !opts.routerFor) throw new Error("live mode needs routerFor (a live provider per fixture)");
  const mistakes = loadApprovedMistakes(root, def.key);
  const pack = packWithMistakes(def, mistakes);
  const results: FixtureRuns[] = [];
  for (const fx of loadFixtures(root, def.key)) {
    const outcomes: FixtureOutcome[] = [];
    for (let i = 0; i < runs; i++) outcomes.push(await runFixtureOnce(def, fx, pack, opts.routerFor?.(fx, i)));
    const result: FixtureRuns = { id: fx.id, expected: fx.expected, runs: outcomes };
    if (def.inputProbes?.length && !fx.expected.error) {
      // One probe per input file kind: same recordings, one value in THAT file changed.
      result.probes = [];
      for (const p of def.inputProbes) {
        const mutated = await p.mutate(copyFiles(fx.inputFiles));
        if (sameFiles(fx.inputFiles, mutated)) {
          result.probes.push({ input: p.input, applied: false, changed: false, reason: `the ${p.input} probe left the input unchanged` });
          continue;
        }
        const v = probeVerdict(outcomes[0], await runFixtureOnce(def, { ...fx, inputFiles: mutated }, pack, opts.routerFor?.(fx, runs)), true);
        result.probes.push({ input: p.input, applied: true, changed: v.changed, reason: v.reason });
      }
    } else if (def.probeMutation && !fx.expected.error) {
      // Same recordings, one input value changed: something scored must move.
      const mutated = def.probeMutation(copyFiles(fx.inputFiles));
      const changedInput = !sameFiles(fx.inputFiles, mutated);
      const probeRun = changedInput ? await runFixtureOnce(def, { ...fx, inputFiles: mutated }, pack, opts.routerFor?.(fx, runs)) : outcomes[0];
      result.probe = probeVerdict(outcomes[0], probeRun, changedInput);
    }
    if (!opts.routerFor) {
      const asked = new Set(outcomes.flatMap((o) => o.requestedTasks ?? []));
      const unused = Object.keys(fx.recorded).filter((task) => !asked.has(task));
      if (unused.length) result.unusedRecordings = unused.sort();
      const single = [...asked].filter((k) => k.endsWith(SECOND_OPINION_SUFFIX) && !Object.prototype.hasOwnProperty.call(fx.recorded, k));
      if (single.length) result.singleAnswer = single.map((k) => k.slice(0, -SECOND_OPINION_SUFFIX.length)).sort();
    }
    results.push(result);
  }
  const replay: ReplayOutcome[] = [];
  for (const m of mistakes) {
    const rule = pack.rules.find((r) => r.id === m.ruleProposal.id)!;
    const r = await replayMistake(def, rule, m.example);
    replay.push({ mistakeId: m.id, ruleId: rule.id, caught: r.caught, reason: r.reason });
  }
  return scoreAgent(def.key, `${basename(root)}/${def.key}`, results, replay, t, {
    mode,
    internal: def.internal === true,
    probeDeclared: typeof def.probeMutation === "function",
    ruleKinds: ruleKindsOf(pack),
    ...staticGuardrailChecks(def),
    modelDependentRules: modelDependentRulesOf(def),
    probeInputs: (def.inputProbes ?? []).map((p) => p.input),
    requiredInputs: def.requiredInputs ?? [],
    coverageExemptions: def.coverageExemptions,
  });
}
