// An in-memory CoachEvent table that enforces `dedupeKey @unique` the way Postgres + Prisma do
// (prisma/schema.prisma, migration of b1c331c): a second create with the same key throws a P2002
// error; createMany({ skipDuplicates: true }) skips it; upsert on { dedupeKey } is idempotent.
// Used by the after-merge chaos tests (concurrent cron firing) so "no duplicate CoachEvents" is
// checked against storage semantics, not against the code's own bookkeeping.
export type CoachEventRow = {
  id: string;
  userId: string;
  kind: string;
  jobTaskId: string | null;
  payload: unknown;
  dismissedAt: Date | null;
  dedupeKey: string | null;
  createdAt: Date;
};

type Data = Partial<CoachEventRow> & { userId: string; kind: string };
type Where = Record<string, unknown>;

export class PrismaUniqueError extends Error {
  readonly code = "P2002";
  readonly meta = { target: ["dedupeKey"] };
  constructor() {
    super("Unique constraint failed on the fields: (`dedupeKey`)");
    this.name = "PrismaClientKnownRequestError";
  }
}

function matchOne(v: unknown, cond: unknown): boolean {
  if (cond === undefined) return true;
  if (cond === null) return v === null || v === undefined;
  if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
  if (typeof cond === "object") {
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(v);
    if ("not" in c) return !matchOne(v, c.not);
    const t = v instanceof Date ? v.getTime() : (v as number);
    const n = (x: unknown) => (x instanceof Date ? x.getTime() : (x as number));
    if ("gte" in c && !(t >= n(c.gte))) return false;
    if ("gt" in c && !(t > n(c.gt))) return false;
    if ("lte" in c && !(t <= n(c.lte))) return false;
    if ("lt" in c && !(t < n(c.lt))) return false;
    return true;
  }
  return v === cond;
}

/** Prisma-style `where` over a plain row: equality, in, not, lt/lte/gt/gte, OR/AND. */
export const matchesWhere = (row: object, where: Where = {}): boolean =>
  Object.entries(where).every(([k, cond]) => {
    if (k === "OR") return (cond as Where[]).some((w) => matchesWhere(row, w));
    if (k === "AND") return (cond as Where[]).every((w) => matchesWhere(row, w));
    return matchOne((row as Record<string, unknown>)[k], cond);
  });
const matches = (row: CoachEventRow, where: Where = {}) => matchesWhere(row, where);

/** A read-only Prisma-shaped table over plain rows (findMany / findFirst / findUnique / count). */
export function readTable<T extends object>(rows: T[]) {
  return {
    rows,
    findMany: async (args: { where?: Where; take?: number } = {}) => rows.filter((r) => matchesWhere(r, args.where)).slice(0, args.take ?? rows.length),
    findFirst: async (args: { where?: Where } = {}) => rows.find((r) => matchesWhere(r, args.where)) ?? null,
    findUnique: async (args: { where: Where }) => rows.find((r) => matchesWhere(r, args.where)) ?? null,
    count: async (args: { where?: Where } = {}) => rows.filter((r) => matchesWhere(r, args.where)).length,
  };
}

export function coachEventTable(clock: () => Date = () => new Date()) {
  const rows: CoachEventRow[] = [];
  let seq = 0;
  const insert = (data: Data): CoachEventRow => {
    if (data.dedupeKey && rows.some((r) => r.dedupeKey === data.dedupeKey)) throw new PrismaUniqueError();
    const row: CoachEventRow = { id: `ce-${++seq}`, jobTaskId: null, payload: null, dismissedAt: null, dedupeKey: null, createdAt: clock(), ...data };
    rows.push(row);
    return row;
  };
  // Every call yields to the event loop first, like a real round trip, so concurrent callers interleave.
  const tick = () => new Promise<void>((r) => setImmediate(r));
  const api = {
    rows,
    async findFirst(args: { where?: Where } = {}) {
      await tick();
      return rows.find((r) => matches(r, args.where)) ?? null;
    },
    async findUnique(args: { where: Where }) {
      await tick();
      return rows.find((r) => matches(r, args.where)) ?? null;
    },
    async findMany(args: { where?: Where } = {}) {
      await tick();
      return rows.filter((r) => matches(r, args.where));
    },
    async count(args: { where?: Where } = {}) {
      await tick();
      return rows.filter((r) => matches(r, args.where)).length;
    },
    async create(args: { data: Data }) {
      await tick();
      return insert(args.data);
    },
    async createMany(args: { data: Data[]; skipDuplicates?: boolean }) {
      await tick();
      let count = 0;
      for (const d of args.data) {
        try {
          insert(d);
          count++;
        } catch (e) {
          if (!(e instanceof PrismaUniqueError) || !args.skipDuplicates) throw e;
        }
      }
      return { count };
    },
    async upsert(args: { where: { dedupeKey: string }; create: Data; update: Partial<Data> }) {
      await tick();
      const hit = rows.find((r) => r.dedupeKey === args.where.dedupeKey);
      if (hit) return Object.assign(hit, args.update);
      return insert({ ...args.create, dedupeKey: args.where.dedupeKey });
    },
    async update(args: { where: { id: string }; data: Partial<Data> }) {
      await tick();
      const hit = rows.find((r) => r.id === args.where.id);
      if (!hit) throw new Error(`CoachEvent ${args.where.id} not found`);
      return Object.assign(hit, args.data);
    },
  };
  return api;
}

export type CoachEventTable = ReturnType<typeof coachEventTable>;

/** Duplicates by the natural key (person, kind, job, IST day) — what a person would perceive as "the same nudge twice". */
export function naturalDuplicates(rows: CoachEventRow[], istDay: (d: Date) => string): string[] {
  const seen = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.kind}|${r.userId}|${r.jobTaskId ?? "-"}|${istDay(r.createdAt)}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
}
