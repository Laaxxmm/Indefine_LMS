// Efficiency measurement for Firm OS (docs/qa/efficiency-report.md). Counts, with instrumented
// fakes and no network:
//
//   agents   for every accuracy fixture of every agent: model calls per run (by task@version,
//            agreement re-asks `#2` and router escalations included), estimated tokens in/out,
//            Graph calls (by verb + path shape) and database operations — the agent pipeline's
//            Prisma calls plus the router's own ModelCall log / budget reads. The REAL ModelRouter
//            runs (masking, schema, validators, escalation, budget, logging) over a provider that
//            answers from the fixture's recorded.json; the REAL deliverable store and ClientDocs
//            input source run over tests/fakes/fake-sharepoint.ts. A second run of the same job on
//            unchanged inputs ("re-run") shows what the response cache saves.
//   views    Prisma operations per render of the agents list, "Waiting for you", run review,
//            focus / next task, the coach page, search and the mistakes admin list, on a firm-sized
//            in-memory database (200 clients, 2,000 jobs).
//   crons    operations (and Graph calls) per execution of the close-loop reconciler, the coach
//            jobs and the retention job at the same size.
//   storage  bytes per row from rows the runs actually wrote, and a one-year projection.
//
// "SQL statements (est.)" counts one statement per Prisma operation plus one per relation level a
// select / include loads (Prisma 6 without the relationJoins preview issues one query per level),
// plus BEGIN/COMMIT for an interactive transaction.
//
// Vitest-safe: no top-level side effects; the CLI is scripts/efficiency-report.ts.
import { createHash } from "node:crypto";
import type { FirmService, JobTaskState } from "@prisma/client";
import type { Session } from "next-auth";
import { loadRouterConfig } from "@/lib/ai/config";
import { ProviderUnavailableError } from "@/lib/ai/errors";
import { createRouter, modelCallTask, type ModelCallRepo, type ModelCallRow, type ModelProvider, type ModelRequest, type ProviderRequest } from "@/lib/ai/router";
import { FIXTURE_CLIENT_CODE, FIXTURE_NOW, loadApprovedMistakes, loadFixtures, packWithMistakes, runFixtureOnce, type FixtureCase } from "@/lib/agents/core/accuracy-run";
import type { ChecklistPack } from "@/lib/agents/core/checklist";
import { defaultInputSource } from "@/lib/agents/core/inputs";
import { createMemoryDb, type MemoryDb } from "@/lib/agents/core/memory-db";
import { MissingRecordingError, recordingKey } from "@/lib/agents/core/recorded-router";
import { jobFolder, runAgent, type AnyAgent, type ModelRouterLike } from "@/lib/agents/core/runner";
import { createDeliverableStore } from "@/lib/integrations/sharepoint/deliverable-store";
import { createSharePointClient } from "@/lib/integrations/sharepoint/graph-client";
import { FakeSharePoint } from "../../tests/fakes/fake-sharepoint";

// ================================================================== counting

export type OpCounts = Record<string, number>;
export type Counter = { ops: OpCounts; sql: number };

export const newCounter = (): Counter => ({ ops: {}, sql: 0 });
export const totalOps = (c: OpCounts) => Object.values(c).reduce((n, v) => n + v, 0);

const RELATION_NAMES = new Set([
  "firmClient", "client", "jobTask", "jobTasks", "agentRun", "agentRuns", "checklist", "deliverables", "events", "engagement",
  "engagements", "turiaSyncs", "primaryHandler", "jobs", "documents", "serviceType", "handler", "job", "user", "manager",
]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

/** Relation levels a select / include loads (each is one more SQL statement in Prisma 6). */
export function relationLoads(spec: unknown): number {
  if (!isObj(spec)) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(spec)) {
    if (!v) continue;
    if (k === "_count") {
      n += 1;
      continue;
    }
    if (isObj(v) && ("select" in v || "include" in v || "where" in v || "orderBy" in v || "take" in v)) n += 1 + relationLoads(v.select ?? v.include);
    else if (v === true && RELATION_NAMES.has(k)) n += 1;
  }
  return n;
}

/** Estimated SQL statements for one Prisma call. */
export function sqlFor(method: string, args: unknown): number {
  if (method === "$transaction") return 2;
  const a = isObj(args) ? args : {};
  return 1 + relationLoads(a.select ?? a.include);
}

