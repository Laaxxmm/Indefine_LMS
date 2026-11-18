// In-memory stand-in for the Prisma models the companion uses. It implements only finds, create
// and update — there is no way to remove a row, which is the point (pairings are revoked by UPDATE).
// Queries are answered the way the companion's selects ask for them (nested filters included), so
// tests read like the real thing without a database.
import type { FirmService, JobTaskState } from "@prisma/client";
import type { CompanionUser } from "../access";
import { COMPANION_TOKEN_PREFIX } from "../config";

export type TokenRow = { id: string; userId: string; tokenHash: string; label: string | null; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null };
export type UserRow = { id: string; name: string | null; email: string; image: string | null; role: "EMPLOYEE" | "ADMIN"; level: string; department: string; active: boolean };
export type RunRow = { id: string; agent: string; status: string; startedAt: Date; figures: unknown; checklist: Array<{ severity: string; status: string }> };
export type JobRow = {
  id: string;
  title: string;
  service: FirmService;
  period: string;
  fy: string;
  state: JobTaskState;
  assigneeId: string | null;
  reviewerId: string | null;
  internalDueOn: Date | null;
  statutoryDueOn: Date | null;
  createdAt: Date;
  client: { name: string; gstin: string | null; pan: string | null; cin: string | null };
  clientCode: string;
  runs: RunRow[];
  turiaClosed?: boolean;
};

export type Call = { model: string; method: string; args: unknown };

/** A token-shaped string built at run time (no long literals in tests: the secret scan reads them). */
export const fakeToken = (ch = "a") => COMPANION_TOKEN_PREFIX + ch.repeat(43);

export function user(overrides: Partial<UserRow> = {}): UserRow {
  return { id: "u-staff", name: "Priya Staff", email: "priya@indefine.test", image: null, role: "EMPLOYEE", level: "EXECUTIVE", department: "TAX", active: true, ...overrides };
}

export const asSession = (u: UserRow): CompanionUser => ({ ...u });

type Where = Record<string, unknown>;
const matches = (row: Record<string, unknown>, where: Where | undefined) => Object.entries(where ?? {}).every(([k, v]) => row[k] === v);

function scopeOk(job: JobRow, where: { OR?: Array<{ assigneeId?: string; reviewerId?: string }> } | undefined): boolean {
  if (!where?.OR) return true;
  return where.OR.some((c) => (c.assigneeId !== undefined && job.assigneeId === c.assigneeId) || (c.reviewerId !== undefined && job.reviewerId === c.reviewerId));
}

