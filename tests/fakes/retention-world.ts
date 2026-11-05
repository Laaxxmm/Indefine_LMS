// In-memory tables for the retention job (src/lib/hardening/retention.ts): AgentRun, ActivityHeartbeat,
// AuditEvent and ModelCall, with just the Prisma calls the job makes. Kept under tests/ (outside the
// Firm OS no-delete scan) because it must implement the heartbeat delete the job calls.
import { Prisma } from "@prisma/client";
import type { EscalationDb } from "@/lib/audit/escalations";
import type { RetentionDb } from "@/lib/hardening/retention";

export type RunRec = { id: string; inputs: unknown; inputsPurgeAt: Date | null; startedAt: Date; figures: unknown; status: string };
export type BeatRec = { id: string; userId: string; at: Date; source: string };
export type AuditRec = { id: string; actorId: string | null; action: string; entity: string; entityId: string | null; meta?: unknown };
export type CallRec = { id: string; runId: string; agent: string | null; task: string; provider: string | null; tier: string | null; escalationLevel: number; status: string; escalated: boolean; createdAt: Date };

type DateCond = { lte?: Date; lt?: Date };
const before = (v: Date | null, c: DateCond) => !!v && (c.lte ? v.getTime() <= c.lte.getTime() : true) && (c.lt ? v.getTime() < c.lt.getTime() : true);

export class RetentionWorld {
  runs: RunRec[] = [];
  beats: BeatRec[] = [];
  audits: AuditRec[] = [];
  calls: CallRec[] = [];
  /** Every call the job made, in order (model.method). */
  log: string[] = [];

  readonly db = {
    agentRun: {
      updateMany: async (args: { where: { inputs: { not: unknown }; OR: [{ inputsPurgeAt: DateCond }, { inputsPurgeAt: null; startedAt: DateCond }] }; data: { inputs: unknown } }) => {
        this.log.push("agentRun.updateMany");
        if (args.where.inputs.not !== Prisma.DbNull || args.data.inputs !== Prisma.DbNull) throw new Error("retention must filter and set inputs with Prisma.DbNull");
        const [byPurgeAt, legacy] = args.where.OR;
        const hit = this.runs.filter((r) => r.inputs !== null && (before(r.inputsPurgeAt, byPurgeAt.inputsPurgeAt) || (r.inputsPurgeAt === null && before(r.startedAt, legacy.startedAt))));
        hit.forEach((r) => (r.inputs = null));
        return { count: hit.length };
      },
    },
    activityHeartbeat: {
      deleteMany: async (args: { where: { at: DateCond } }) => {
        this.log.push("activityHeartbeat.deleteMany");
        const keep = this.beats.filter((b) => !before(b.at, args.where.at));
        const count = this.beats.length - keep.length;
        this.beats = keep;
        return { count };
      },
    },
    auditEvent: {
      create: async (args: { data: Omit<AuditRec, "id"> }) => {
        this.log.push("auditEvent.create");
        const rec = { id: `audit-${this.audits.length + 1}`, ...args.data };
        this.audits.push(rec);
        return { id: rec.id };
      },
      findMany: async (args: { where: { action: string; entity: string; entityId: { in: string[] } } }) =>
        this.audits.filter((a) => a.action === args.where.action && a.entity === args.where.entity && args.where.entityId.in.includes(a.entityId ?? "")).map((a) => ({ entityId: a.entityId })),
    },
    modelCall: {
      findMany: async (args: { where: { escalated: true; createdAt: { gte: Date; lt: Date } }; take: number }) =>
        this.calls
          .filter((c) => c.escalated && c.createdAt >= args.where.createdAt.gte && c.createdAt < args.where.createdAt.lt)
          .slice(0, args.take),
    },
  } as unknown as RetentionDb & EscalationDb;
}