/**
 * Wraps every delegate method of a Prisma-shaped client in place so calls are counted as
 * "model.method" (also inside $transaction callbacks, which receive the same delegate objects).
 */
export function instrument<T extends object>(db: T, counter: Counter, opts: { models?: string[] } = {}): T {
  const target = db as unknown as Record<string, unknown>;
  const keys = opts.models ?? Object.keys(target);
  for (const model of keys) {
    if (model === "tables") continue;
    const delegate = target[model];
    if (model === "$transaction" && typeof delegate === "function") {
      const fn = delegate as (...a: unknown[]) => unknown;
      target[model] = (...args: unknown[]) => {
        counter.ops.$transaction = (counter.ops.$transaction ?? 0) + 1;
        counter.sql += 2;
        return fn.apply(db, args);
      };
      continue;
    }
    if (!isObj(delegate)) continue;
    for (const method of Object.keys(delegate)) {
      const fn = delegate[method];
      if (typeof fn !== "function") continue;
      const label = `${model}.${method}`;
      delegate[method] = (...args: unknown[]) => {
        counter.ops[label] = (counter.ops[label] ?? 0) + 1;
        counter.sql += sqlFor(method, args[0]);
        return (fn as (...a: unknown[]) => unknown).apply(delegate, args);
      };
    }
  }
  return db;
}

// ================================================================== Graph

