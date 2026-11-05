// In-memory world for close-loop tests: a Prisma-shaped CloseLoopDb over plain arrays, a
// TuriaSyncRepo over the same TuriaSync table (so ManualBridge confirmations are what the gate
// reads), and a fake SharePoint DeliverableVerifier keyed by driveItemId. Nothing is ever removed.
import type { FirmService, JobTaskState, TuriaSyncStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import type { CloseLoopDb, CloseLoopTx, CoachEventData } from "@/lib/close-loop/db";
import type { DeliverableRef, DeliverableVerifier, LiveItem } from "@/lib/close-loop/verifier";
import type { TuriaMode, TuriaOperation } from "@/lib/integrations/turia/adapter";
import type { NewTuriaSync, TuriaEvidence, TuriaSyncPatch, TuriaSyncRecord, TuriaSyncRepo } from "@/lib/integrations/turia/manual-bridge";
import { deliverablePath } from "@/lib/integrations/sharepoint/paths";

export const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");

export type JobRec = {
  id: string;
  state: JobTaskState;
  service: FirmService;
  fy: string;
  period: string;
  title: string;
  ackRef: string | null;
  filedAt: Date | null;
  filedById: string | null;
  doneAt: Date | null;
  assigneeId: string | null;
  reviewerId: string | null;
  firmClientId: string;
  engagementId: string | null;
  updatedAt: Date;
  clientCode: string;
};
export type EventRec = { id: string; jobTaskId: string; fromState: JobTaskState | null; toState: JobTaskState; actorId: string | null; note: string | null; createdAt: Date };
export type DeliverableRec = {
  id: string;
  jobTaskId: string;
  kind: string;
  name: string;
  spPath: string;
  driveId: string | null;
  driveItemId: string | null;
  sha256: string;
  sizeBytes: number;
  verifiedAt: Date | null;
  createdAt: Date;
};
export type SyncRec = TuriaSyncRecord & { spotChecked: boolean };
export type CoachRec = CoachEventData & { id: string; createdAt: Date };
export type AuditRec = { id: string; actorId: string | null; action: string; entity: string; entityId: string | null; meta?: unknown; createdAt: Date };
export type UserRec = { id: string; name: string; managerId: string | null; level: string; active: boolean };

type Where = Record<string, unknown>;

function matchValue(v: unknown, cond: unknown): boolean {
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (typeof cond === "object" && cond) {
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(v);
    if ("gte" in c || "lt" in c) {
      if (!(v instanceof Date)) return false;
      if (c.gte instanceof Date && v.getTime() < c.gte.getTime()) return false;
      if (c.lt instanceof Date && v.getTime() >= c.lt.getTime()) return false;
      return true;
    }
  }
  return v === cond;
}

export function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Where[]).some((w) => matches(row, w));
    return matchValue(row[k], cond);
  });
}

const T0 = new Date("2026-11-02T04:30:00.000Z"); // 10:00 IST Mon

export class CloseLoopWorld {
  jobs: JobRec[] = [];
  events: EventRec[] = [];
  deliverables: DeliverableRec[] = [];
  syncs: SyncRec[] = [];
  coach: CoachRec[] = [];
  audits: AuditRec[] = [];
  users: UserRec[] = [
    { id: "u-priya", name: "Priya Raman", managerId: "u-mgr", level: "EXECUTIVE", active: true },
    { id: "u-ravi", name: "Ravi Kumar", managerId: "u-mgr", level: "SENIOR_EXECUTIVE", active: true },
    { id: "u-mgr", name: "Meena Iyer", managerId: "u-partner", level: "MANAGER", active: true },
    { id: "u-partner", name: "Lakshmanan A", managerId: null, level: "PARTNER", active: true },
  ];
  engagements: { id: string; reviewerId: string | null }[] = [];
  transactions = 0;
  /** Raw queries (the DONE trigger's set_config), with the transaction number they ran in. */
  rawQueries: { sql: string; values: unknown[]; transaction: number }[] = [];
  /** SharePoint as the verifier sees it, keyed by driveItemId. */
  sp = new Map<string, { path: string; bytes: Uint8Array; reportSha?: boolean }>();
  verifierCalls = { getItem: 0, download: 0 };
  verifierError: Error | null = null;
  private seq = 0;
  /** Clock used for createdAt of rows the fake writes. */
  clock: () => Date = () => new Date();

