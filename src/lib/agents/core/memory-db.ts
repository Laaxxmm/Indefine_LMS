// In-memory stand-in for the Firm OS tables the agent framework touches (JobTask, AgentRun,
// ChecklistResult, Deliverable, MistakeLog, SopPack, ...). The accuracy harness runs agents
// against it (no database, fully deterministic) and the framework tests use it as their fake.
// It implements the small subset of the Prisma client API the framework calls: findUnique /
// findFirst / findMany / count / create / createMany / update / updateMany, `where` with
// equality, in, not, lt/lte/gt/gte, OR/AND and to-one relation filters, `select` / `include`
// (nested through the relations below), `orderBy`, `take`, compound uniques, and
// `$transaction(fn)` with rollback on throw. There is deliberately no way to remove a row.
import type { FirmDb } from "./runner";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Relation = { kind: "one" | "many"; model: string; local: string; foreign: string };

const one = (model: string, local: string, foreign = "id"): Relation => ({ kind: "one", model, local, foreign });
const many = (model: string, foreign: string, local = "id"): Relation => ({ kind: "many", model, local, foreign });

/** Relation fields, as named in prisma/schema.prisma. */
const RELATIONS: Record<string, Record<string, Relation>> = {
  firmClient: { client: one("client", "lmsClientId"), jobTasks: many("jobTask", "firmClientId") },
  client: {},
  user: {},
  jobTask: {
    firmClient: one("firmClient", "firmClientId"),
    events: many("jobTaskEvent", "jobTaskId"),
    agentRuns: many("agentRun", "jobTaskId"),
    deliverables: many("deliverable", "jobTaskId"),
  },
  jobTaskEvent: { jobTask: one("jobTask", "jobTaskId") },
  agentRun: { jobTask: one("jobTask", "jobTaskId"), checklist: many("checklistResult", "agentRunId"), deliverables: many("deliverable", "agentRunId") },
  checklistResult: { agentRun: one("agentRun", "agentRunId") },
  deliverable: { jobTask: one("jobTask", "jobTaskId"), agentRun: one("agentRun", "agentRunId") },
  mistakeLog: {},
  sopPack: {},
  auditEvent: {},
};

/** Column defaults applied on create (besides id / createdAt / updatedAt). */
const DEFAULTS: Record<string, (now: Date) => Row> = {
  jobTask: () => ({ state: "DRAFT", needsPartnerReview: false, assigneeId: null, reviewerId: null, ackRef: null, filedAt: null, filedById: null, doneAt: null }),
  agentRun: (now) => ({ attempt: 1, needsPartnerReview: false, startedAt: now, finishedAt: null, error: null, reviewNotes: null, figures: null, inputs: null, inputsPurgeAt: null, startedById: null }),
  mistakeLog: () => ({ status: "PROPOSED", decidedById: null, decidedAt: null, promotedToVersion: null, agentRunId: null, example: null }),
  sopPack: () => ({ patch: 0, active: true, bufferDays: 3, calendar: null, createdById: null, approvedById: null, changeNote: null }),
  deliverable: () => ({ version: 1, verifiedAt: null, driveId: null, driveItemId: null, agentRunId: null }),
  checklistResult: () => ({ evidence: null }),
};

const UNIQUES: Record<string, string[][]> = {
  sopPack: [["key", "version"]],
  firmClient: [["clientCode"], ["lmsClientId"]],
};

const UPDATED_AT = new Set(["jobTask", "firmClient", "user", "client"]);

const clone = <T>(v: T): T => structuredClone(v);
/** Prisma.DbNull / Prisma.JsonNull sentinels are stored as plain null. */
const stored = (v: unknown) => (v !== null && typeof v === "object" && /^(DbNull|JsonNull|AnyNull)$/.test(v.constructor?.name ?? "") ? null : clone(v));

function cmp(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);

export class UniqueConstraintError extends Error {
  readonly code = "P2002";
  constructor(model: string, fields: string[]) {
    super(`Unique constraint failed on ${model} (${fields.join(", ")})`);
    this.name = "UniqueConstraintError";
  }
}

