// In-memory stand-in for the Prisma calls the Daily Coach makes (src/lib/agents/coach/db.ts
// CoachDb). Tables hold plain rows; job rows carry their relations (firmClient, engagement, events)
// inline, and `select` is ignored (whole rows come back). Where clauses support equality, null,
// in / notIn / gte / gt / lte / lt / not, AND / OR. CoachEvent.dedupeKey and CoachPreference.userId
// are unique, as in the schema; every call yields to the event loop once so concurrent runs
// interleave like real queries.
import type { FirmService, JobTaskState } from "@prisma/client";
import type { CoachDb } from "@/lib/agents/coach/db";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type Order = Record<string, "asc" | "desc"> | Record<string, "asc" | "desc">[];

const yieldOnce = () => new Promise<void>((r) => queueMicrotask(r));
const isOp = (v: unknown) =>
  !!v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && Object.keys(v).some((k) => ["in", "notIn", "gte", "gt", "lte", "lt", "not", "equals"].includes(k));
const val = (v: unknown) => (v instanceof Date ? v.getTime() : v);

function cond(actual: unknown, c: unknown): boolean {
  if (c === null) return actual === null || actual === undefined;
  if (c instanceof Date) return actual instanceof Date && actual.getTime() === c.getTime();
  if (isOp(c)) {
    const o = c as Record<string, unknown>;
    const a = val(actual) as number;
    if ("equals" in o && !cond(actual, o.equals)) return false;
    if ("in" in o && !(o.in as unknown[]).some((x) => val(x) === a)) return false;
    if ("notIn" in o && (o.notIn as unknown[]).some((x) => val(x) === a)) return false;
    if ("not" in o && cond(actual, o.not)) return false;
    if ("gte" in o && !(actual != null && a >= (val(o.gte) as number))) return false;
    if ("gt" in o && !(actual != null && a > (val(o.gt) as number))) return false;
    if ("lte" in o && !(actual != null && a <= (val(o.lte) as number))) return false;
    if ("lt" in o && !(actual != null && a < (val(o.lt) as number))) return false;
    return true;
  }
  return actual === c;
}

export function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, c]) => {
    if (k === "AND") return (c as Where[]).every((w) => matches(row, w));
    if (k === "OR") return (c as Where[]).some((w) => matches(row, w));
    if (k === "NOT") return !matches(row, c as Where);
    return cond(row[k], c);
  });
}

function sortRows(rows: Row[], orderBy: Order | undefined): Row[] {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).flatMap((o) => Object.entries(o));
  return [...rows].sort((x, y) => {
    for (const [k, dir] of keys) {
      const a = val(x[k]) as number | string;
      const b = val(y[k]) as number | string;
      if (a === b) continue;
      const r = a == null ? 1 : b == null ? -1 : a < b ? -1 : 1;
      return dir === "desc" ? -r : r;
    }
    return 0;
  });
}

export class UniqueError extends Error {
  code = "P2002";
  constructor(field: string) {
    super(`Unique constraint failed on the fields: (\`${field}\`)`);
  }
}

class Table {
  rows: Row[] = [];
  private seq = 0;
  constructor(
    private readonly name: string,
    private readonly clock: () => Date,
    private readonly defaults: () => Row = () => ({}),
    private readonly unique: string[] = [],
  ) {}

  private conflict(data: Row): string | null {
    for (const f of this.unique) if (data[f] != null && this.rows.some((r) => r[f] === data[f])) return f;
    return null;
  }

  insert(data: Row): Row {
    const f = this.conflict(data);
    if (f) throw new UniqueError(f);
    this.seq += 1;
    const row = { id: `${this.name}-${this.seq}`, createdAt: this.clock(), ...this.defaults(), ...data };
    this.rows.push(row);
    return row;
  }

