// Firm-sized scenarios for the efficiency report (scripts/lib/efficiency.ts has the counters):
// page / view renders, the close-loop gate and reconciler (database + Graph), the coach jobs, the
// retention job, and the storage estimate. All in memory; nothing here touches a network.
import { createHash } from "node:crypto";
import type { JobTaskState } from "@prisma/client";
import type { ChecklistPack } from "@/lib/agents/core/checklist";
import { loadCoachPage } from "@/lib/agents/coach/views";
import { runMorning, runReminders, runWeeklySummary } from "@/lib/agents/coach/cron";
import { listMistakes, listMyJobs, listRuns, loadRunReview } from "@/lib/agents/views";
import { AGENTS } from "@/lib/agents/registry";
import { getNextTaskView } from "@/lib/workspace/next-task";
import { search } from "@/lib/search/service";
import { memoryRateLimiter } from "@/lib/search/rate-limit";
import { closeJob, verifyDeliverable, type GateEvidence } from "@/lib/close-loop/gate";
import { reconcile } from "@/lib/close-loop/reconcile";
import { graphDeliverableVerifier } from "@/lib/close-loop/verifier";
import { runRetention } from "@/lib/hardening/retention";
import { createContentRegistry } from "@/lib/integrations/sharepoint/content-registry";
import { createDeliverableStore } from "@/lib/integrations/sharepoint/deliverable-store";
import { createSharePointClient } from "@/lib/integrations/sharepoint/graph-client";
import { deliverablePath } from "@/lib/integrations/sharepoint/paths";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { CloseLoopWorld, type DeliverableRec } from "../../tests/fakes/close-loop-world";
import { CoachWorld } from "../../tests/fakes/coach-world";
import { FakeSharePoint } from "../../tests/fakes/fake-sharepoint";
import { RetentionWorld } from "../../tests/fakes/retention-world";
import { PEOPLE, searchWorld } from "../../tests/fakes/search-world";
import {
  FIRM,
  SCALE_NOW,
  STAFF,
  clientCode,
  countGraph,
  firmJobs,
  firmMemoryDb,
  instrument,
  meteredFetch,
  newCounter,
  relationLoads,
  sessionUser,
  totalOps,
  type Counter,
  type OpCounts,
} from "./efficiency";

export type Measured = { ops: OpCounts; total: number; sql: number; graph?: OpCounts; graphTotal?: number; note?: string };

const done = (c: Counter, graph?: OpCounts, note?: string): Measured => ({
  ops: Object.fromEntries(Object.entries(c.ops).sort(([a], [b]) => a.localeCompare(b))),
  total: totalOps(c.ops),
  sql: c.sql,
  ...(graph ? { graph, graphTotal: totalOps(graph) } : {}),
  ...(note ? { note } : {}),
});

/** Run `fn` with the counter reset; return what it counted. */
async function measure(counter: Counter, fn: () => Promise<unknown>): Promise<Measured> {
  counter.ops = {};
  counter.sql = 0;
  await fn();
  return done(counter);
}

// ================================================================== views

export async function measureViews(packs: Record<string, ChecklistPack>): Promise<Record<string, Measured>> {
  const db = firmMemoryDb(packs);
  const c = newCounter();
  instrument(db, c);
  const partner = sessionUser(STAFF[0].id, "PARTNER");
  const staff = sessionUser(STAFF[6].id, "EXECUTIVE");
  const reviewer = sessionUser(STAFF[1].id, "PARTNER");
  const agents = Object.values(AGENTS);
  const now = SCALE_NOW;
  const runId = (db.tables.agentRun[0] as { id: string }).id;
  const out: Record<string, Measured> = {};
  out["/agents · agents list (listRuns, partner)"] = await measure(c, () => listRuns(db, partner));
  out["/agents · Waiting for you (listMyJobs, staff)"] = await measure(c, () => listMyJobs(db, staff, agents, now));
  out["/agents/[agent]/runs/[id] · run review (loadRunReview)"] = await measure(c, () => loadRunReview(db, reviewer, runId, now));
  out["/focus · next task (getNextTaskView, staff)"] = await measure(c, () => getNextTaskView(staff, { db, now: () => now }));
  out["/admin/firm-os/mistakes · mistakes (listMistakes, 30 rows)"] = await measure(c, () => listMistakes(db, partner));

  // Coach page on the coach fake at the same size.
  const cw = coachWorldAtScale();
  const cc = newCounter();
  instrument(cw.db, cc);
  out["/coach · coach board (loadCoachPage, manager)"] = await measure(cc, () => loadCoachPage(cw.db, { id: STAFF[2].id }, now));

  // Search on the search fixture world (it records every call it is given).
  const sw = searchWorld();
  const sdeps = { db: sw.db, limiter: memoryRateLimiter(), clPaths: false, now: () => new Date("2026-11-05T10:00:00Z") };
  for (const [label, q] of [["/search · text query (manager)", "acme"], ["/search · identifier query (PAN, manager)", "AAACA1234F"]] as const) {
    const before = sw.calls.length;
    await search(PEOPLE.manager, { q }, sdeps);
    const calls = sw.calls.slice(before);
    const ops: OpCounts = {};
    let sql = 0;
    for (const call of calls) {
      ops[`${call.model}.${call.method}`] = (ops[`${call.model}.${call.method}`] ?? 0) + 1;
      sql += 1 + relationLoads(call.args?.select ?? call.args?.include);
    }
    out[label] = { ops, total: calls.length, sql };
  }
  return out;
}