/** "GET item by path", "PUT upload file", … from a fake-transport call. */
export function graphCallKind(method: string, url: string): string {
  const u = url.replace("https://graph.microsoft.com/v1.0", "");
  const path = u.split("?")[0];
  if (path === "/$batch") return `${method} $batch`;
  if (/^\/sites\/[^/:]+:\/sites\/[^/]+$/.test(path)) return `${method} site by path`;
  if (/^\/sites\/[^/]+\/drives$/.test(path)) return `${method} site drives`;
  if (/^\/sites\/[^/]+\/lists$/.test(path)) return `${method} site lists`;
  if (/:\/children$|\/root\/children$/.test(path)) return `${method} folder children`;
  if (/:\/content$/.test(path)) return method === "GET" ? "GET file content (download)" : `${method} file content (upload)`;
  if (/:\/createUploadSession$/.test(path)) return `${method} upload session`;
  if (/^\/drives\/[^/]+\/root(:\/.+)?$/.test(path)) return `${method} item by path`;
  if (/\/_upload\//.test(url)) return `${method} upload session chunk`;
  if (/\/_api\//.test(url)) return `${method} SharePoint REST`;
  return `${method} ${path}`;
}

export function countGraph(calls: { method: string; url: string }[]): OpCounts {
  const out: OpCounts = {};
  for (const c of calls) {
    const k = graphCallKind(c.method, c.url);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Bytes Graph returned to us, per call kind (JSON bodies and downloads), measured on the fake transport. */
export function meteredFetch(fake: FakeSharePoint, bytes: OpCounts): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const res = await fake.fetch(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    const k = graphCallKind((init?.method ?? "GET").toUpperCase(), url);
    bytes[k] = (bytes[k] ?? 0) + buf.length;
    return new Response(buf.length ? buf : null, { status: res.status, headers: res.headers });
  };
}

// ================================================================== model calls

export type ModelCallMeasure = { task: string; model: string; tokensIn: number; tokensOut: number };

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

/** Input tokens of one provider request: system + messages + the JSON schema the API also receives. */
export function requestTokens(req: ProviderRequest): number {
  return estimateTokens((req.system ?? "") + req.messages.map((m) => m.content).join("") + JSON.stringify(req.jsonSchema));
}

const unavailable = (id: "grok" | "local"): ModelProvider => ({
  id,
  isAvailable: async () => false,
  complete: async () => {
    throw new ProviderUnavailableError(id, "not configured in the efficiency harness");
  },
});

export type MeasuringRouter = ModelRouterLike & {
  calls: ModelCallMeasure[];
  repoOps: OpCounts;
  rows: ModelCallRow[];
};

/** Extra router dependencies the harness passes through (e.g. a response cache, once one exists). */
export type RouterExtras = Record<string, unknown>;

/**
 * The real ModelRouter (mask → budget → call → unmask → validate → escalate → log) over a provider
 * that answers from the fixture's recordings (same lookup as the recorded router: `<task>#2` for
 * the agreement re-ask, else `<task>`). Every attempt is counted, so a recorded answer a validator
 * rejects shows the escalations the router would make.
 */
export function measuringRouter(recorded: Record<string, unknown>, opts: { extras?: RouterExtras; repo?: Partial<ModelCallRepo> & Record<string, unknown> } = {}): MeasuringRouter {
  const calls: ModelCallMeasure[] = [];
  const repoOps: OpCounts = {};
  const rows: ModelCallRow[] = [];
  const bump = (k: string) => (repoOps[k] = (repoOps[k] ?? 0) + 1);
  let current: ModelRequest<unknown> | null = null;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(recorded, k);
  const claude: ModelProvider = {
    id: "claude",
    isAvailable: async () => true,
    async complete<T>(preq: ProviderRequest) {
      const req = current!;
      const key = recordingKey(req);
      let output: unknown;
      if (has(key)) output = structuredClone(recorded[key]);
      else if (has(req.task)) output = structuredClone(recorded[req.task]);
      else throw new MissingRecordingError(req.task);
      const answer = { output, confidence: 1 };
      const m = { task: modelCallTask(req), model: preq.model, tokensIn: requestTokens(preq), tokensOut: estimateTokens(JSON.stringify(answer)) };
      calls.push(m);
      return { output: answer as T, model: preq.model, tokensIn: m.tokensIn, tokensOut: m.tokensOut, latencyMs: 0 };
    },
  };
  const repo: ModelCallRepo = {
    async record(row) {
      bump("modelCall.create");
      rows.push(row);
    },
    async costInrSince() {
      bump("modelCall.aggregate (day budget)");
      return 0;
    },
    async costInrForRun() {
      bump("modelCall.aggregate (run budget)");
      return 0;
    },
    ...(opts.repo ?? {}),
  } as ModelCallRepo;
  const inner = createRouter({
    providers: { claude, grok: unavailable("grok"), local: unavailable("local") },
    repo,
    config: loadRouterConfig({}),
    now: () => FIXTURE_NOW,
    ...(opts.extras ?? {}),
  } as Parameters<typeof createRouter>[0]);
  return {
    calls,
    repoOps,
    rows,
    run(req) {
      current = req as ModelRequest<unknown>;
      return inner.run(req);
    },
  };
}

// ================================================================== agents

const DEFAULT_PERIOD: Partial<Record<FirmService, string>> = { GST: "2026-10", Books: "2026-10", TDS: "Q2" };

export type RunMeasure = {
  ok: boolean;
  error?: string;
  modelCalls: number;
  byTask: OpCounts;
  byModel: OpCounts;
  tokensIn: number;
  tokensOut: number;
  /** Agent pipeline Prisma calls. */
  db: OpCounts;
  /** Router ModelCall log + budget reads. */
  routerDb: OpCounts;
  sql: number;
  graph: OpCounts;
  graphBytes: OpCounts;
  figures: Record<string, number>;
  flags: string[];
};

export type FixtureMeasure = { id: string; first: RunMeasure; rerun: RunMeasure; matchesRecorded: boolean };

export type AgentMeasure = {
  agent: string;
  fixtures: number;
  perRun: {
    modelCalls: number;
    tokensIn: number;
    tokensOut: number;
    dbOps: number;
    routerDbOps: number;
    sql: number;
    graphCalls: number;
    graphKiB: number;
    rerunModelCalls: number;
  };
  byTask: OpCounts;
  byModel: OpCounts;
  db: OpCounts;
  routerDb: OpCounts;
  graph: OpCounts;
  graphBytes: OpCounts;
  mismatches: string[];
  /** sha256 of every fixture's recorded-router outcome (figures, flags, statuses, guardrails). */
  fingerprint: string;
  rows: Record<string, Record<string, unknown>[]>;
};

export type HarnessOptions = { root?: string; extras?: () => RouterExtras; repo?: (db: MemoryDb) => Partial<ModelCallRepo> & Record<string, unknown> };

function sumInto(a: OpCounts, b: OpCounts, scale = 1) {
  for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v * scale;
}
const avg = (n: number, d: number) => (d ? Math.round((n / d) * 100) / 100 : 0);
const avgCounts = (c: OpCounts, d: number): OpCounts => Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, avg(v, d)]));

