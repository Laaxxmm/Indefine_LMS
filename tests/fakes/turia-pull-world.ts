// In-memory world for the Turia pull tests: a Prisma-shaped database (only the calls the sync and
// the admin saves make), a fake Turia reader built from pages of raw task/list rows, and a clock.
// Nothing here ever removes a row: the fake has no delete method, like the code it serves.
import { Prisma } from "@prisma/client";
import type { PullDb, PullDeps } from "@/lib/integrations/turia/pull/sync";
import type { TuriaAdminDb } from "@/lib/integrations/turia/pull/admin";
import type { TuriaReader, TuriaUser } from "@/lib/integrations/turia/pull/read-client";
import { TuriaSessionError } from "@/lib/neo-centra/turia";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const isPlain = (v: unknown): v is Row => !!v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v);
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
const cmp = (a: unknown, b: unknown) => {
  const x = a instanceof Date ? a.getTime() : (a as number | string);
  const y = b instanceof Date ? b.getTime() : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
};

function matchField(value: unknown, cond: unknown): boolean {
  if (!isPlain(cond)) return cond === null ? value == null : same(value, cond);
  for (const [op, arg] of Object.entries(cond)) {
    if (op === "in" && !(arg as unknown[]).some((a) => same(value, a))) return false;
    if (op === "not" && (arg === null ? value == null : same(value, arg))) return false;
    if (op === "equals" && !same(value, arg)) return false;
    if (op === "lt" && !(value != null && cmp(value, arg) < 0)) return false;
    if (op === "lte" && !(value != null && cmp(value, arg) <= 0)) return false;
    if (op === "gt" && !(value != null && cmp(value, arg) > 0)) return false;
    if (op === "gte" && !(value != null && cmp(value, arg) >= 0)) return false;
  }
  return true;
}

/** Compound unique keys (`firmClientId_service: { … }`) become their fields. */
function flatten(where: Where = {}): Where {
  const out: Where = {};
  for (const [k, v] of Object.entries(where)) {
    if (k.includes("_") && isPlain(v) && !Object.keys(v).some((x) => ["in", "not", "lt", "lte", "gt", "gte", "equals"].includes(x))) Object.assign(out, v);
    else out[k] = v;
  }
  return out;
}

export function matches(row: Row, where: Where = {}): boolean {
  for (const [k, cond] of Object.entries(flatten(where))) {
    if (k === "OR") {
      if (!(cond as Where[]).some((w) => matches(row, w))) return false;
    } else if (k === "AND") {
      if (!(cond as Where[]).every((w) => matches(row, w))) return false;
    } else if (!matchField(row[k], cond)) return false;
  }
  return true;
}

function order(rows: Row[], orderBy: unknown): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, "asc" | "desc">[];
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const [f, dir] = Object.entries(k)[0];
      const c = cmp(a[f] ?? "", b[f] ?? "");
      if (c) return dir === "desc" ? -c : c;
    }
    return 0;
  });
}

const unique = () => new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });

type ModelOptions = {
  id?: string;
  defaults?: () => Row;
  uniques?: string[][];
  /** Joins added to every returned row (client.firmClient). */
  join?: (row: Row) => Row;
  nested?: (row: Row, data: Row) => void;
};

export class FakeModel {
  readonly rows: Row[] = [];
  private seq = 0;
  constructor(
    private readonly name: string,
    private readonly opts: ModelOptions = {},
    private readonly clock: () => Date,
  ) {}