// ================================================================== coach

function coachWorldAtScale(): CoachWorld {
  const w = new CoachWorld();
  w.clock = () => SCALE_NOW;
  for (const s of STAFF) w.addUser(s.id, { level: s.level, managerId: s.level === "EXECUTIVE" || s.level === "SENIOR_EXECUTIVE" ? STAFF[2 + (Number(s.id.slice(2)) % 3)].id : s.level === "MANAGER" ? STAFF[0].id : null });
  for (const j of firmJobs()) {
    w.addJob({
      id: j.id,
      title: `${j.service} return`,
      service: j.service,
      state: j.state,
      period: j.service === "GST" ? "2026-10" : "Annual",
      assigneeId: j.assigneeId,
      reviewerId: j.reviewerId,
      internalDueOn: j.internalDueOn,
      statutoryDueOn: j.statutoryDueOn,
      doneAt: j.doneAt,
      firmClient: { clientCode: clientCode(j.clientIdx), client: { name: `Client ${j.clientIdx}` } },
      engagement: { reviewerId: null },
      events: j.state === "DONE" ? [{ fromState: "ASSIGNED", toState: "IN_PREP", createdAt: new Date(j.internalDueOn.getTime() - 5 * 86_400_000), note: null }, { fromState: "CLOSING", toState: "DONE", createdAt: j.doneAt!, note: null }] : [],
    });
  }
  return w;
}

const at = (iso: string) => new Date(iso);

export async function measureCoach(): Promise<{ results: Record<string, Measured>; events: Record<string, unknown>[] }> {
  const w = coachWorldAtScale();
  const c = newCounter();
  instrument(w.db, c);
  const results: Record<string, Measured> = {};
  const morning = at("2026-11-10T03:35:00.000Z"); // Tue 09:05 IST
  const remind = at("2026-11-10T11:00:00.000Z"); // Tue 16:30 IST
  const friday = at("2026-11-13T11:00:00.000Z"); // Fri 16:30 IST
  w.clock = () => morning;
  results["coach · morning board (09:00, once a working day)"] = await measure(c, () => runMorning({ db: w.db, now: () => morning }));
  w.clock = () => remind;
  results["coach · reminders (every 30 min, first run of the day)"] = await measure(c, () => runReminders({ db: w.db, now: () => remind }));
  const later = new Date(remind.getTime() + 30 * 60_000);
  w.clock = () => later;
  results["coach · reminders (every 30 min, a later run: nothing new)"] = await measure(c, () => runReminders({ db: w.db, now: () => later }));
  w.clock = () => friday;
  results["coach · weekly summary (Friday 16:00)"] = await measure(c, () => runWeeklySummary({ db: w.db, now: () => friday }));
  return { results, events: w.coachEvent.rows as Record<string, unknown>[] };
}

// ================================================================== retention

