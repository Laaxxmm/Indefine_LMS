// DPDP retention (ADR-006 "Retention", Phase 11), run daily by /api/cron/firm-os/retention.
//
//   AgentRun.inputs      cached extracted rows and file lists, kept until inputsPurgeAt (the runner
//                        sets finish + 30 days; older runs: startedAt + 30 days). Then the column is
//                        set to NULL. The run row, figures, checklist results, hashes and audit trail
//                        stay. This is an UPDATE: nothing is deleted.
//   ActivityHeartbeat    break-nudge signal, kept 7 days, then DELETED. These rows carry no business
//                        value after the nudge window and ADR-006 commits to deleting them. This is the
//                        only delete in Firm OS code: scripts/lib/guards.ts NO_DELETE_EXEMPTIONS allows
//                        exactly purgeExpiredHeartbeats() below, and only its activityHeartbeat delete.
//   ModelCall escalations are mirrored into AuditEvent (auditModelEscalations) on the same run.
//
// Each run writes one `retention` AuditEvent with the counts. Windows are constants: changing one is
// a threshold change (partner + ADR). Deliverables live in SharePoint and are never touched here.
import { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit/log";
import { auditModelEscalations, type EscalationDb } from "@/lib/audit/escalations";

export const AGENT_RUN_INPUTS_DAYS = 30;
export const HEARTBEAT_DAYS = 7;
export const RETENTION_ACTOR = "system:retention";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

/**
 * The Prisma delegates the run uses. Typed from PrismaClient (no hand-written delegate interface, so
 * the only delete-shaped code in this file is the one call in purgeExpiredHeartbeats); tests pass a
 * fake from tests/fakes/retention-world.ts.
 */
export type RetentionDb = Pick<AppDb, "agentRun" | "activityHeartbeat" | "auditEvent">;
/** The app's client (src/lib/prisma.ts, which configures `omit`), so the delegates match exactly. */
type AppDb = (typeof import("@/lib/prisma"))["prisma"];

/** Sets AgentRun.inputs to NULL where its retention has passed; the rows themselves are kept. */
export async function clearExpiredAgentRunInputs(db: Pick<RetentionDb, "agentRun">, now: Date): Promise<number> {
  const r = await db.agentRun.updateMany({
    where: {
      inputs: { not: Prisma.DbNull },
      OR: [{ inputsPurgeAt: { lte: now } }, { inputsPurgeAt: null, startedAt: { lte: daysBefore(now, AGENT_RUN_INPUTS_DAYS) } }],
    },
    data: { inputs: Prisma.DbNull },
  });
  return r.count;
}

/**
 * ADR-006: break-nudge heartbeats older than 7 days are deleted (no business value; aggregate-only
 * purpose). The single allowlisted delete in Firm OS code (scripts/lib/guards.ts NO_DELETE_EXEMPTIONS).
 */
export async function purgeExpiredHeartbeats(db: Pick<RetentionDb, "activityHeartbeat">, now: Date): Promise<number> {
  const r = await db.activityHeartbeat.deleteMany({ where: { at: { lt: daysBefore(now, HEARTBEAT_DAYS) } } });
  return r.count;
}

export type RetentionSummary = {
  at: string;
  agentRunInputsCleared: number;
  heartbeatsDeleted: number;
  escalationsAudited: number;
};

/** The daily run: clear expired inputs, remove old heartbeats, audit escalations, record one AuditEvent. */
export async function runRetention(db: RetentionDb & EscalationDb, now: Date = new Date()): Promise<RetentionSummary> {
  const agentRunInputsCleared = await clearExpiredAgentRunInputs(db, now);
  const heartbeatsDeleted = await purgeExpiredHeartbeats(db, now);
  const escalations = await auditModelEscalations(db, { now });
  const summary: RetentionSummary = { at: now.toISOString(), agentRunInputsCleared, heartbeatsDeleted, escalationsAudited: escalations.written };
  await logAudit(db, {
    actorId: RETENTION_ACTOR,
    action: "retention",
    entity: "AgentRun",
    entityId: null,
    meta: { ...summary, windows: { agentRunInputsDays: AGENT_RUN_INPUTS_DAYS, heartbeatDays: HEARTBEAT_DAYS } },
  });
  return summary;
}