const runsDesc = (j: JobRow) => [...j.runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

export function fakeDb(init: { tokens?: TokenRow[]; users?: UserRow[]; settings?: Record<string, boolean>; jobs?: JobRow[] } = {}) {
  const calls: Call[] = [];
  const tokens: TokenRow[] = [...(init.tokens ?? [])];
  const users: UserRow[] = [...(init.users ?? [])];
  const settings: Record<string, boolean> = { ...(init.settings ?? {}) };
  const jobs: JobRow[] = [...(init.jobs ?? [])];
  const audits: Array<Record<string, unknown>> = [];
  let seq = 0;
  const log = (model: string, method: string, args: unknown) => calls.push({ model, method, args });

  const db = {
    calls,
    tokens,
    audits,
    settings,
    companionToken: {
      findMany: async (args: { where?: Where; orderBy?: unknown }) => {
        log("companionToken", "findMany", args);
        return tokens.filter((r) => matches(r, args.where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((r) => ({ ...r }));
      },
      findUnique: async (args: { where: { tokenHash?: string; id?: string } }) => {
        log("companionToken", "findUnique", args);
        const r = tokens.find((t) => (args.where.tokenHash !== undefined ? t.tokenHash === args.where.tokenHash : t.id === args.where.id));
        return r ? { ...r } : null;
      },
      findFirst: async (args: { where: Where }) => {
        log("companionToken", "findFirst", args);
        const r = tokens.find((t) => matches(t, args.where));
        return r ? { ...r } : null;
      },
      create: async (args: { data: Partial<TokenRow> & { userId: string; tokenHash: string } }) => {
        log("companionToken", "create", args);
        const row: TokenRow = { id: `tok-${++seq}`, label: null, createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...args.data };
        tokens.push(row);
        return { ...row };
      },
      update: async (args: { where: { id: string }; data: Partial<TokenRow> }) => {
        log("companionToken", "update", args);
        const row = tokens.find((t) => t.id === args.where.id);
        if (!row) throw new Error("fake: no such token");
        Object.assign(row, args.data);
        return { ...row };
      },
    },
    auditEvent: {
      create: async (args: { data: Record<string, unknown> }) => {
        log("auditEvent", "create", args);
        audits.push(args.data);
        return { id: `ae-${audits.length}`, ...args.data };
      },
    },
    workspaceSetting: {
      findUnique: async (args: { where: { userId: string } }) => {
        log("workspaceSetting", "findUnique", args);
        return args.where.userId in settings ? { companionEnabled: settings[args.where.userId] } : null;
      },
    },
    user: {
      findUnique: async (args: { where: { id: string } }) => {
        log("user", "findUnique", args);
        const u = users.find((x) => x.id === args.where.id);
        return u ? { ...u } : null;
      },
    },
    jobTask: {
      // Answers RANK_SELECT (provider.ts): latest run's block failures, closed Turia syncs.
      findMany: async (args: { where: { AND: [{ OR: Array<{ assigneeId?: string; reviewerId?: string }> }, { state: { in: JobTaskState[] } }] } }) => {
        log("jobTask", "findMany", args);
        const [scope, states] = args.where.AND;
        return jobs
          .filter((j) => scopeOk(j, scope) && states.state.in.includes(j.state))
          .map((j) => ({
            ...j,
            firmClient: { clientCode: j.clientCode, client: { name: j.client.name } },
            agentRuns: runsDesc(j).slice(0, 1).map((r) => ({ checklist: r.checklist.filter((c) => c.status === "fail" && c.severity === "block").map((_, i) => ({ id: `c${i}` })) })),
            turiaSyncs: j.turiaClosed ? [{ id: "ts-1" }] : [],
          }));
      },
      // Answers DETAIL_SELECT: client identifiers, last 10 runs with their failures.
      findFirst: async (args: { where: { id: string; OR?: Array<{ assigneeId?: string; reviewerId?: string }> } }) => {
        log("jobTask", "findFirst", args);
        const j = jobs.find((x) => x.id === args.where.id && scopeOk(x, args.where));
        if (!j) return null;
        return {
          id: j.id,
          firmClient: { client: { ...j.client } },
          agentRuns: runsDesc(j)
            .slice(0, 10)
            .map((r) => ({ id: r.id, agent: r.agent, status: r.status, figures: r.figures, checklist: r.checklist.filter((c) => c.status === "fail").map((c) => ({ severity: c.severity })) })),
        };
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  };
  return db;
}

export type FakeDb = ReturnType<typeof fakeDb>;

let jobSeq = 0;
export function job(overrides: Partial<JobRow> = {}): JobRow {
  jobSeq += 1;
  return {
    id: `job-${jobSeq}`,
    title: "GSTR-3B",
    service: "GST",
    period: "2026-10",
    fy: "2026-27",
    state: "ASSIGNED",
    assigneeId: "u-staff",
    reviewerId: "u-reviewer",
    internalDueOn: null,
    statutoryDueOn: null,
    createdAt: new Date("2026-10-01T04:00:00Z"),
    client: { name: "Acme Traders Private Limited", gstin: "29ABCDE1234F1Z5", pan: "ABCDE1234F", cin: "U12345KA2020PTC123456" },
    clientCode: "ACME",
    runs: [],
    ...overrides,
  };
}