export async function measureRetention(): Promise<Measured> {
  const w = new RetentionWorld();
  const now = SCALE_NOW;
  const day = 86_400_000;
  for (let i = 0; i < 2700; i++) {
    const startedAt = new Date(now.getTime() - (i % 365) * day);
    w.runs.push({ id: `run-${i}`, inputs: i % 365 < 31 ? { files: [] } : null, inputsPurgeAt: new Date(startedAt.getTime() + 30 * day), startedAt, figures: {}, status: "APPROVED" });
  }
  for (let u = 0; u < FIRM.staff; u++) for (let m = 0; m < 8 * 450; m++) w.beats.push({ id: `b-${u}-${m}`, userId: STAFF[u].id, at: new Date(now.getTime() - m * 2.1 * 60_000), source: "lms" });
  for (let i = 0; i < 300; i++) w.calls.push({ id: `mc-${i}`, runId: `run-${i}`, agent: "gst", task: "gst.classify-ledgers@1", provider: "claude", tier: "SMART", escalationLevel: 1, status: "OK", escalated: true, createdAt: new Date(now.getTime() - (i % 7) * day - 1000) });
  const c = newCounter();
  instrument(w.db as unknown as object, c);
  const r = await measure(c, () => runRetention(w.db, now));
  return { ...r, note: "2,700 runs, 57,600 heartbeats (8 days), 300 escalated model calls in the 7-day window, none audited yet" };
}

// ================================================================== close loop: gate + reconciler (database + Graph)

const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

type ScaleWorld = { w: CloseLoopWorld; fake: FakeSharePoint; graphBytes: OpCounts; clientOf: (code: string) => ReturnType<typeof createSharePointClient> };

/**
 * A CloseLoopWorld with the firm's open close-loop jobs and its last 30 days of DONE jobs, every
 * Final file live in its client's CL- site on the fake SharePoint. `uploadedHere`: the files were
 * written by this process through the deliverable store (as copyToFinal does); otherwise they were
 * already there (e.g. after a restart).
 */
/**
 * external          files put in SharePoint by someone else (no fingerprint on the row, nothing in memory)
 * uploaded          files this process uploaded (copyToFinal): fingerprint in process memory and on the row
 * uploaded-restart  files this app uploaded before a restart: fingerprint on the row only
 */
type ScaleMode = "external" | "uploaded" | "uploaded-restart";

async function closeLoopAtScale(mode: ScaleMode): Promise<ScaleWorld> {
  const uploadedHere = mode !== "external";
  const w = new CloseLoopWorld();
  w.clock = () => SCALE_NOW;
  const fake = new FakeSharePoint();
  const graphBytes: OpCounts = {};
  const client = createSharePointClient({ fetch: meteredFetch(fake, graphBytes), graphToken: async () => "token", sleep: async () => {} });
  // Before a restart the upload's memory is lost: a registry that the measured run never sees.
  const store = createDeliverableStore(client, mode === "uploaded-restart" ? { registry: createContentRegistry() } : {});
  w.users = STAFF.map((s, i) => ({ id: s.id, name: s.id, managerId: i >= 5 ? STAFF[2].id : i >= 2 ? STAFF[0].id : null, level: s.level, active: true }));
  const drives = new Map<number, string>();
  const driveFor = (idx: number) => {
    let id = drives.get(idx);
    if (!id) {
      const site = fake.addSite(`/sites/CL-${clientCode(idx)}`);
      id = fake.addLibrary(site, "Compliance").id;
      drives.set(idx, id);
    }
    return id;
  };
  const filedAt = new Date(SCALE_NOW.getTime() - 26 * 3_600_000);
  for (const j of firmJobs()) {
    const relevant = j.recentDone || j.state === "CLOSING" || j.state === "FILED_BY_HUMAN";
    const job = w.addJob({
      id: j.id,
      state: j.state,
      service: "GST",
      period: "2026-10",
      title: "GSTR-3B",
      clientCode: clientCode(j.clientIdx),
      assigneeId: j.assigneeId,
      reviewerId: j.reviewerId,
      doneAt: j.doneAt,
      updatedAt: j.doneAt ?? filedAt,
      filedAt: relevant ? filedAt : null,
      filedById: relevant ? j.assigneeId : null,
    });
    if (!relevant) continue;
    const folder = deliverablePath(job.clientCode, job.fy, "GST", "2026-10", "Final");
    const name = `${job.clientCode}_GSTR-3B_2026-10_${j.id}_v1.xlsx`;
    const content = `final pack ${j.id} `.repeat(400); // ~8 KB, a typical small workbook
    const driveId = driveFor(j.clientIdx);
    let itemId: string;
    let fingerprint: { quickXorHash: string | null; cTag: string | null } = { quickXorHash: null, cTag: null };
    if (uploadedHere) {
      const stored = await store.putNew(driveId, folder.path, name, Buffer.from(content));
      itemId = stored.item.id;
      fingerprint = { quickXorHash: stored.quickXorHash, cTag: stored.cTag };
    } else {
      const drive = [...fake.sites.values()].flatMap((s) => [...s.drives.values()]).find((d) => d.id === driveId)!;
      fake.addFile(drive, `${folder.path}/${name}`, content);
      itemId = drive.items.get(`${folder.path}/${name}`)!.id;
    }
    const d: DeliverableRec = { id: `del-${j.id}`, jobTaskId: j.id, kind: "Final", name, spPath: folder.serverRelativeUrl, driveId, driveItemId: itemId, sha256: sha(content), ...fingerprint, sizeBytes: Buffer.byteLength(content), verifiedAt: null, createdAt: filedAt };
    w.deliverables.push(d);
    w.addFiledHistory(j.id, filedAt);
    const held = j.state === "CLOSING" && Number(j.id.slice(4)) % 2 === 0;
    if (j.state !== "FILED_BY_HUMAN" && !held) w.addCloseSync(j.id, { updatedAt: filedAt, createdAt: filedAt });
    if (j.recentDone) {
      const evidence: GateEvidence = {
        gate: "close-gate",
        v: 1,
        checkedAt: j.doneAt!.toISOString(),
        deliverables: [{ id: d.id, name, driveItemId: itemId, sha256: d.sha256, sizeBytes: d.sizeBytes, path: `${folder.path}/${name}` }],
        turia: { syncId: w.syncs.at(-1)!.id, mode: "MANUAL", turiaRef: "TT-1", minutesLogged: 60, confirmedById: j.assigneeId, spotCheck: false },
        filing: { filedEventId: "ev-x", closingEventId: "ev-y", filedById: j.assigneeId, filedAt: filedAt.toISOString(), ackRef: "AA2710260012345" },
      };
      w.addEvent(j.id, "CLOSING", "DONE", j.doneAt!, "system:close-gate", JSON.stringify(evidence));
    }
  }
  fake.calls.length = 0;
  for (const k of Object.keys(graphBytes)) delete graphBytes[k];
  return { w, fake, graphBytes, clientOf: () => client };
}