  id(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  // ---------------------------------------------------------------- seeding

  addJob(over: Partial<JobRec> = {}): JobRec {
    const j: JobRec = {
      id: over.id ?? this.id("job"),
      state: "CLOSING",
      service: "GST",
      fy: "2026-27",
      period: "2026-10",
      title: "GSTR-3B",
      ackRef: "AA2710260012345",
      filedAt: T0,
      filedById: "u-priya",
      doneAt: null,
      assigneeId: "u-priya",
      reviewerId: "u-ravi",
      firmClientId: "fc-1",
      engagementId: null,
      updatedAt: T0,
      clientCode: "ACME01",
      ...over,
    };
    this.jobs.push(j);
    return j;
  }

  addEvent(jobTaskId: string, fromState: JobTaskState | null, toState: JobTaskState, at: Date, actorId: string | null = "u-priya", note: string | null = null): EventRec {
    const e = { id: this.id("ev"), jobTaskId, fromState, toState, actorId, note, createdAt: at };
    this.events.push(e);
    return e;
  }

  /** Events for a job that went APPROVED → FILED_BY_HUMAN → CLOSING at `at`. */
  addFiledHistory(jobTaskId: string, at: Date = T0) {
    this.addEvent(jobTaskId, "IN_REVIEW", "APPROVED", new Date(at.getTime() - 3_600_000), "u-ravi");
    this.addEvent(jobTaskId, "APPROVED", "FILED_BY_HUMAN", at, "u-priya", "ack ref AA2710260012345");
    this.addEvent(jobTaskId, "FILED_BY_HUMAN", "CLOSING", new Date(at.getTime() + 1000), "system:close-loop-hook");
  }

  finalFolder(job: JobRec) {
    return deliverablePath(job.clientCode, job.fy, job.service as "GST", job.period as "2026-10", "Final");
  }

  /** A Final deliverable recorded in the DB and (unless `inSharePoint: false`) present live. */
  addFinal(
    job: JobRec,
    opts: { name?: string; content?: string; spPath?: string; inSharePoint?: boolean; livePath?: string; liveBytes?: Uint8Array; reportSha?: boolean; kind?: string; driveItemId?: string | null } = {},
  ): DeliverableRec {
    const name = opts.name ?? "ACME01_GSTR-3B_2026-10_v1.xlsx";
    const content = opts.content ?? "final pack bytes";
    const folder = this.finalFolder(job);
    const d: DeliverableRec = {
      id: this.id("del"),
      jobTaskId: job.id,
      kind: opts.kind ?? "Final",
      name,
      spPath: opts.spPath ?? folder.serverRelativeUrl,
      driveId: "drive-acme",
      driveItemId: opts.driveItemId === undefined ? this.id("item") : opts.driveItemId,
      sha256: sha(content),
      sizeBytes: Buffer.byteLength(content),
      verifiedAt: null,
      createdAt: new Date(T0.getTime() + this.seq),
    };
    this.deliverables.push(d);
    if (opts.inSharePoint !== false && d.driveItemId) {
      this.sp.set(d.driveItemId, { path: opts.livePath ?? `${folder.path}/${name}`, bytes: opts.liveBytes ?? new TextEncoder().encode(content), reportSha: opts.reportSha });
    }
    return d;
  }

  addCloseSync(jobTaskId: string, over: Partial<SyncRec> = {}): SyncRec {
    const s: SyncRec = {
      id: this.id("sync"),
      jobTaskId,
      firmClientId: "fc-1",
      operation: "closeTask",
      mode: "MANUAL",
      status: "CLOSED",
      turiaRef: "TT-4411",
      minutesLogged: 90,
      evidence: { key: `closeTask:${jobTaskId}` },
      confirmedById: "u-priya",
      createdAt: T0,
      updatedAt: T0,
      spotChecked: false,
      ...over,
    };
    this.syncs.push(s);
    return s;
  }

  /** A CLOSING job that passes every gate condition. */
  readyJob(over: Partial<JobRec> = {}) {
    const job = this.addJob(over);
    this.addFiledHistory(job.id);
    const deliverable = this.addFinal(job);
    const sync = this.addCloseSync(job.id);
    return { job, deliverable, sync };
  }

  job(id: string) {
    return this.jobs.find((j) => j.id === id)!;
  }

  /** Someone removed the file in SharePoint (outside Firm OS). */
  loseFile(driveItemId: string) {
    this.sp.delete(driveItemId);
  }

  /** Someone overwrote the file in SharePoint (outside Firm OS). */
  changeFile(driveItemId: string, content: string) {
    const f = this.sp.get(driveItemId);
    if (f) f.bytes = new TextEncoder().encode(content);
  }

  // ---------------------------------------------------------------- Prisma-shaped client

  private jobView(j: JobRec) {
    const engagement = j.engagementId ? this.engagements.find((e) => e.id === j.engagementId) ?? null : null;
    return { ...j, firmClient: { clientCode: j.clientCode }, engagement: engagement ? { reviewerId: engagement.reviewerId } : null };
  }

  readonly tx: CloseLoopTx = {
    jobTask: {
      findUnique: async ({ where }) => {
        const j = this.jobs.find((x) => x.id === where.id);
        return j ? { id: j.id, state: j.state, service: j.service, assigneeId: j.assigneeId, reviewerId: j.reviewerId, ackRef: j.ackRef, updatedAt: j.updatedAt } : null;
      },
      findFirst: async ({ where }) => {
        const j = this.jobs.find((x) => x.id === where.id);
        return j ? this.jobView(j) : null;
      },
      findMany: async ({ where, take }) =>
        this.jobs
          .filter((j) => matches(j as unknown as Record<string, unknown>, where as Where))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, take)
          .map((j) => this.jobView(j)),
      updateMany: async ({ where, data }) => {
        const j = this.jobs.find((x) => x.id === where.id && x.state === where.state && x.updatedAt.getTime() === where.updatedAt.getTime());
        if (!j) return { count: 0 };
        Object.assign(j, data, { updatedAt: new Date(j.updatedAt.getTime() + 1000) });
        return { count: 1 };
      },
    },
    jobTaskEvent: {
      create: async ({ data }) => {
        const e = { id: this.id("ev"), ...data, createdAt: this.clock() };
        this.events.push(e);
        return { id: e.id };
      },
      findMany: (async ({ where }: { where: { jobTaskId: string | { in: string[] }; toState?: string } }) =>
        this.events
          .filter((e) => (typeof where.jobTaskId === "string" ? e.jobTaskId === where.jobTaskId : where.jobTaskId.in.includes(e.jobTaskId)) && (!where.toState || e.toState === where.toState))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) as never,
    },
    agentRun: { findFirst: async () => null },
    checklistResult: { count: async () => 0 },
    deliverable: {
      findMany: (async ({ where }: { where: { jobTaskId: string | { in: string[] }; kind: string } }) =>
        this.deliverables
          .filter((d) => (typeof where.jobTaskId === "string" ? d.jobTaskId === where.jobTaskId : where.jobTaskId.in.includes(d.jobTaskId)) && d.kind === where.kind)
          .map((d) => ({ ...d }))) as never,
      updateMany: async ({ where, data }) => {
        const hit = this.deliverables.filter((d) => where.id.in.includes(d.id));
        hit.forEach((d) => Object.assign(d, data));
        return { count: hit.length };
      },
    },
    turiaSync: {
      findMany: async ({ where }) =>
        this.syncs
          .filter((s) => s.jobTaskId === where.jobTaskId && s.operation === where.operation)
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
          .map((s) => ({ ...s })),
    },
    coachEvent: {
      findFirst: async ({ where }) => {
        const c = this.coach.find((x) => x.userId === where.userId && x.kind === where.kind && x.jobTaskId === where.jobTaskId && x.createdAt.getTime() >= where.createdAt.gte.getTime());
        return c ? { id: c.id } : null;
      },
      create: async ({ data }) => {
        // Like Postgres' unique index on CoachEvent.dedupeKey: the second insert fails with P2002.
        // The await first lets concurrent callers interleave, as two cron runs would.
        await Promise.resolve();
        if (data.dedupeKey && this.coach.some((x) => x.dedupeKey === data.dedupeKey)) {
          throw Object.assign(new Error("Unique constraint failed on the fields: (`dedupeKey`)"), { code: "P2002", meta: { target: ["dedupeKey"] } });
        }
        const c = { id: this.id("coach"), ...data, createdAt: this.clock() };
        this.coach.push(c);
        return { id: c.id };
      },
    },
    auditEvent: {
      create: async ({ data }) => {
        const a = { id: this.id("audit"), ...data, createdAt: this.clock() };
        this.audits.push(a);
        return { id: a.id };
      },
    },
    user: {
      findUnique: async ({ where }) => {
        const u = this.users.find((x) => x.id === where.id);
        return u ? { managerId: u.managerId } : null;
      },
      findMany: async ({ where }) => this.users.filter((u) => u.level === where.level && u.active === where.active).map((u) => ({ id: u.id })),
    },
    // The DONE trigger hook (state-db.ts): records set_config calls with the transaction they ran in.
    $queryRaw: async (q: TemplateStringsArray, ...values: unknown[]) => {
      this.rawQueries.push({ sql: q.join("?"), values, transaction: this.transactions });
      return [{ set_config: values[1] }];
    },
  };