function seedFixture(db: MemoryDb, def: AnyAgent, fx: FixtureCase, pack: ChecklistPack) {
  const fy = fx.expected.job?.fy ?? "2026-27";
  const period = fx.expected.job?.period ?? DEFAULT_PERIOD[def.service] ?? "Annual";
  db.seed("client", [{ id: "fixture-client", name: `Fixture ${fx.id}` }]);
  db.seed("firmClient", [{ id: "fixture-firm-client", lmsClientId: "fixture-client", clientCode: FIXTURE_CLIENT_CODE }]);
  db.seed("jobTask", [
    { id: "fixture-job", firmClientId: "fixture-firm-client", service: def.service, fy, period, title: fx.expected.job?.title ?? def.title, state: "ASSIGNED", assigneeId: "fixture-preparer", reviewerId: "fixture-reviewer" },
  ]);
  const [major, minor, patch] = pack.version.split(".").map(Number);
  db.seed("sopPack", [{ key: def.sopPackKey, version: pack.version, major, minor, patch, title: def.title, checklist: pack }]);
  return { fy, period };
}

/** One fixture, two runs of the real pipeline on the same job (the second = a re-run on unchanged inputs). */
export async function measureFixture(def: AnyAgent, fx: FixtureCase, pack: ChecklistPack, opts: HarnessOptions = {}): Promise<{ first: RunMeasure; rerun: RunMeasure; db: MemoryDb; router: MeasuringRouter }> {
  const counter = newCounter();
  const db = createMemoryDb({ now: () => FIXTURE_NOW });
  const { fy, period } = seedFixture(db, def, fx, pack);
  instrument(db, counter);

  const fake = new FakeSharePoint();
  const site = fake.addSite(`/sites/CL-${FIXTURE_CLIENT_CODE}`);
  const drive = fake.addLibrary(site, "Compliance");
  const job = { clientCode: FIXTURE_CLIENT_CODE, fy, service: def.service, period };
  for (const k of ["Working", "Final"] as const) fake.addFolder(drive, jobFolder(job, k).path);
  const docs = jobFolder(job, "ClientDocs").path;
  fake.addFolder(drive, docs);
  for (const f of fx.inputFiles) fake.addFile(drive, `${docs}/${f.name}`, f.bytes);
  const graphBytes: OpCounts = {};
  const client = createSharePointClient({ fetch: meteredFetch(fake, graphBytes), graphToken: async () => "token", sleep: async () => {} });
  const store = createDeliverableStore(client);
  const inputs = defaultInputSource(client, store, { screen: { log: () => {} } });
  const router = measuringRouter(fx.recorded, { extras: opts.extras?.(), repo: opts.repo?.(db) });

  let n = 0;
  const deps = { db, router, store, inputs, now: () => FIXTURE_NOW, ids: () => `${fx.id}-run-${++n}` };
  const once = async (): Promise<RunMeasure> => {
    const before = { db: { ...counter.ops }, sql: counter.sql, calls: router.calls.length, repo: { ...router.repoOps }, graph: fake.calls.length, bytes: { ...graphBytes } };
    const out = await runAgent(def, "fixture-job", deps);
    const diff = (now: OpCounts, was: OpCounts): OpCounts => Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v - (was[k] ?? 0)]).filter(([, v]) => (v as number) > 0));
    const calls = router.calls.slice(before.calls);
    const byTask: OpCounts = {};
    const byModel: OpCounts = {};
    for (const c of calls) {
      byTask[c.task] = (byTask[c.task] ?? 0) + 1;
      byModel[c.model] = (byModel[c.model] ?? 0) + 1;
    }
    const runId = out.ok || out.code === "FAILED" ? out.runId : null;
    const results = (db.tables.checklistResult as { agentRunId: string; ruleId: string; status: string }[]).filter((r) => r.agentRunId === runId);
    return {
      ok: out.ok,
      error: out.ok ? undefined : `${out.code}: ${out.reason}`,
      modelCalls: calls.length,
      byTask,
      byModel,
      tokensIn: calls.reduce((s, c) => s + c.tokensIn, 0),
      tokensOut: calls.reduce((s, c) => s + c.tokensOut, 0),
      db: diff(counter.ops, before.db),
      routerDb: diff(router.repoOps, before.repo),
      sql: counter.sql - before.sql + totalOps(diff(router.repoOps, before.repo)),
      graph: countGraph(fake.calls.slice(before.graph)),
      graphBytes: diff(graphBytes, before.bytes),
      figures: out.ok ? out.figures : {},
      flags: results.filter((r) => r.status === "fail").map((r) => r.ruleId).sort(),
    };
  };
  const first = await once();
  // "Request changes" / re-run: the job goes back to IN_PREP and the agent runs again on the same files.
  await db.jobTask.update({ where: { id: "fixture-job" }, data: { state: "IN_PREP" } });
  const rerun = await once();
  return { first, rerun, db, router };
}