export async function measureReconciler(): Promise<Record<string, Measured>> {
  const out: Record<string, Measured> = {};
  for (const mode of ["external", "uploaded", "uploaded-restart"] as const) {
    const s = await closeLoopAtScale(mode);
    const c = newCounter();
    instrument(s.w.db, c);
    // A restarted process: an empty content registry (the verifier then has only the Deliverable rows).
    const registry = mode === "uploaded" ? undefined : createContentRegistry();
    const deps = () => ({ db: s.w.db, verifier: graphDeliverableVerifier(() => s.clientOf(""), registry ? { registry } : {}), turia: new ManualBridge(s.w.turiaRepo), now: () => SCALE_NOW });
    const label =
      mode === "uploaded"
        ? "files written by this process (copyToFinal)"
        : mode === "external"
          ? "files already in SharePoint (first run after a restart)"
          : "files this app uploaded, fingerprint on the row (first run after a restart)";
    const run = async (name: string, now: Date) => {
      c.ops = {};
      c.sql = 0;
      const g0 = s.fake.calls.length;
      s.w.clock = () => now;
      const summary = await reconcile({ ...deps(), now: () => now });
      const graph = countGraph(s.fake.calls.slice(g0));
      out[name] = { ...done(c, graph), note: `open ${summary.open}, closed ${summary.closed.length}, DONE re-checked ${summary.doneChecked}, alerts ${summary.alerts.length}, reminders ${summary.reminders}, escalations ${summary.escalations}` };
    };
    await run(`reconciler · run 1 · ${label}`, SCALE_NOW);
    await run(`reconciler · run 2 (30 min later) · ${label}`, new Date(SCALE_NOW.getTime() + 30 * 60_000));
  }
  return out;
}

