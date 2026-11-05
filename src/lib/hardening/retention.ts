// DPDP retention (ADR-006 "Retention", docs/dpdp/retention.md), run daily by /api/cron/firm-os/retention.
//
//   AgentRun.inputs        cached extracted rows and file lists, kept until inputsPurgeAt (the runner
//                          sets finish + 30 days; older runs: startedAt + 30 days). Then the column is
//                          set to NULL. The run row, figures, checklist results, hashes and audit trail
//                          stay. This is an UPDATE: nothing is deleted.
//   OnboardingRun copies   the typed request (prompt), the extracted details (spec) and the plan, 30
//                          days after the run last changed (done, failed or abandoned): replaced by a
//                          "[cleared by retention]" marker / null. The client master holds the facts;
//                          the run row, its status, steps and audit trail stay. An UPDATE.
//   Free text in logs      ADR-006 keeps ModelCall and AuditEvent because they hold no raw client
//                          text. Provider error text (ModelCall.error) and typed notes in AuditEvent
//                          (comments, change-request / approval / retraction / spot-check notes) are
//                          swept: PAN, GSTIN, Aadhaar, phone, email and account numbers become tokens
//                          (⟨PAN_1⟩). New notes are masked when written; the sweep covers older rows
//                          and writers outside Firm OS's control. UPDATEs, resumable by cursor.
//   ActivityHeartbeat      break-nudge signal, kept 7 days, then DELETED. These rows carry no business
//                          value after the nudge window and ADR-006 commits to deleting them. This is the
//                          only delete in Firm OS code: scripts/lib/guards.ts NO_DELETE_EXEMPTIONS allows
//                          exactly purgeExpiredHeartbeats() below, and only its activityHeartbeat delete.
//   ModelCall escalations are mirrored into AuditEvent (auditModelEscalations) on the same run.
//
// Each run writes one `retention` AuditEvent with the counts and the sweep cursors, so a run is
// idempotent (a second run the same night changes nothing) and the next run continues where this one
// stopped. Windows are constants: changing one is a threshold change (partner + ADR). Deliverables
// live in SharePoint and are never touched here. Everything else is kept with its record and leaves
// only through an erasure request (src/lib/privacy/erasure.ts); docs/dpdp/retention.md says why.
import { Prisma } from "@prisma/client";
import { logAudit } from "@/lib/audit/log";
import { auditModelEscalations, type EscalationDb } from "@/lib/audit/escalations";
import { scrubFreeText } from "@/lib/corrections/mask";

export const AGENT_RUN_INPUTS_DAYS = 30;
export const ONBOARDING_COPY_DAYS = 30;
export const HEARTBEAT_DAYS = 7;
export const RETENTION_ACTOR = "system:retention";
/** What a cleared OnboardingRun.prompt reads (the column is required, so it cannot be null). */
export const ONBOARDING_CLEARED = "[cleared by retention]";
/** Rows of each log table the free-text sweep reads per run; the cursor carries the rest to the next night. */
export const FREE_TEXT_SWEEP_BATCH = 1000;
/** AuditEvent actions whose meta carries text a person typed (meta.text / meta.note). */
export const FREE_TEXT_AUDIT_ACTIONS = ["comment", "request-changes", "rerun-agent", "approve", "retract-filing", "submit-manual-prep", "spot-check"] as const;
const FREE_TEXT_KEYS = ["text", "note"] as const;
/** The erasure marker (src/lib/privacy/scrub.ts ERASED_TOKEN): an erased run is not cleared again. */
const ERASED = "[erased]";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS);

/**
 * The Prisma delegates the run uses. Typed from PrismaClient (no hand-written delegate interface, so
 * the only delete-shaped code in this file is the one call in purgeExpiredHeartbeats); tests pass a
 * fake from tests/fakes/retention-world.ts.
 */
export type RetentionDb = Pick<AppDb, "agentRun" | "activityHeartbeat" | "auditEvent" | "onboardingRun" | "modelCall">;
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
 * Clears the typed request, extracted details and plan of onboarding runs untouched for 30 days
 * (docs/dpdp/consent-purpose.md: "clear cached copies … OnboardingRun.prompt by the retention job").
 * The run row, status, steps and error stay; the client master holds the client's details.
 */
export async function clearStaleOnboardingCopies(db: Pick<RetentionDb, "onboardingRun">, now: Date): Promise<number> {
  const r = await db.onboardingRun.updateMany({
    where: { updatedAt: { lte: daysBefore(now, ONBOARDING_COPY_DAYS) }, prompt: { notIn: [ONBOARDING_CLEARED, ERASED] } },
    data: { prompt: ONBOARDING_CLEARED, spec: { cleared: true }, plan: Prisma.DbNull },
  });
  return r.count;
}

/** Identifiers in a stored text replaced by tokens; null when there is nothing to change. */
function masked(s: unknown): string | null {
  if (typeof s !== "string" || !s.trim()) return null;
  const m = scrubFreeText(s);
  return m === s.trim() ? null : m;
}

