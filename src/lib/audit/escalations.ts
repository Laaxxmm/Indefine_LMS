// Model escalations → AuditEvent (Phase 11: "AuditEvent for every … model escalation").
//
// The ModelRouter (src/lib/ai/router.ts) logs every call in ModelCall with `escalated` and
// `escalationLevel` (FAST → SMART → HARD, ADR-002). The router is not changed here; instead the
// daily Firm OS cron (/api/cron/firm-os/retention) runs auditModelEscalations(): one AuditEvent
// `model-escalation` (entity ModelCall, entityId = the ModelCall id) per escalated call in the
// look-back window that has none yet, so an escalation is in the audit trail within a day.
// Idempotent: a ModelCall with an AuditEvent is never written again. No prompt text is copied:
// ModelCall holds only the masked prompt's hash (ADR-002/006), and the meta here only ids and tiers.
import { logAudit, type AuditDb } from "./log";

export const ESCALATION_ACTION = "model-escalation";
export const ESCALATION_ENTITY = "ModelCall";
export const ESCALATION_ACTOR = "system:model-router";
export const ESCALATION_LOOKBACK_DAYS = 7;
export const ESCALATION_MAX_PER_SWEEP = 2000;

const DAY_MS = 24 * 60 * 60 * 1000;

const ESCALATION_SELECT = { id: true, runId: true, agent: true, task: true, provider: true, tier: true, escalationLevel: true, status: true, createdAt: true } as const;

export type EscalatedCall = {
  id: string;
  runId: string;
  agent: string | null;
  task: string;
  provider: string | null;
  tier: string | null;
  escalationLevel: number;
  status: string;
  createdAt: Date;
};

/** The reads and writes the sweep makes. PrismaClient satisfies it. */
export interface EscalationDb extends AuditDb {
  modelCall: {
    findMany(args: {
      where: { escalated: true; createdAt: { gte: Date; lt: Date } };
      select: typeof ESCALATION_SELECT;
      orderBy: { createdAt: "asc" };
      take: number;
    }): PromiseLike<EscalatedCall[]>;
  };
  auditEvent: AuditDb["auditEvent"] & {
    findMany(args: { where: { action: string; entity: string; entityId: { in: string[] } }; select: { entityId: true } }): PromiseLike<{ entityId: string | null }[]>;
  };
}

const metaOf = (c: Pick<EscalatedCall, "runId" | "agent" | "task" | "provider" | "tier" | "escalationLevel" | "status">) => ({
  runId: c.runId,
  agent: c.agent,
  task: c.task,
  provider: c.provider,
  tier: c.tier,
  escalationLevel: c.escalationLevel,
  status: c.status,
});

/** Writes the missing `model-escalation` AuditEvents for escalated calls in [now − lookback, now). Returns how many were written. */
export async function auditModelEscalations(
  db: EscalationDb,
  opts: { now?: Date; lookbackDays?: number; max?: number } = {},
): Promise<{ scanned: number; written: number }> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - (opts.lookbackDays ?? ESCALATION_LOOKBACK_DAYS) * DAY_MS);
  const calls = await db.modelCall.findMany({
    where: { escalated: true, createdAt: { gte: since, lt: now } },
    select: ESCALATION_SELECT,
    orderBy: { createdAt: "asc" },
    take: opts.max ?? ESCALATION_MAX_PER_SWEEP,
  });
  if (!calls.length) return { scanned: 0, written: 0 };
  const existing = await db.auditEvent.findMany({
    where: { action: ESCALATION_ACTION, entity: ESCALATION_ENTITY, entityId: { in: calls.map((c) => c.id) } },
    select: { entityId: true },
  });
  const done = new Set(existing.map((e) => e.entityId));
  let written = 0;
  for (const c of calls) {
    if (done.has(c.id)) continue;
    await logAudit(db, { actorId: ESCALATION_ACTOR, action: ESCALATION_ACTION, entity: ESCALATION_ENTITY, entityId: c.id, meta: { ...metaOf(c), at: c.createdAt.toISOString(), via: "sweep" } });
    done.add(c.id);
    written += 1;
  }
  return { scanned: calls.length, written };
}
