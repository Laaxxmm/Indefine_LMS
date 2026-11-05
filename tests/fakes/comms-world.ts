// In-memory stand-in for the Prisma calls src/lib/agents/comms/service.ts makes (synthetic data
// only). `where` filters support what the service passes: equality, { in }, AND / OR and the
// FirmClient → jobTasks { some } relation; `select` is ignored (full rows are returned).
import type { FirmService, JobTaskState } from "@prisma/client";
import type { CommsDb } from "@/lib/agents/comms/service";

type Row = Record<string, unknown>;
export type MemClient = { id: string; clientCode: string; preferredLanguage: string; client: { name: string; contactName: string | null; contactEmail: string | null } };
export type MemJob = {
  id: string;
  firmClientId: string;
  service: FirmService;
  title: string;
  period: string;
  fy: string;
  state: JobTaskState;
  statutoryDueOn: Date | null;
  filedAt: Date | null;
  ackRef: string | null;
  assigneeId: string | null;
  reviewerId: string | null;
  createdAt: Date;
};
export type MemDraft = { id: string; firmClientId: string; jobTaskId: string | null; kind: string; language: string; subject: string; body: string; createdById: string; outlookDraftId: string | null; createdAt: Date };
export type MemAudit = { id: string; actorId: string | null; action: string; entity: string; entityId: string | null; meta: unknown; createdAt: Date };

export class CommsWorld {
  clients: MemClient[] = [];
  jobs: MemJob[] = [];
  runs: { id: string; agent: string; jobTaskId: string; checklist: { ruleId: string; status: string; message: string; evidence: unknown }[] }[] = [];
  drafts: MemDraft[] = [];
  audits: MemAudit[] = [];
  users: { id: string; name: string | null; email: string | null }[] = [
    { id: "u-priya", name: "Priya Sharma", email: "priya@indefine.test" },
    { id: "u-ravi", name: "Ravi Reviewer", email: "ravi@indefine.test" },
    { id: "u-mgr", name: "Meera Manager", email: "meera@indefine.test" },
  ];
  private n = 0;
  private clock = Date.parse("2026-11-05T05:00:00Z");
  id = (p: string) => `${p}-${++this.n}`;
  tick = () => new Date((this.clock += 60_000));

  addClient(over: Partial<MemClient> = {}): MemClient {
    const c: MemClient = { id: this.id("fc"), clientCode: "ACME01", preferredLanguage: "en", client: { name: "Acme Traders Private Limited", contactName: "Ravi Kumar", contactEmail: "ravi@acme.test" }, ...over };
    this.clients.push(c);
    return c;
  }
  addJob(client: MemClient, over: Partial<MemJob> = {}): MemJob {
    const j: MemJob = {
      id: this.id("jt"),
      firmClientId: client.id,
      service: "GST",
      title: "GSTR-3B",
      period: "2026-10",
      fy: "2026-27",
      state: "IN_REVIEW",
      statutoryDueOn: new Date("2026-11-19T18:30:00Z"),
      filedAt: null,
      ackRef: null,
      assigneeId: "u-priya",
      reviewerId: "u-ravi",
      createdAt: this.tick(),
      ...over,
    };
    this.jobs.push(j);
    return j;
  }

  private withClient = (j: MemJob) => ({ ...j, firmClient: this.clients.find((c) => c.id === j.firmClientId)! });

  private matches(row: Row, where: unknown, model: string): boolean {
    if (!where || typeof where !== "object") return true;
    for (const [k, v] of Object.entries(where as Row)) {
      if (k === "AND") {
        if (!(v as unknown[]).every((w) => this.matches(row, w, model))) return false;
      } else if (k === "OR") {
        if (!(v as unknown[]).some((w) => this.matches(row, w, model))) return false;
      } else if (v && typeof v === "object" && "some" in (v as Row)) {
        if (!(model === "firmClient" && k === "jobTasks")) throw new Error(`comms-world: unsupported relation filter ${model}.${k}`);
        if (!this.jobs.filter((j) => j.firmClientId === row.id).some((j) => this.matches(j as unknown as Row, (v as Row).some, "jobTask"))) return false;
      } else if (v && typeof v === "object" && "in" in (v as Row)) {
        if (!((v as Row).in as unknown[]).includes(row[k])) return false;
      } else if (row[k] !== v) return false;
    }
    return true;
  }

  get db(): CommsDb {
    const db = {
      firmClient: {
        findMany: async (a: { where?: unknown } = {}) => this.clients.filter((c) => this.matches(c as unknown as Row, a.where, "firmClient")).sort((x, y) => x.clientCode.localeCompare(y.clientCode)),
        findUnique: async (a: { where: Row }) => this.clients.find((c) => this.matches(c as unknown as Row, a.where, "firmClient")) ?? null,
      },
      jobTask: {
        findUnique: async (a: { where: { id: string } }) => {
          const j = this.jobs.find((x) => x.id === a.where.id);
          return j ? this.withClient(j) : null;
        },
        findMany: async (a: { where?: unknown } = {}) => this.jobs.filter((j) => this.matches(j as unknown as Row, a.where, "jobTask")).map(this.withClient),
        count: async (a: { where?: unknown } = {}) => this.jobs.filter((j) => this.matches(j as unknown as Row, a.where, "jobTask")).length,
      },
      agentRun: {
        findUnique: async (a: { where: { id: string } }) => this.runs.find((r) => r.id === a.where.id) ?? null,
      },
      commsDraft: {
        create: async (a: { data: Omit<MemDraft, "id" | "createdAt" | "outlookDraftId"> }) => {
          const d: MemDraft = { id: this.id("cd"), outlookDraftId: null, createdAt: this.tick(), ...a.data };
          this.drafts.push(d);
          return d;
        },
        findUnique: async (a: { where: { id: string } }) => this.drafts.find((d) => d.id === a.where.id) ?? null,
        findMany: async (a: { where?: unknown } = {}) => this.drafts.filter((d) => this.matches(d as unknown as Row, a.where, "commsDraft")).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()),
        update: async (a: { where: { id: string }; data: Partial<MemDraft> }) => {
          const d = this.drafts.find((x) => x.id === a.where.id);
          if (!d) throw new Error("comms-world: draft not found");
          Object.assign(d, a.data);
          return d;
        },
      },
      auditEvent: {
        create: async (a: { data: Omit<MemAudit, "id" | "createdAt"> }) => {
          const e: MemAudit = { id: this.id("ae"), createdAt: this.tick(), ...a.data };
          this.audits.push(e);
          return e;
        },
        findFirst: async (a: { where?: unknown }) => [...this.audits].reverse().find((e) => this.matches(e as unknown as Row, a.where, "auditEvent")) ?? null,
      },
      user: {
        findMany: async (a: { where?: unknown } = {}) => this.users.filter((u) => this.matches(u as unknown as Row, a.where, "user")),
        findUnique: async (a: { where: { id: string } }) => this.users.find((u) => u.id === a.where.id) ?? null,
      },
    };
    return db as unknown as CommsDb;
  }
}