export type SweepCursors = { auditFreeText: string | null; modelCallErrors: string | null };
export type SweepResult = { auditNotesMasked: number; modelErrorsMasked: number; cursors: SweepCursors };

/** The cursors the last retention run recorded (null: start from the beginning). */
export async function lastSweepCursors(db: Pick<RetentionDb, "auditEvent">): Promise<SweepCursors> {
  const last = await db.auditEvent.findFirst({ where: { action: "retention", actorId: RETENTION_ACTOR }, orderBy: { createdAt: "desc" }, select: { meta: true } });
  const c = ((last?.meta ?? {}) as Prisma.JsonObject).cursors as Prisma.JsonObject | undefined;
  const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : null);
  return { auditFreeText: iso(c?.auditFreeText), modelCallErrors: iso(c?.modelCallErrors) };
}

/** Where the next run starts: the last row read when the batch was full, else now. */
const nextCursor = (rows: { createdAt: Date }[], now: Date) => (rows.length >= FREE_TEXT_SWEEP_BATCH ? rows[rows.length - 1].createdAt : now).toISOString();
const createdIn = (since: string | null, now: Date) => ({ ...(since ? { gte: new Date(since) } : {}), lt: now });

/**
 * Masks identifiers left in ModelCall.error and in the typed notes of AuditEvent rows created since
 * the last run (all rows on the first run, FREE_TEXT_SWEEP_BATCH per table per night). Only the text
 * changes; ids, actions, entity links and every other meta key stay. Idempotent: masked text is not
 * changed again.
 */
export async function sweepFreeText(db: Pick<RetentionDb, "auditEvent" | "modelCall">, now: Date, since: SweepCursors): Promise<SweepResult> {
  const audits = await db.auditEvent.findMany({
    where: { action: { in: [...FREE_TEXT_AUDIT_ACTIONS] }, createdAt: createdIn(since.auditFreeText, now) },
    orderBy: { createdAt: "asc" },
    take: FREE_TEXT_SWEEP_BATCH,
    select: { id: true, meta: true, createdAt: true },
  });
  let auditNotesMasked = 0;
  for (const a of audits) {
    const meta = a.meta && typeof a.meta === "object" && !Array.isArray(a.meta) ? (a.meta as Prisma.JsonObject) : null;
    if (!meta) continue;
    const patch: Prisma.JsonObject = {};
    for (const k of FREE_TEXT_KEYS) {
      const m = masked(meta[k]);
      if (m !== null) patch[k] = m;
    }
    if (!Object.keys(patch).length) continue;
    await db.auditEvent.update({ where: { id: a.id }, data: { meta: { ...meta, ...patch } }, select: { id: true } });
    auditNotesMasked += 1;
  }

  const calls = await db.modelCall.findMany({
    where: { error: { not: null }, createdAt: createdIn(since.modelCallErrors, now) },
    orderBy: { createdAt: "asc" },
    take: FREE_TEXT_SWEEP_BATCH,
    select: { id: true, error: true, createdAt: true },
  });
  let modelErrorsMasked = 0;
  for (const c of calls) {
    const m = masked(c.error);
    if (m === null) continue;
    await db.modelCall.update({ where: { id: c.id }, data: { error: m }, select: { id: true } });
    modelErrorsMasked += 1;
  }
  return { auditNotesMasked, modelErrorsMasked, cursors: { auditFreeText: nextCursor(audits, now), modelCallErrors: nextCursor(calls, now) } };
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
  onboardingCopiesCleared: number;
  auditNotesMasked: number;
  modelErrorsMasked: number;
  heartbeatsDeleted: number;
  escalationsAudited: number;
};

/** The daily run: every step of the schedule, then one AuditEvent with the counts and the sweep cursors. */
export async function runRetention(db: RetentionDb & EscalationDb, now: Date = new Date()): Promise<RetentionSummary> {
  const agentRunInputsCleared = await clearExpiredAgentRunInputs(db, now);
  const onboardingCopiesCleared = await clearStaleOnboardingCopies(db, now);
  const sweep = await sweepFreeText(db, now, await lastSweepCursors(db));
  const heartbeatsDeleted = await purgeExpiredHeartbeats(db, now);
  const escalations = await auditModelEscalations(db, { now });
  const summary: RetentionSummary = {
    at: now.toISOString(),
    agentRunInputsCleared,
    onboardingCopiesCleared,
    auditNotesMasked: sweep.auditNotesMasked,
    modelErrorsMasked: sweep.modelErrorsMasked,
    heartbeatsDeleted,
    escalationsAudited: escalations.written,
  };
  await logAudit(db, {
    actorId: RETENTION_ACTOR,
    action: "retention",
    entity: "AgentRun",
    entityId: null,
    meta: {
      ...summary,
      cursors: sweep.cursors,
      windows: { agentRunInputsDays: AGENT_RUN_INPUTS_DAYS, onboardingCopyDays: ONBOARDING_COPY_DAYS, heartbeatDays: HEARTBEAT_DAYS },
    },
  });
  return summary;
}