  private out(r: Row): Row {
    return this.opts.join ? { ...r, ...this.opts.join(r) } : { ...r };
  }
  private checkUnique(candidate: Row, self?: Row) {
    for (const fields of [[this.opts.id ?? "id"], ...(this.opts.uniques ?? [])]) {
      if (fields.some((f) => candidate[f] == null)) continue;
      if (this.rows.some((r) => r !== self && fields.every((f) => same(r[f], candidate[f])))) throw unique();
    }
  }
  private clean(data: Row): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(data)) if (v !== undefined && !(isPlain(v) && ("create" in v || "connect" in v))) out[k] = v;
    return out;
  }

  async findMany(args: { where?: Where; orderBy?: unknown; take?: number } = {}) {
    const hits = order(this.rows.filter((r) => matches(r, args.where)), args.orderBy);
    return (args.take ? hits.slice(0, args.take) : hits).map((r) => this.out(r));
  }
  async findUnique(args: { where: Where }) {
    const r = this.rows.find((x) => matches(x, args.where));
    return r ? this.out(r) : null;
  }
  async findFirst(args: { where?: Where; orderBy?: unknown } = {}) {
    return (await this.findMany({ ...args, take: 1 }))[0] ?? null;
  }
  async count(args: { where?: Where } = {}) {
    return this.rows.filter((r) => matches(r, args.where)).length;
  }
  async create(args: { data: Row }) {
    const now = this.clock();
    const idKey = this.opts.id ?? "id";
    const row: Row = { createdAt: now, updatedAt: now, ...this.opts.defaults?.(), ...this.clean(args.data) };
    if (row[idKey] == null) row[idKey] = `${this.name}-${++this.seq}`;
    this.checkUnique(row);
    this.rows.push(row);
    this.opts.nested?.(row, args.data);
    return this.out(row);
  }
  async createMany(args: { data: Row[]; skipDuplicates?: boolean }) {
    let count = 0;
    for (const d of args.data) {
      try {
        await this.create({ data: d });
        count++;
      } catch (e) {
        if (!args.skipDuplicates) throw e;
      }
    }
    return { count };
  }
  async update(args: { where: Where; data: Row }) {
    const r = this.rows.find((x) => matches(x, args.where));
    if (!r) throw new Prisma.PrismaClientKnownRequestError("Record to update not found", { code: "P2025", clientVersion: "test" });
    const next = { ...r, ...this.clean(args.data), updatedAt: this.clock() };
    this.checkUnique(next, r);
    Object.assign(r, next);
    return this.out(r);
  }
  async updateMany(args: { where?: Where; data: Row }) {
    const hits = this.rows.filter((r) => matches(r, args.where));
    for (const r of hits) Object.assign(r, this.clean(args.data), { updatedAt: this.clock() });
    return { count: hits.length };
  }
  async upsert(args: { where: Where; create: Row; update: Row }) {
    const r = this.rows.find((x) => matches(x, args.where));
    return r ? this.update({ where: args.where, data: args.update }) : this.create({ data: args.create });
  }
}

export type RawTask = Record<string, unknown>;

export class FakeTuria implements TuriaReader {
  pages: RawTask[][] = [];
  users: TuriaUser[] = [];
  minutes = new Map<string, number | null>();
  sessionExpired = false;
  readonly calls: string[] = [];

  private check() {
    if (this.sessionExpired) throw new TuriaSessionError("Turia session expired. Refresh the Turia cookie.");
  }
  async taskPage(page: number, perPage: number, sort: string) {
    this.calls.push(`task/list p${page} n${perPage} ${sort}`);
    this.check();
    return this.pages[page - 1] ?? [];
  }
  async orgUsers() {
    this.calls.push("utilities/organizationUserListNew");
    this.check();
    return this.users;
  }
  async taskMinutes(taskId: string) {
    this.calls.push(`timesheet/list ${taskId}`);
    this.check();
    return this.minutes.get(taskId) ?? null;
  }
}

/** A raw task/list row the way Turia sends it (field names as Neo Centra reads them). */
export function rawTask(over: Partial<RawTask> & { id: string }): RawTask {
  return {
    uniqueidentity: `#TSK${over.id.padStart(5, "0")}`,
    taskname: "GSTR-3B Oct 2026",
    clientname: "Acme Traders Pvt Ltd",
    taskstatus: "1",
    targetduedate: Date.UTC(2026, 10, 18, 6, 30),
    createdon: Date.UTC(2026, 9, 1),
    assignee: [{ id: "t-priya", name: "Priya S" }],
    reviewer: [{ id: "t-ravi", name: "Ravi K" }],
    description: "Client's private notes that must never be stored",
    comments: [{ text: "call the client" }],
    ...over,
  };
}

