// Test fake for the corrections and privacy modules: an in-memory stand-in for the Prisma client
// with any model name, the subset of the query API those modules call (findUnique / findFirst /
// findMany / count / create / update / updateMany, `where` with equality, equals + mode, in, not,
// lt/lte/gt/gte, contains, OR/AND/NOT, flat `select`, `orderBy`, `take`), unique constraints and
// `$transaction(fn)` with rollback on throw.
//
// Every call is recorded in `calls` as "model.method". The fake implements no method that removes
// a row; any other method name is recorded and then throws, so a test can assert both that nothing
// tried to remove data and that nothing unexpected ran.
type Row = Record<string, unknown>;

const UNIQUES: Record<string, string[][]> = {
  client: [["name"], ["folderName"], ["pan"]],
  firmClient: [["clientCode"], ["lmsClientId"]],
  user: [["email"]],
  jobTask: [["firmClientId", "service", "fy", "period", "title"]],
  engagement: [["firmClientId", "service"]],
};
const UPDATED_AT = new Set(["client", "firmClient", "jobTask", "engagement", "privacyRequest", "breachIncident", "onboardingRun", "user", "turiaSync"]);
const SUPPORTED = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findMany", "count", "create", "update", "updateMany"]);

const clone = <T>(v: T): T => structuredClone(v);
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);

function cmp(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

export class FakeUniqueError extends Error {
  readonly code = "P2002";
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    if (key === "OR") {
      if (!(cond as Row[]).some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "AND") {
      if (!(cond as Row[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key === "NOT") {
      if (matches(row, cond as Row)) return false;
      continue;
    }
    const v = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      const ci = c.mode === "insensitive";
      const eq = (a: unknown, b: unknown) => (ci ? same(lower(a), lower(b)) : same(a, b));
      if ("equals" in c && !eq(v, c.equals)) return false;
      if ("in" in c && !(c.in as unknown[]).some((x) => eq(x, v))) return false;
      if ("not" in c && eq(v, c.not)) return false;
      if ("lt" in c && !(v != null && cmp(v, c.lt) < 0)) return false;
      if ("lte" in c && !(v != null && cmp(v, c.lte) <= 0)) return false;
      if ("gt" in c && !(v != null && cmp(v, c.gt) > 0)) return false;
      if ("gte" in c && !(v != null && cmp(v, c.gte) >= 0)) return false;
      if ("contains" in c && !(typeof v === "string" && (ci ? v.toLowerCase().includes(String(c.contains).toLowerCase()) : v.includes(String(c.contains))))) return false;
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

function pick(row: Row, select: Row | undefined): Row {
  if (!select) return clone(row);
  const out: Row = {};
  for (const [k, on] of Object.entries(select)) if (on) out[k] = clone(row[k] ?? null);
  return out;
}

export interface MemoryDb {
  /** Live table contents. */
  tables: Record<string, Row[]>;
  /** "model.method" for every call, in order. */
  calls: string[];
  seed(model: string, rows: Row[]): Row[];
  [model: string]: unknown;
}

export function createMemoryDb(opts: { now?: () => Date } = {}): MemoryDb {
  const now = opts.now ?? (() => new Date());
  let seq = 0;
  let tables: Record<string, Row[]> = {};
  const calls: string[] = [];
  const table = (m: string) => (tables[m] ??= []);

  function checkUnique(model: string, row: Row, ignore?: Row) {
    for (const fields of UNIQUES[model] ?? []) {
      const clash = table(model).some((x) => x !== ignore && fields.every((f) => row[f] !== null && row[f] !== undefined && same(x[f], row[f])));
      if (clash) throw new FakeUniqueError(`Unique constraint failed on ${model} (${fields.join(", ")})`);
    }
  }

  function insert(model: string, data: Row): Row {
    const t = now();
    const row: Row = { id: `${model}-${++seq}`, createdAt: t, ...(UPDATED_AT.has(model) ? { updatedAt: t } : {}) };
    for (const [k, v] of Object.entries(data)) if (v !== undefined) row[k] = clone(v);
    checkUnique(model, row);
    table(model).push(row);
    return row;
  }

  function apply(model: string, row: Row, data: Row) {
    const next = { ...row };
    for (const [k, v] of Object.entries(data)) if (v !== undefined) next[k] = clone(v);
    if (UPDATED_AT.has(model)) next.updatedAt = now();
    checkUnique(model, next, row);
    Object.assign(row, next);
  }

  type Args = { where?: Row; data?: Row; select?: Row; orderBy?: unknown; take?: number };
  const ops: Record<string, (model: string, a: Args) => unknown> = {
    findUnique: (m, a) => {
      const r = table(m).find((x) => matches(x, a.where));
      return r ? pick(r, a.select) : null;
    },
    findUniqueOrThrow: (m, a) => {
      const r = table(m).find((x) => matches(x, a.where));
      if (!r) throw new Error(`${m} not found`);
      return pick(r, a.select);
    },
    findFirst: (m, a) => {
      const r = sort(table(m).filter((x) => matches(x, a.where)), a.orderBy)[0];
      return r ? pick(r, a.select) : null;
    },
    findMany: (m, a) => {
      let rows = sort(table(m).filter((x) => matches(x, a.where)), a.orderBy);
      if (a.take !== undefined) rows = rows.slice(0, a.take);
      return rows.map((r) => pick(r, a.select));
    },
    count: (m, a) => table(m).filter((x) => matches(x, a.where)).length,
    create: (m, a) => pick(insert(m, a.data ?? {}), a.select),
    update: (m, a) => {
      const r = table(m).find((x) => matches(x, a.where));
      if (!r) throw new Error(`${m} to update not found`);
      apply(m, r, a.data ?? {});
      return pick(r, a.select);
    },
    updateMany: (m, a) => {
      const rows = table(m).filter((x) => matches(x, a.where));
      for (const r of rows) apply(m, r, a.data ?? {});
      return { count: rows.length };
    },
  };

  const delegates = new Map<string, unknown>();
  function delegate(model: string) {
    if (!delegates.has(model)) {
      delegates.set(
        model,
        new Proxy(
          {},
          {
            get: (_t, method) => {
              if (typeof method !== "string" || method === "then") return undefined;
              return async (args: Args = {}) => {
                calls.push(`${model}.${method}`);
                if (!SUPPORTED.has(method)) throw new Error(`memory-db: ${model}.${method} is not supported`);
                return ops[method](model, args);
              };
            },
          },
        ),
      );
    }
    return delegates.get(model);
  }

  let depth = 0;
  const db: MemoryDb = new Proxy({} as MemoryDb, {
    get: (_t, key) => {
      if (typeof key !== "string" || key === "then") return undefined;
      if (key === "tables") return tables;
      if (key === "calls") return calls;
      if (key === "seed") return (model: string, rows: Row[]) => rows.map((r) => insert(model, r));
      if (key === "$transaction") {
        return async (arg: unknown) => {
          calls.push("$transaction");
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
        };
      }
      if (key.startsWith("$")) return async () => undefined;
      return delegate(key);
    },
  });
  return db;
}

/** True when any recorded call could remove data (a method name with delete / remove / purge / destroy / drop / truncate). */
export function removalCalls(calls: readonly string[]): string[] {
  return calls.filter((c) => /(delete|remove|purge|destroy|drop|truncate)/i.test(c.split(".")[1] ?? ""));
}