  readonly db: CloseLoopDb = {
    ...this.tx,
    $transaction: async (fn) => {
      this.transactions += 1;
      return fn(this.tx);
    },
  };

  // ---------------------------------------------------------------- Turia repo over the same table

  readonly turiaRepo: TuriaSyncRepo = {
    findByKey: async (key) => {
      const hits = this.syncs.filter((s) => s.evidence?.key === key);
      return hits.length ? hits[hits.length - 1] : null;
    },
    create: async (row: NewTuriaSync) => {
      const at = this.clock();
      const rec: SyncRec = {
        id: this.id("sync"),
        jobTaskId: row.jobTaskId,
        firmClientId: row.firmClientId,
        operation: row.operation as TuriaOperation,
        mode: row.mode as TuriaMode,
        status: row.status as TuriaSyncStatus,
        turiaRef: null,
        minutesLogged: null,
        evidence: row.evidence as TuriaEvidence,
        confirmedById: null,
        createdAt: at,
        updatedAt: at,
        spotChecked: false,
      };
      this.syncs.push(rec);
      return rec;
    },
    get: async (id) => this.syncs.find((s) => s.id === id) ?? null,
    update: async (id, patch: TuriaSyncPatch) => {
      const rec = this.syncs.find((s) => s.id === id);
      if (!rec) throw new Error(`no sync ${id}`);
      Object.assign(rec, patch, { updatedAt: new Date(Math.max(this.clock().getTime(), rec.updatedAt.getTime() + 1000)) });
      return rec;
    },
  };

  // ---------------------------------------------------------------- SharePoint verifier

  readonly verifier: DeliverableVerifier = {
    getItem: async (ref: DeliverableRef): Promise<LiveItem> => {
      this.verifierCalls.getItem += 1;
      if (this.verifierError) throw this.verifierError;
      const f = this.sp.get(ref.driveItemId);
      if (!f) return { exists: false, driveItemId: null, sizeBytes: 0, path: null, sha256: null };
      return { exists: true, driveItemId: ref.driveItemId, sizeBytes: f.bytes.byteLength, path: f.path, sha256: f.reportSha ? sha(f.bytes) : null };
    },
    download: async (ref: DeliverableRef) => {
      this.verifierCalls.download += 1;
      if (this.verifierError) throw this.verifierError;
      return this.sp.get(ref.driveItemId)?.bytes ?? null;
    },
  };
}