export function createPullWorld(start = new Date("2026-11-06T05:30:00Z")) {
  let now = start;
  const clock = () => now;
  const m = (name: string, opts: ModelOptions = {}) => new FakeModel(name, opts, clock);
  const firmClient = m("fc", { uniques: [["lmsClientId"], ["clientCode"]] });
  const jobTaskEvent = m("ev");
  const db = {
    turiaTaskMirror: m("mirror"),
    turiaPersonLink: m("person", { id: "turiaUserId" }),
    turiaClientLink: m("clientLink", { id: "key" }),
    turiaTaskRule: m("rule", { defaults: () => ({ active: true, useAgent: true, seeded: false, department: null, calendarRuleId: null, updatedById: null }) }),
    turiaPullRun: m("run", { defaults: () => ({ complete: false, counts: null, preview: null, message: null, finishedAt: null }) }),
    turiaPullLock: m("lock", { defaults: () => ({ holder: null, lockUntil: null }) }),
    jobTask: m("job", {
      uniques: [["turiaTaskId"], ["firmClientId", "service", "fy", "period", "title"]],
      defaults: () => ({ state: "DRAFT", agentless: false, source: null, turiaTaskId: null, turiaMissingAt: null, turiaNote: null, engagementId: null, assigneeId: null, reviewerId: null, internalDueOn: null, statutoryDueOn: null }),
      nested: (row, data) => {
        const ev = (data.events as { create?: Row } | undefined)?.create;
        if (ev) void jobTaskEvent.create({ data: { ...ev, jobTaskId: row.id } });
      },
    }),
    jobTaskEvent,
    engagement: m("eng", { uniques: [["firmClientId", "service"]] }),
    firmClient,
    client: m("client", {
      join: (r) => {
        const fc = firmClient.rows.find((f) => f.lmsClientId === r.id);
        return { firmClient: fc ? { id: fc.id, clientCode: fc.clientCode } : null };
      },
    }),
    user: m("user"),
    turiaSync: m("sync", { defaults: () => ({ spotChecked: false, confirmedById: null }) }),
    auditEvent: m("audit"),
    /** No published SOP pack: the statutory calendar falls back to the built-in one. */
    sopPack: m("sop"),
  };
  const turia = new FakeTuria();
  const env: Record<string, string | undefined> = { FIRM_OS_ENABLED: "true", FIRM_OS_TURIA_PULL: "on" };
  const deps = (over: Partial<PullDeps> = {}): PullDeps => ({
    db: db as unknown as PullDb,
    reader: turia,
    session: async () => ({ present: true, updatedAt: clock() }),
    env,
    now: clock,
    sleep: async () => undefined,
    ...over,
  });
  return {
    db,
    adminDb: db as unknown as TuriaAdminDb,
    turia,
    env,
    deps,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    setNow: (d: Date) => {
      now = d;
    },
    /** Users, an LMS client with a Firm OS client, and one without. */
    seedFirm() {
      db.user.rows.push(
        { id: "u-priya", name: "Priya S", email: "priya@indefine.test", active: true },
        { id: "u-ravi", name: "Ravi K", email: "ravi@indefine.test", active: true },
        { id: "u-old", name: "Old Staff", email: "old@indefine.test", active: false },
      );
      db.client.rows.push({ id: "c-acme", name: "Acme Traders Private Limited" }, { id: "c-beta", name: "Beta Foods LLP" });
      firmClient.rows.push({ id: "fc-acme", lmsClientId: "c-acme", clientCode: "ACME" });
      turia.users = [
        { id: "t-priya", name: "Priya Subramanian", email: "PRIYA@indefine.test" },
        { id: "t-ravi", name: "Ravi K", email: null },
      ];
    },
  };
}

export type PullWorld = ReturnType<typeof createPullWorld>;