  api() {
    const find = (a: { where?: Where; orderBy?: Order; take?: number } = {}) => {
      const out = sortRows(this.rows.filter((r) => matches(r, a.where)), a.orderBy);
      return (a.take !== undefined ? out.slice(0, a.take) : out).map((r) => ({ ...r }));
    };
    return {
      findMany: async (a?: { where?: Where; orderBy?: Order; take?: number }) => (await yieldOnce(), find(a)),
      findFirst: async (a?: { where?: Where; orderBy?: Order }) => (await yieldOnce(), find({ ...a, take: 1 })[0] ?? null),
      findUnique: async (a: { where: Where }) => (await yieldOnce(), find(a)[0] ?? null),
      count: async (a?: { where?: Where }) => (await yieldOnce(), find(a).length),
      create: async (a: { data: Row }) => (await yieldOnce(), { ...this.insert(a.data) }),
      createMany: async (a: { data: Row[]; skipDuplicates?: boolean }) => {
        await yieldOnce();
        let count = 0;
        for (const d of a.data) {
          if (this.conflict(d) && a.skipDuplicates) continue;
          this.insert(d);
          count += 1;
        }
        return { count };
      },
      update: async (a: { where: Where; data: Row }) => {
        await yieldOnce();
        const row = this.rows.find((r) => matches(r, a.where));
        if (!row) throw Object.assign(new Error(`${this.name}: record to update not found`), { code: "P2025" });
        Object.assign(row, a.data, "updatedAt" in this.defaults() ? { updatedAt: this.clock() } : {});
        return { ...row };
      },
      updateMany: async (a: { where: Where; data: Row }) => {
        await yieldOnce();
        const hit = this.rows.filter((r) => matches(r, a.where));
        for (const r of hit) Object.assign(r, a.data);
        return { count: hit.length };
      },
      upsert: async (a: { where: Where; create: Row; update: Row }) => {
        await yieldOnce();
        const row = this.rows.find((r) => matches(r, a.where));
        if (row) {
          Object.assign(row, a.update, "updatedAt" in this.defaults() ? { updatedAt: this.clock() } : {});
          return { ...row };
        }
        return { ...this.insert(a.create) };
      },
    };
  }
}

export type FakeJob = {
  id: string;
  title: string;
  service: FirmService;
  state: JobTaskState;
  period: string;
  fy: string;
  assigneeId: string | null;
  reviewerId: string | null;
  internalDueOn: Date | null;
  statutoryDueOn: Date | null;
  doneAt: Date | null;
  firmClient: { clientCode: string; client: { name: string } | null };
  engagement: { reviewerId: string | null } | null;
  events: { fromState: JobTaskState | null; toState: JobTaskState; createdAt: Date; note: string | null }[];
};

export class CoachWorld {
  clock: () => Date = () => new Date();
  private readonly now = () => this.clock();
  readonly user = new Table("user", this.now, () => ({ name: null, managerId: null, active: true, level: "EXECUTIVE" }), ["id"]);
  readonly jobTask = new Table("job", this.now);
  readonly agentRun = new Table("run", this.now);
  readonly coachEvent = new Table("coach", this.now, () => ({ jobTaskId: null, payload: null, dismissedAt: null, dedupeKey: null }), ["dedupeKey"]);
  readonly coachPreference = new Table("pref", this.now, () => ({ breakNudges: true, snoozeUntil: null, morningBoard: true, updatedAt: this.clock() }), ["userId"]);
  readonly activityHeartbeat = new Table("beat", this.now, () => ({ at: this.clock(), source: "lms" }));
  readonly auditEvent = new Table("audit", this.now, () => ({ entityId: null, meta: null }));

  readonly db = {
    user: this.user.api(),
    jobTask: this.jobTask.api(),
    agentRun: this.agentRun.api(),
    coachEvent: this.coachEvent.api(),
    coachPreference: this.coachPreference.api(),
    activityHeartbeat: this.activityHeartbeat.api(),
    auditEvent: this.auditEvent.api(),
  } as unknown as CoachDb;

  private jobSeq = 0;

  addUser(id: string, over: Row = {}): Row {
    return this.user.insert({ id, name: id.replace(/^u-/, "").replace(/^./, (c) => c.toUpperCase()), email: `${id}@indefine.test`, ...over });
  }

  addJob(over: Partial<FakeJob> = {}): FakeJob {
    this.jobSeq += 1;
    const job: FakeJob = {
      id: `job-${String(this.jobSeq).padStart(3, "0")}`,
      title: "GSTR-3B",
      service: "GST",
      state: "IN_PREP",
      period: "2026-10",
      fy: "2026-27",
      assigneeId: "u-priya",
      reviewerId: "u-ravi",
      internalDueOn: null,
      statutoryDueOn: null,
      doneAt: null,
      firmClient: { clientCode: "ACME01", client: { name: "Acme Traders" } },
      engagement: { reviewerId: null },
      events: [],
      ...over,
    };
    this.jobTask.rows.push(job as unknown as Row);
    return job;
  }

  addRun(jobTaskId: string, agent: string, startedAt: Date): Row {
    return this.agentRun.insert({ jobTaskId, agent, startedAt });
  }

  events(kind?: string): Row[] {
    return this.coachEvent.rows.filter((e) => !kind || e.kind === kind);
  }
}
