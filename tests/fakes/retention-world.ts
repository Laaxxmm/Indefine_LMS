// In-memory tables for the retention job (src/lib/hardening/retention.ts): AgentRun, OnboardingRun,
// ActivityHeartbeat, AuditEvent and ModelCall, with just the Prisma calls the job makes. Kept under
// tests/ (outside the Firm OS no-delete scan) because it must implement the heartbeat delete the job calls.
import { Prisma } from "@prisma/client";
import type { EscalationDb } from "@/lib/audit/escalations";
import type { RetentionDb } from "@/lib/hardening/retention";

export type RunRec = { id: string; inputs: unknown; inputsPurgeAt: Date | null; startedAt: Date; figures: unknown; status: string };
export type OnboardingRec = { id: string; prompt: string; spec: unknown; plan: unknown; status: string; steps?: unknown; error?: string | null; firmClientId: string | null; updatedAt: Date };
export type BeatRec = { id: string; userId: string; at: Date; source: string };
export type AuditRec = { id: string; actorId: string | null; action: string; entity: string; entityId: string | null; meta?: unknown; createdAt?: Date };
export type CallRec = {
  id: string;
  runId: string;
  agent: string | null;
  task: string;
  provider: string | null;
  tier: string | null;
  escalationLevel: number;
  status: string;
  escalated: boolean;
  createdAt: Date;
  error?: string | null;
};

type DateCond = { lte?: Date; lt?: Date; gte?: Date };
const inRange = (v: Date | null | undefined, c: DateCond) =>
  !!v && (c.lte ? v.getTime() <= c.lte.getTime() : true) && (c.lt ? v.getTime() < c.lt.getTime() : true) && (c.gte ? v.getTime() >= c.gte.getTime() : true);
const before = inRange;
const byCreated = <T extends { createdAt?: Date }>(a: T, b: T) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
const pick = (row: Record<string, unknown>, select?: Record<string, boolean>) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k] ?? null])) : { ...row });

export class RetentionWorld {
  runs: RunRec[] = [];
  onboarding: OnboardingRec[] = [];
  beats: BeatRec[] = [];
  audits: AuditRec[] = [];
  calls: CallRec[] = [];
  /** Every call the job made, in order (model.method). */
  log: string[] = [];
  /** createdAt of rows the job creates. */
  clock: () => Date = () => new Date();

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
    onboardingRun: {
      updateMany: async (args: { where: { updatedAt: DateCond; prompt: { notIn: string[] } }; data: { prompt: string; spec: unknown; plan: unknown } }) => {
        this.log.push("onboardingRun.updateMany");
        if (args.data.plan !== Prisma.DbNull) throw new Error("retention must clear the plan with Prisma.DbNull");
        const hit = this.onboarding.filter((r) => inRange(r.updatedAt, args.where.updatedAt) && !args.where.prompt.notIn.includes(r.prompt));
        for (const r of hit) Object.assign(r, { prompt: args.data.prompt, spec: args.data.spec, plan: null, updatedAt: this.clock() });
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
        const rec = { id: `audit-${this.audits.length + 1}`, createdAt: this.clock(), ...args.data };
        this.audits.push(rec);
        return { id: rec.id };
      },
      findFirst: async (args: { where: { action: string; actorId: string } }) => {
        this.log.push("auditEvent.findFirst");
        const hits = this.audits.filter((a) => a.action === args.where.action && a.actorId === args.where.actorId);
        const last = hits.at(-1);
        return last ? { meta: last.meta ?? null } : null;
      },
      findMany: async (args: { where: { action: string | { in: string[] }; entity?: string; entityId?: { in: string[] }; createdAt?: DateCond }; take?: number; select?: Record<string, boolean> }) => {
        const w = args.where;
        if (typeof w.action === "string") {
          // auditModelEscalations: which calls already have an AuditEvent.
          return this.audits.filter((a) => a.action === w.action && a.entity === w.entity && (w.entityId?.in ?? []).includes(a.entityId ?? "")).map((a) => ({ entityId: a.entityId }));
        }
        this.log.push("auditEvent.findMany");
        const actions = w.action.in;
        return this.audits
          .filter((a) => actions.includes(a.action) && inRange(a.createdAt ?? new Date(0), w.createdAt ?? {}))
          .sort(byCreated)
          .slice(0, args.take)
          .map((a) => pick(a as unknown as Record<string, unknown>, args.select));
      },
      update: async (args: { where: { id: string }; data: { meta: unknown } }) => {
        this.log.push("auditEvent.update");
        const a = this.audits.find((x) => x.id === args.where.id);
        if (!a) throw new Error("audit not found");
        a.meta = args.data.meta;
        return { id: a.id };
      },
    },
    modelCall: {
      findMany: async (args: { where: { escalated?: true; error?: { not: null }; createdAt: DateCond }; take: number; select?: Record<string, boolean> }) => {
        if (args.where.escalated) {
          return this.calls.filter((c) => c.escalated && inRange(c.createdAt, args.where.createdAt)).slice(0, args.take);
        }
        this.log.push("modelCall.findMany");
        return this.calls
          .filter((c) => c.error != null && inRange(c.createdAt, args.where.createdAt))
          .sort(byCreated)
          .slice(0, args.take)
          .map((c) => pick(c as unknown as Record<string, unknown>, args.select));
      },
      update: async (args: { where: { id: string }; data: { error: string } }) => {
        this.log.push("modelCall.update");
        const c = this.calls.find((x) => x.id === args.where.id);
        if (!c) throw new Error("model call not found");
        c.error = args.data.error;
        return { id: c.id };
      },
    },
  } as unknown as RetentionDb & EscalationDb;
}