const fingerprintOf = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex");

export async function measureAgent(def: AnyAgent, opts: HarnessOptions = {}): Promise<AgentMeasure> {
  const root = opts.root ?? "fixtures/accuracy";
  const pack = packWithMistakes(def, loadApprovedMistakes(root, def.key));
  const fixtures = loadFixtures(root, def.key);
  const acc = { modelCalls: 0, tokensIn: 0, tokensOut: 0, dbOps: 0, routerDbOps: 0, sql: 0, graphCalls: 0, graphBytes: 0, rerunModelCalls: 0 };
  const byTask: OpCounts = {};
  const byModel: OpCounts = {};
  const dbOps: OpCounts = {};
  const routerDb: OpCounts = {};
  const graph: OpCounts = {};
  const graphBytes: OpCounts = {};
  const mismatches: string[] = [];
  const outcomes: unknown[] = [];
  const rows: Record<string, Record<string, unknown>[]> = { agentRun: [], checklistResult: [], deliverable: [], auditEvent: [], jobTaskEvent: [], modelCall: [] };
  for (const fx of fixtures) {
    const recorded = await runFixtureOnce(def, fx, pack);
    outcomes.push({ id: fx.id, figures: recorded.figures, flags: recorded.flags, statuses: recorded.statuses ?? null, guardrails: recorded.guardrails ?? null, error: recorded.error ?? null });
    const m = await measureFixture(def, fx, pack, opts);
    const f = m.first;
    const recordedFlags = recorded.flags.map((x) => x.ruleId).sort();
    if (JSON.stringify(f.figures) !== JSON.stringify(recorded.figures) || JSON.stringify(f.flags) !== JSON.stringify(recordedFlags)) {
      mismatches.push(`${fx.id}: the measured pipeline (real router + fake SharePoint) differs from the recorded-router outcome${f.error ? ` (${f.error})` : ""}`);
    }
    acc.modelCalls += f.modelCalls;
    acc.tokensIn += f.tokensIn;
    acc.tokensOut += f.tokensOut;
    acc.dbOps += totalOps(f.db);
    acc.routerDbOps += totalOps(f.routerDb);
    acc.sql += f.sql;
    acc.graphCalls += totalOps(f.graph);
    acc.graphBytes += totalOps(f.graphBytes);
    acc.rerunModelCalls += m.rerun.modelCalls;
    sumInto(byTask, f.byTask);
    sumInto(byModel, f.byModel);
    sumInto(dbOps, f.db);
    sumInto(routerDb, f.routerDb);
    sumInto(graph, f.graph);
    sumInto(graphBytes, f.graphBytes);
    const t = m.db.tables as Record<string, Record<string, unknown>[]>;
    const firstRun = `${fx.id}-run-1`;
    rows.agentRun.push(...t.agentRun.filter((r) => r.id === firstRun));
    rows.checklistResult.push(...t.checklistResult.filter((r) => r.agentRunId === firstRun));
    rows.deliverable.push(...t.deliverable.filter((r) => r.agentRunId === firstRun));
    rows.auditEvent.push(...t.auditEvent.filter((r) => r.entityId === firstRun));
    rows.jobTaskEvent.push(...(t.jobTaskEvent ?? []));
    rows.modelCall.push(...(m.router.rows.filter((r) => r.runId === firstRun) as unknown as Record<string, unknown>[]));
  }
  const n = fixtures.length;
  return {
    agent: def.key,
    fixtures: n,
    perRun: {
      modelCalls: avg(acc.modelCalls, n),
      tokensIn: Math.round(acc.tokensIn / Math.max(n, 1)),
      tokensOut: Math.round(acc.tokensOut / Math.max(n, 1)),
      dbOps: avg(acc.dbOps, n),
      routerDbOps: avg(acc.routerDbOps, n),
      sql: avg(acc.sql, n),
      graphCalls: avg(acc.graphCalls, n),
      graphKiB: avg(acc.graphBytes / 1024, n),
      rerunModelCalls: avg(acc.rerunModelCalls, n),
    },
    byTask: avgCounts(byTask, n),
    byModel: avgCounts(byModel, n),
    db: avgCounts(dbOps, n),
    routerDb: avgCounts(routerDb, n),
    graph: avgCounts(graph, n),
    graphBytes: avgCounts(graphBytes, n),
    mismatches,
    fingerprint: fingerprintOf(outcomes),
    rows,
  };
}