export type MemoryDb = FirmDb & {
  /** Raw table contents (live arrays; tests read them, never mutate them). */
  readonly tables: Tables;
  /** Insert rows directly, with defaults (seeding). */
  seed(model: string, rows: Row[]): void;
};

export function createMemoryDb(opts: { now?: () => Date; ids?: () => string } = {}): MemoryDb {
  const now = opts.now ?? (() => new Date());
  let seq = 0;
  const ids = opts.ids ?? (() => `mem-${++seq}`);
  let tables: Tables = Object.fromEntries(Object.keys(RELATIONS).map((k) => [k, []]));

  const rel = (model: string, field: string) => RELATIONS[model]?.[field];

  function related(model: string, row: Row, r: Relation): Row[] {
    return tables[r.model].filter((x) => same(x[r.foreign], row[r.local]));
  }

  function matches(model: string, row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === "OR") {
        if (!(cond as Row[]).some((w) => matches(model, row, w))) return false;
        continue;
      }
      if (key === "AND") {
        if (!(cond as Row[]).every((w) => matches(model, row, w))) return false;
        continue;
      }
      if (key === "NOT") {
        if (matches(model, row, cond as Row)) return false;
        continue;
      }
      const r = rel(model, key);
      if (r) {
        const targets = related(model, row, r);
        const c = cond as Row;
        if (r.kind === "one") {
          if (cond === null ? targets.length > 0 : !targets.some((t) => matches(r.model, t, c))) return false;
        } else if (c.some) {
          if (!targets.some((t) => matches(r.model, t, c.some as Row))) return false;
        } else if (c.none) {
          if (targets.some((t) => matches(r.model, t, c.none as Row))) return false;
        }
        continue;
      }
      const v = row[key];
      if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
        const c = cond as Row;
        if ("equals" in c && !same(v, c.equals)) return false;
        if ("in" in c && !(c.in as unknown[]).some((x) => same(x, v))) return false;
        if ("notIn" in c && (c.notIn as unknown[]).some((x) => same(x, v))) return false;
        if ("not" in c && same(v, c.not)) return false;
        if ("lt" in c && !(v !== null && v !== undefined && cmp(v, c.lt) < 0)) return false;
        if ("lte" in c && !(v !== null && v !== undefined && cmp(v, c.lte) <= 0)) return false;
        if ("gt" in c && !(v !== null && v !== undefined && cmp(v, c.gt) > 0)) return false;
        if ("gte" in c && !(v !== null && v !== undefined && cmp(v, c.gte) >= 0)) return false;
        if ("contains" in c && !(typeof v === "string" && v.toLowerCase().includes(String(c.contains).toLowerCase()))) return false;
        continue;
      }
      if (!same(v ?? null, cond)) return false;
    }
    return true;
  }

  function sort(rows: Row[], orderBy: unknown): Row[] {
    if (!orderBy) return rows;
    const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, "asc" | "desc">[];
    return [...rows].sort((a, b) => {
      for (const k of keys) {
        const [field, dir] = Object.entries(k)[0];
        const c = cmp(a[field], b[field]);
        if (c !== 0) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  }

  type Shape = { select?: Row; include?: Row };

  function shape(model: string, row: Row, args: Shape): Row {
    const pickRelation = (field: string, spec: unknown): unknown => {
      const r = rel(model, field)!;
      const sub = (spec === true ? {} : spec) as Shape & { where?: Row; orderBy?: unknown; take?: number };
      if (r.kind === "one") {
        const t = related(model, row, r)[0];
        return t ? shape(r.model, t, sub) : null;
      }
      let list = related(model, row, r).filter((t) => matches(r.model, t, sub.where));
      list = sort(list, sub.orderBy);
      if (sub.take !== undefined) list = list.slice(0, sub.take);
      return list.map((t) => shape(r.model, t, sub));
    };
    if (args.select) {
      const out: Row = {};
      for (const [field, spec] of Object.entries(args.select)) {
        if (!spec) continue;
        if (field === "_count") {
          const counts: Row = {};
          for (const [cf] of Object.entries((spec as { select: Row }).select)) counts[cf] = related(model, row, rel(model, cf)!).length;
          out._count = counts;
        } else out[field] = rel(model, field) ? pickRelation(field, spec) : clone(row[field]);
      }
      return out;
    }
    const out = clone(row);
    for (const [field, spec] of Object.entries(args.include ?? {})) if (spec) out[field] = pickRelation(field, spec);
    return out;
  }

  function checkUnique(model: string, row: Row, ignore?: Row) {
    for (const fields of UNIQUES[model] ?? []) {
      if (tables[model].some((x) => x !== ignore && fields.every((f) => same(x[f], row[f]) && row[f] !== null && row[f] !== undefined))) {
        throw new UniqueConstraintError(model, fields);
      }
    }
  }

  function insert(model: string, data: Row): Row {
    const t = now();
    const row: Row = { id: ids(), createdAt: t, ...(UPDATED_AT.has(model) ? { updatedAt: t } : {}), ...(DEFAULTS[model]?.(t) ?? {}) };
    for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = stored(v);
    checkUnique(model, row);
    tables[model].push(row);
    return row;
  }

  function applyUpdate(model: string, row: Row, data: Row) {
    const next = { ...row };
    for (const [k, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (v !== null && typeof v === "object" && !(v instanceof Date) && "increment" in (v as Row)) next[k] = (row[k] as number) + Number((v as Row).increment);
      else next[k] = stored(v);
    }
    if (UPDATED_AT.has(model) && !("updatedAt" in data)) next.updatedAt = new Date(Math.max(now().getTime(), (row.updatedAt as Date).getTime() + 1));
    checkUnique(model, next, row);
    Object.assign(row, next);
  }

  function uniqueWhere(model: string, where: Row): Row | undefined {
    return tables[model].find((r) => matches(model, r, where));
  }

  function delegate(model: string) {
    return {
      async findUnique(args: Shape & { where: Row }) {
        const r = uniqueWhere(model, args.where);
        return r ? shape(model, r, args) : null;
      },
      async findUniqueOrThrow(args: Shape & { where: Row }) {
        const r = uniqueWhere(model, args.where);
        if (!r) throw new Error(`${model} not found`);
        return shape(model, r, args);
      },
      async findFirst(args: Shape & { where?: Row; orderBy?: unknown } = {}) {
        const r = sort(tables[model].filter((x) => matches(model, x, args.where)), args.orderBy)[0];
        return r ? shape(model, r, args) : null;
      },
      async findMany(args: Shape & { where?: Row; orderBy?: unknown; take?: number; skip?: number } = {}) {
        let rows = sort(tables[model].filter((x) => matches(model, x, args.where)), args.orderBy);
        if (args.skip) rows = rows.slice(args.skip);
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows.map((r) => shape(model, r, args));
      },
      async count(args: { where?: Row } = {}) {
        return tables[model].filter((x) => matches(model, x, args.where)).length;
      },
      async create(args: Shape & { data: Row }) {
        return shape(model, insert(model, args.data), args);
      },
      async createMany(args: { data: Row[] }) {
        for (const d of args.data) insert(model, d);
        return { count: args.data.length };
      },
      async update(args: Shape & { where: Row; data: Row }) {
        const r = uniqueWhere(model, args.where);
        if (!r) throw new Error(`${model} to update not found`);
        applyUpdate(model, r, args.data);
        return shape(model, r, args);
      },
      async updateMany(args: { where?: Row; data: Row }) {
        const rows = tables[model].filter((x) => matches(model, x, args.where));
        for (const r of rows) applyUpdate(model, r, args.data);
        return { count: rows.length };
      },
    };
  }

  const delegates = Object.fromEntries(Object.keys(RELATIONS).map((m) => [m, delegate(m)]));
  let depth = 0;

  const db = {
    ...delegates,
    get tables() {
      return tables;
    },
    seed(model: string, rows: Row[]) {
      for (const r of rows) insert(model, r);
    },
    async $transaction(arg: unknown) {
      if (Array.isArray(arg)) return Promise.all(arg);
      if (depth > 0) return (arg as (tx: unknown) => Promise<unknown>)(db);
      const snapshot = clone(tables);
      depth += 1;
      try {
        return await (arg as (tx: unknown) => Promise<unknown>)(db);
      } catch (e) {
        tables = snapshot;
        throw e;
      } finally {
        depth -= 1;
      }
    },
  };
  return db as unknown as MemoryDb;
}
