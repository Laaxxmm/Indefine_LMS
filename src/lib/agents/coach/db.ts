// The narrow Prisma client the coach takes, the job select every coach read shares, the dedupe keys
// and the two write helpers. Reads, inserts and narrow updates only: nothing in the coach removes a
// row. Heartbeat retention (7 days, ADR-006) is the Phase 11 retention job's; the coach only ever
// reads the recent window (BREAK_POLICY.lookbackHours ≤ 7 days).
import type { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit/log";

/** The app's Prisma client (configured with omit), narrowed to the tables the coach touches. */
type AppPrisma = (typeof import("@/lib/prisma"))["prisma"];
export type CoachDb = Pick<AppPrisma, "jobTask" | "agentRun" | "coachEvent" | "coachPreference" | "activityHeartbeat" | "auditEvent" | "user">;

/** AuditEvent.actorId for writes the coach crons make. */
export const COACH_ACTOR = "system:coach";

export const COACH_KINDS = ["board", "reminder", "escalation", "break", "summary"] as const;
export type CoachKind = (typeof COACH_KINDS)[number];

/** Bound per query, so a cron run stays well inside the route's time limit. */
export const MAX_ROWS = 2000;

export const COACH_JOB_SELECT = {
  id: true,
  title: true,
  service: true,
  state: true,
  period: true,
  fy: true,
  assigneeId: true,
  reviewerId: true,
  internalDueOn: true,
  statutoryDueOn: true,
  firmClient: { select: { clientCode: true, client: { select: { name: true } } } },
  engagement: { select: { reviewerId: true } },
} satisfies Prisma.JobTaskSelect;

export type CoachJobRow = Prisma.JobTaskGetPayload<{ select: typeof COACH_JOB_SELECT }>;

/**
 * Idempotency keys (CoachEvent.dedupeKey is unique): a cron that fires twice, or two runs at once,
 * writes each nudge once.
 */
export const dedupeKey = {
  board: (userId: string, dayKey: string) => `board:${userId}:${dayKey}`,
  reminder: (jobId: string, userId: string, slot: string) => `reminder:${jobId}:${userId}:${slot}`,
  escalation: (jobId: string, dayKey: string) => `escalation:${jobId}:${dayKey}`,
  summary: (userId: string, weekKey: string) => `summary:${userId}:${weekKey}`,
  break: (userId: string, dayKey: string, ordinal: number) => `break:${userId}:${dayKey}:${ordinal}`,
};

export type NewCoachEvent = {
  userId: string;
  kind: CoachKind;
  dedupeKey: string;
  jobTaskId?: string | null;
  payload: Prisma.InputJsonValue;
};

/**
 * INSERT … ON CONFLICT (dedupeKey) DO NOTHING. True when this call created the event, false when
 * one with the same key already existed (an earlier or a concurrent run).
 */
export async function createOnce(db: Pick<CoachDb, "coachEvent">, e: NewCoachEvent): Promise<boolean> {
  const r = await db.coachEvent.createMany({ data: [{ ...e, jobTaskId: e.jobTaskId ?? null }], skipDuplicates: true });
  return r.count === 1;
}

/**
 * Which of `keys` already have a CoachEvent — one indexed read instead of one failed insert per
 * nudge that was already sent. createOnce still guards a concurrent run.
 */
export async function sentKeys(db: Pick<CoachDb, "coachEvent">, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db.coachEvent.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true } });
  return new Set(rows.map((r) => r.dedupeKey).filter((k): k is string => !!k));
}

export type CoachAudit ={ actorId: string; action: string; entity: string; entityId?: string | null; meta?: Record<string, unknown> };

/** One AuditEvent row, through logAudit (src/lib/audit/log.ts). Never called for heartbeats or break nudges (ADR-006). */
export async function audit(db: Pick<CoachDb, "auditEvent">, e: CoachAudit): Promise<void> {
  await logAudit(db, { actorId: e.actorId, action: e.action, entity: e.entity, entityId: e.entityId ?? null, meta: e.meta });
}

/** "GSTR-3B 2026-10 for ACME01". */
export const jobLabel = (j: Pick<CoachJobRow, "title" | "period"> & { firmClient: { clientCode: string } }) => `${j.title} ${j.period} for ${j.firmClient.clientCode}`;
