// In-memory AuditEvent / TuriaSync / JobTask / User for the partner spot-check service
// (src/lib/audit/spot-checks.ts): just the Prisma calls it makes, with the same filters.
import type { SpotCheckDb } from "@/lib/audit/spot-checks";

export type Audit = { id: string; actorId: string | null; action: string; entity: string; entityId: string | null; meta?: unknown; createdAt: Date };
export type Sync = {
  id: string;
  jobTaskId: string | null;
  turiaRef: string | null;
  minutesLogged: number | null;
  confirmedById: string | null;
  spotChecked: boolean;
  spotCheckedById: string | null;
  spotCheckedAt: Date | null;
  spotCheckNote: string | null;
};
export type Job = { id: string; title: string; period: string; fy: string; service: string; clientCode: string };

export class SpotCheckWorld {
  audits: Audit[] = [];
  syncs: Sync[] = [];
  jobs: Job[] = [];
  users = [
    { id: "u-priya", name: "Priya Raman", email: "priya@x" },
    { id: "u-partner", name: "Lakshmanan A", email: "partner@x" },
  ];
  private n = 0;

  /** A DONE job whose manual Turia close the gate selected at `at`. */
  selected(over: Partial<Sync> = {}, at = new Date("2026-11-02T05:00:00Z"), job: Partial<Job> = {}) {
    const id = over.id ?? `sync-${++this.n}`;
    const j: Job = { id: `job-${id}`, title: "GSTR-3B", period: "2026-10", fy: "2026-27", service: "GST", clientCode: "ACME01", ...job };
    this.jobs.push(j);
    this.syncs.push({ id, jobTaskId: j.id, turiaRef: "TT-4411", minutesLogged: 90, confirmedById: "u-priya", spotChecked: false, spotCheckedById: null, spotCheckedAt: null, spotCheckNote: null, ...over });
    this.audits.push({ id: `a-${this.audits.length + 1}`, actorId: "system:close-gate", action: "spot-check-selected", entity: "TuriaSync", entityId: id, meta: { jobTaskId: j.id }, createdAt: at });
    return id;
  }

  readonly db = {
    auditEvent: {
      findMany: async ({ where, take }: { where: { action: string; entity: string }; take: number }) =>
        this.audits
          .filter((a) => a.action === where.action && a.entity === where.entity)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, take)
          .map((a) => ({ entityId: a.entityId, createdAt: a.createdAt })),
      findFirst: async ({ where }: { where: { action: string; entity: string; entityId: string } }) => {
        const a = this.audits.find((x) => x.action === where.action && x.entity === where.entity && x.entityId === where.entityId);
        return a ? { meta: a.meta ?? null } : null;
      },
      create: async ({ data }: { data: Omit<Audit, "id" | "createdAt"> }) => {
        const a = { id: `a-${this.audits.length + 1}`, ...data, createdAt: new Date() };
        this.audits.push(a);
        return { id: a.id };
      },
    },
    turiaSync: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        this.syncs
          .filter((s) => where.id.in.includes(s.id))
          .map((s) => {
            const j = this.jobs.find((x) => x.id === s.jobTaskId);
            return { ...s, jobTask: j ? { title: j.title, period: j.period, fy: j.fy, service: j.service, firmClient: { clientCode: j.clientCode } } : null };
          }),
      updateMany: async ({ where, data }: { where: { id: string; spotChecked: false }; data: Partial<Sync> }) => {
        const s = this.syncs.find((x) => x.id === where.id && x.spotChecked === where.spotChecked);
        if (!s) return { count: 0 };
        Object.assign(s, data);
        return { count: 1 };
      },
      findUnique: async ({ where }: { where: { id: string } }) => (this.syncs.some((s) => s.id === where.id) ? { id: where.id } : null),
    },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => this.users.filter((u) => where.id.in.includes(u.id)),
    },
  } as unknown as SpotCheckDb;
}
