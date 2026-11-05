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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { FirmService } from "@prisma/client";
import { z } from "zod";
import { FixtureExpectedSchema, scoreAgent, type AgentScore, type FixtureExpected, type FixtureOutcome, type ReplayOutcome, type Thresholds, ACCURACY_THRESHOLDS } from "./accuracy";
import { MistakeRuleProposalSchema, withPromotedRule, type ChecklistPack, type RuleDefinition } from "./checklist";
import { staticInputSource } from "./inputs";
import { createMemoryDb } from "./memory-db";
import { createMemoryStore } from "./memory-store";
import { replayMistake } from "./mistakes";
import { checkWorkbookShape } from "./preview";
import { createRecordedRouter, type RecordedResponses } from "./recorded-router";
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
  const out = await runAgent(def, "fixture-job", {
    db,
    router: router ?? createRecordedRouter(fx.recorded),
    store,
    inputs: staticInputSource(fx.inputFiles),
    now: () => FIXTURE_NOW,
    ids: () => `${fx.id}-run-${++n}`,
  });
  if (!out.ok) return { flags: [], figures: {}, deliverables: [], error: `${out.code}: ${out.reason}` };

  const flags = (db.tables.checklistResult as { agentRunId: string; ruleId: string; severity: string; status: string }[])
    .filter((r) => r.agentRunId === out.runId && r.status === "fail")
    .map((r) => ({ ruleId: r.ruleId, severity: r.severity as RuleDefinition["severity"] }));

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
  return { flags, figures: out.figures, deliverables };
}

export type AccuracyOptions = {
  root?: string;
  runs?: number;
  thresholds?: Thresholds;
  /** Replace the recorded router (determinism self-test; Phase 2b live providers). */
  routerFor?: (fx: FixtureCase, run: number) => ModelRouterLike;
};

/** Score one agent over its fixture set. */
export async function runAgentAccuracy(def: AnyAgent, opts: AccuracyOptions = {}): Promise<AgentScore> {
  const root = opts.root ?? DEFAULT_FIXTURES_ROOT;
  const t = opts.thresholds ?? ACCURACY_THRESHOLDS;
  const runs = opts.runs ?? t.runs;
  const mistakes = loadApprovedMistakes(root, def.key);
  const pack = packWithMistakes(def, mistakes);
  const results = [];
  for (const fx of loadFixtures(root, def.key)) {
    const outcomes: FixtureOutcome[] = [];
    for (let i = 0; i < runs; i++) outcomes.push(await runFixtureOnce(def, fx, pack, opts.routerFor?.(fx, i)));
    results.push({ id: fx.id, expected: fx.expected, runs: outcomes });
  }
  const replay: ReplayOutcome[] = [];
  for (const m of mistakes) {
    const rule = pack.rules.find((r) => r.id === m.ruleProposal.id)!;
    const r = await replayMistake(def, rule, m.example);
    replay.push({ mistakeId: m.id, ruleId: rule.id, caught: r.caught, reason: r.reason });
  }
  return scoreAgent(def.key, `${basename(root)}/${def.key}`, results, replay, t);
}