/** One job end to end on Graph: Working pack uploaded, copied to Final, closed through the gate, then re-checked once. */
export async function measureCloseGate(): Promise<Record<string, Measured>> {
  const w = new CloseLoopWorld();
  w.clock = () => SCALE_NOW;
  const fake = new FakeSharePoint();
  const site = fake.addSite("/sites/CL-ACME01");
  const drive = fake.addLibrary(site, "Compliance");
  const graphBytes: OpCounts = {};
  const client = createSharePointClient({ fetch: meteredFetch(fake, graphBytes), graphToken: async () => "token", sleep: async () => {} });
  const store = createDeliverableStore(client);
  const job = w.addJob({ clientCode: "ACME01" });
  w.addFiledHistory(job.id);
  w.addCloseSync(job.id);
  const working = deliverablePath("ACME01", "2026-27", "GST", "2026-10", "Working").path;
  const final = deliverablePath("ACME01", "2026-27", "GST", "2026-10", "Final");
  const bytes = Buffer.from("x".repeat(48_000)); // a 48 KB pack
  const out: Record<string, Measured> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    const g0 = fake.calls.length;
    const b0 = { ...graphBytes };
    await fn();
    const graph = countGraph(fake.calls.slice(g0));
    const kib = Math.round(Object.entries(graphBytes).reduce((n, [k, v]) => n + v - (b0[k] ?? 0), 0) / 102.4) / 10;
    out[name] = { ops: {}, total: 0, sql: 0, graph, graphTotal: totalOps(graph), note: `${kib} KiB received from Graph` };
  };
  let driveId = "";
  await step("agent run · find the Compliance library (complianceDrive)", async () => {
    driveId = await store.complianceDrive("ACME01");
  });
  await step("agent run · find the Compliance library again (second deliverable / next run)", async () => {
    driveId = await store.complianceDrive("ACME01");
  });
  await step("agent run · upload one Working deliverable (putNew)", () => store.putNew(driveId, working, "ACME01_Pack_2026-10_v1.xlsx", bytes));
  let stored: Awaited<ReturnType<typeof store.copyVersioned>> | null = null;
  await step("approve · copy Working → Final (copyVersioned)", async () => {
    stored = await store.copyVersioned(driveId, working, "ACME01_Pack_2026-10_v1.xlsx", final.path);
  });
  const s = stored!;
  w.deliverables.push({ id: "del-final", jobTaskId: job.id, kind: "Final", name: s.fileName, spPath: final.serverRelativeUrl, driveId, driveItemId: s.item.id, sha256: s.sha256, sizeBytes: s.sizeBytes, verifiedAt: null, createdAt: SCALE_NOW });
  const verifier = graphDeliverableVerifier(() => client);
  await step("close gate · verify the Final file (closeJob)", async () => {
    const r = await closeJob(job.id, { kind: "system", name: "efficiency-harness" }, { db: w.db, verifier, now: () => SCALE_NOW });
    if (!r.ok) throw new Error(`close gate refused: ${r.reasons.join("; ")}`);
  });
  await step("reconciler · re-check the DONE file (verify, a later cron run)", async () => {
    const j = w.job(job.id);
    const r = await verifyDeliverable({ ...j, firmClient: { clientCode: j.clientCode } } as never, w.deliverables[0] as never, graphDeliverableVerifier(() => client));
    if (!r.ok) throw new Error(`re-check failed: ${r.check.message}`);
  });
  void drive;
  return out;
}

// ================================================================== storage

/** Postgres heap bytes for one value (text varlena header, jsonb ≈ 1.15 × JSON text, fixed widths). */
export function valueBytes(v: unknown, kind: "text" | "json" | "int" | "bigint" | "float" | "decimal" | "bool" | "ts"): number {
  if (v === null || v === undefined) return 0;
  switch (kind) {
    case "int":
      return 4;
    case "bigint":
    case "float":
    case "ts":
      return 8;
    case "decimal":
      return 10;
    case "bool":
      return 1;
    case "json": {
      const n = Buffer.byteLength(JSON.stringify(v));
      return Math.ceil(n * 1.15) + 4;
    }
    default: {
      const n = Buffer.byteLength(String(v));
      return n + (n < 127 ? 1 : 4);
    }
  }
}