// ================================================================== a firm-sized database

export const FIRM = { clients: 200, jobs: 2000, staff: 16 } as const;
export const SCALE_NOW = new Date("2026-11-10T11:30:00.000Z"); // Tuesday 17:00 IST

type Level = "EXECUTIVE" | "SENIOR_EXECUTIVE" | "MANAGER" | "PARTNER";
export type SessionUserLike = Session["user"];

export function sessionUser(id: string, level: Level = "EXECUTIVE"): SessionUserLike {
  return { id, name: id, email: `${id}@indefine.test`, image: null, role: "EMPLOYEE", active: true, department: "ACCOUNTS", level } as unknown as SessionUserLike;
}

export const STAFF = Array.from({ length: FIRM.staff }, (_, i) => ({
  id: `u-${String(i + 1).padStart(2, "0")}`,
  level: (i === 0 ? "PARTNER" : i === 1 ? "PARTNER" : i < 5 ? "MANAGER" : i < 9 ? "SENIOR_EXECUTIVE" : "EXECUTIVE") as Level,
}));

const SERVICES: FirmService[] = ["GST", "GST", "GST", "GST", "GST", "GST", "IncomeTax", "IncomeTax", "ROC", "TDS", "Books", "Audit"];
const AGENT_OF: Partial<Record<FirmService, string>> = { GST: "gst", IncomeTax: "tax", ROC: "roc", Books: "books", Audit: "audit" };
/** State mix of 2,000 jobs in a year (most done; a working week's worth open). */
export const STATE_MIX: [JobTaskState, number][] = [
  ["DONE", 1500],
  ["ASSIGNED", 120],
  ["IN_PREP", 60],
  ["AGENT_DONE", 40],
  ["IN_REVIEW", 60],
  ["APPROVED", 30],
  ["FILED_BY_HUMAN", 10],
  ["CLOSING", 20],
  ["DONE", 160], // done in the last 30 days (re-checked by the reconciler)
];

export type FirmJob = {
  id: string;
  clientIdx: number;
  service: FirmService;
  state: JobTaskState;
  assigneeId: string;
  reviewerId: string;
  internalDueOn: Date;
  statutoryDueOn: Date;
  doneAt: Date | null;
  recentDone: boolean;
};

/** Deterministic 2,000-job firm (no randomness). */
export function firmJobs(now: Date = SCALE_NOW): FirmJob[] {
  const out: FirmJob[] = [];
  let i = 0;
  const day = 86_400_000;
  STATE_MIX.forEach(([state, count], block) => {
    for (let k = 0; k < count; k++, i++) {
      const assignee = STAFF[5 + (i % 11)].id;
      const reviewer = STAFF[1 + (i % 4)].id;
      const recentDone = state === "DONE" && block === STATE_MIX.length - 1;
      const offset = state === "DONE" ? -(recentDone ? 1 + (k % 29) : 31 + (k % 300)) : (k % 20) - 5;
      out.push({
        id: `job-${String(i + 1).padStart(4, "0")}`,
        clientIdx: i % FIRM.clients,
        service: SERVICES[i % SERVICES.length],
        state,
        assigneeId: assignee,
        reviewerId: reviewer,
        internalDueOn: new Date(now.getTime() + offset * day),
        statutoryDueOn: new Date(now.getTime() + (offset + 3) * day),
        doneAt: state === "DONE" ? new Date(now.getTime() + offset * day) : null,
        recentDone,
      });
    }
  });
  return out;
}

export const clientCode = (i: number) => `CL${String(i + 1).padStart(3, "0")}`;
const RUN_STATES: JobTaskState[] = ["AGENT_DONE", "IN_REVIEW", "APPROVED", "FILED_BY_HUMAN", "CLOSING", "DONE"];