type Col = [name: string, kind: Parameters<typeof valueBytes>[1]];
/** Firm OS columns and their index key columns (prisma/schema.prisma). */
export const TABLES: Record<string, { cols: Col[]; indexes: string[][] }> = {
  AgentRun: {
    cols: [["id", "text"], ["jobTaskId", "text"], ["agent", "text"], ["sopPackVersion", "text"], ["status", "text"], ["attempt", "int"], ["reviewNotes", "text"], ["inputs", "json"], ["inputsPurgeAt", "ts"], ["figures", "json"], ["needsPartnerReview", "bool"], ["error", "text"], ["startedById", "text"], ["startedAt", "ts"], ["finishedAt", "ts"]],
    indexes: [["id"], ["jobTaskId", "startedAt"], ["agent", "startedAt"]],
  },
  ChecklistResult: {
    cols: [["id", "text"], ["agentRunId", "text"], ["ruleId", "text"], ["severity", "text"], ["status", "text"], ["message", "text"], ["evidence", "json"], ["source", "text"], ["createdAt", "ts"]],
    indexes: [["id"], ["agentRunId"]],
  },
  Deliverable: {
    cols: [["id", "text"], ["jobTaskId", "text"], ["agentRunId", "text"], ["kind", "text"], ["name", "text"], ["spPath", "text"], ["driveId", "text"], ["driveItemId", "text"], ["sha256", "text"], ["sizeBytes", "int"], ["version", "int"], ["verifiedAt", "ts"], ["createdAt", "ts"]],
    indexes: [["id"], ["jobTaskId", "kind"]],
  },
  ModelCall: {
    cols: [["id", "text"], ["runId", "text"], ["agent", "text"], ["task", "text"], ["provider", "int"], ["model", "text"], ["tier", "int"], ["privacy", "text"], ["difficulty", "text"], ["escalated", "bool"], ["escalationLevel", "int"], ["anonymized", "bool"], ["status", "int"], ["confidence", "float"], ["tokensIn", "int"], ["tokensOut", "int"], ["costInr", "decimal"], ["latencyMs", "int"], ["promptHash", "text"], ["error", "text"], ["createdAt", "ts"]],
    indexes: [["id"], ["runId"], ["createdAt"], ["agent", "createdAt"]],
  },
  AuditEvent: {
    cols: [["id", "text"], ["actorId", "text"], ["action", "text"], ["entity", "text"], ["entityId", "text"], ["meta", "json"], ["createdAt", "ts"]],
    indexes: [["id"], ["entity", "entityId"], ["actorId", "createdAt"], ["createdAt"]],
  },
  CoachEvent: {
    cols: [["id", "text"], ["userId", "text"], ["kind", "text"], ["jobTaskId", "text"], ["payload", "json"], ["dismissedAt", "ts"], ["dedupeKey", "text"], ["createdAt", "ts"]],
    indexes: [["id"], ["dedupeKey"], ["userId", "createdAt"], ["kind", "createdAt"]],
  },
  ActivityHeartbeat: {
    cols: [["id", "text"], ["userId", "text"], ["at", "ts"], ["source", "text"]],
    indexes: [["id"], ["userId", "at"], ["at"]],
  },
  JobTaskEvent: {
    cols: [["id", "text"], ["jobTaskId", "text"], ["fromState", "int"], ["toState", "int"], ["actorId", "text"], ["note", "text"], ["createdAt", "ts"]],
    indexes: [["id"], ["jobTaskId", "createdAt"]],
  },
};

const CUID = "c".repeat(25);
const align8 = (n: number) => Math.ceil(n / 8) * 8;

/** Heap tuple (28 bytes header + item pointer) plus every index entry (8 bytes header + keys), per row. */
export function rowBytes(table: string, row: Record<string, unknown>): { heap: number; index: number } {
  const t = TABLES[table];
  const filled = { id: CUID, createdAt: new Date(), ...row } as Record<string, unknown>;
  const heap = align8(28 + t.cols.reduce((n, [c, k]) => n + valueBytes(filled[c], k), 0));
  const kindOf = (c: string) => t.cols.find(([n]) => n === c)?.[1] ?? "text";
  const index = t.indexes.reduce((n, keys) => n + align8(8 + keys.reduce((m, k) => m + valueBytes(filled[k], kindOf(k)), 0)) + 4, 0);
  return { heap, index };
}

export type StorageLine = { table: string; sampleRows: number; heapPerRow: number; indexPerRow: number; perYearRows: number; perYearMiB: number; steadyStateNote: string; basis: string };

export function averageRow(table: string, rows: Record<string, unknown>[]): { heap: number; index: number } {
  if (!rows.length) return { heap: 0, index: 0 };
  const sum = rows.reduce<{ heap: number; index: number }>(
    (a, r) => {
      const b = rowBytes(table, r);
      return { heap: a.heap + b.heap, index: a.index + b.index };
    },
    { heap: 0, index: 0 },
  );
  return { heap: Math.round(sum.heap / rows.length), index: Math.round(sum.index / rows.length) };
}

export const mib = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

export type StateCount = { state: JobTaskState; n: number };