/** The memory database the views read, at firm size: jobs, latest runs with ~20 checklist rows, deliverables, mistakes, packs. */
export function firmMemoryDb(packs: Record<string, ChecklistPack>, now: Date = SCALE_NOW): MemoryDb {
  const db = createMemoryDb({ now: () => now });
  db.seed("client", Array.from({ length: FIRM.clients }, (_, i) => ({ id: `c-${i}`, name: `Client ${i} Private Limited` })));
  db.seed("firmClient", Array.from({ length: FIRM.clients }, (_, i) => ({ id: `fc-${i}`, lmsClientId: `c-${i}`, clientCode: clientCode(i) })));
  const jobs = firmJobs(now);
  db.seed(
    "jobTask",
    jobs.map((j) => ({ id: j.id, firmClientId: `fc-${j.clientIdx}`, service: j.service, fy: "2026-27", period: j.service === "GST" ? "2026-10" : "Annual", title: `${j.service} ${j.id}`, state: j.state, assigneeId: j.assigneeId, reviewerId: j.reviewerId, internalDueOn: j.internalDueOn, statutoryDueOn: j.statutoryDueOn, doneAt: j.doneAt })),
  );
  for (const [key, pack] of Object.entries(packs)) {
    const [major, minor, patch] = pack.version.split(".").map(Number);
    db.seed("sopPack", [{ key, version: pack.version, major, minor, patch, title: key, checklist: pack }]);
  }
  const runs: Record<string, unknown>[] = [];
  const results: Record<string, unknown>[] = [];
  const deliverables: Record<string, unknown>[] = [];
  for (const j of jobs) {
    const agent = AGENT_OF[j.service];
    if (!agent || !RUN_STATES.includes(j.state)) continue;
    const id = `run-${j.id}`;
    runs.push({ id, jobTaskId: j.id, agent, sopPackVersion: "1.0.0", status: j.state === "AGENT_DONE" ? "AGENT_DONE" : "APPROVED", attempt: 1, startedAt: new Date(j.internalDueOn.getTime() - 86_400_000), figures: { totalPaise: 100 }, inputs: null });
    for (let r = 0; r < 20; r++) results.push({ id: `${id}-r${r}`, agentRunId: id, ruleId: `${agent}.rule-${r}`, severity: r < 6 ? "block" : r < 16 ? "warn" : "info", status: r === 3 || r === 9 ? "fail" : r === 12 ? "na" : "pass", message: "Rule checked", evidence: { quote: "row", location: "register.csv row 2", flags: [] }, source: "deterministic" });
    deliverables.push({ id: `${id}-d1`, jobTaskId: j.id, agentRunId: id, kind: "Working", name: `${id}_Pack_v1.xlsx`, spPath: "x", sha256: "0".repeat(64), sizeBytes: 20_000, version: 1 });
  }
  db.seed("agentRun", runs);
  db.seed("checklistResult", results);
  db.seed("deliverable", deliverables);
  const agents = Object.keys(packs);
  db.seed(
    "mistakeLog",
    Array.from({ length: 30 }, (_, i) => {
      const agent = agents[i % agents.length];
      const approved = i % 3 === 0;
      return { id: `ml-${i}`, agent, pattern: "missed finding", ruleProposal: { id: `${agent}.m-${i}`, title: `Rule ${i}`, kind: "deterministic", severity: "warn", check: `${agent}.no-such-check`, evidence: "row" }, status: approved ? "APPROVED" : "PROPOSED", createdById: "u-06", promotedToVersion: approved ? "1.0.0" : null, createdAt: new Date(now.getTime() - i * 3_600_000) };
    }),
  );
  db.seed("auditEvent", [{ actorId: "u-02", action: "comment", entity: "AgentRun", entityId: runs[0]?.id ?? null, meta: { text: "Please check row 4" } }]);
  return db;
}

// ================================================================== output helpers

export const kib = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;

export function countsTable(rows: Array<[string, number | string, (number | string)?]>, headers: [string, string, string?]): string {
  const h = headers[2] ? `| ${headers[0]} | ${headers[1]} | ${headers[2]} |\n|---|---:|---:|` : `| ${headers[0]} | ${headers[1]} |\n|---|---:|`;
  return [h, ...rows.map((r) => (headers[2] ? `| ${r[0]} | ${r[1]} | ${r[2] ?? "–"} |` : `| ${r[0]} | ${r[1]} |`))].join("\n");
}
