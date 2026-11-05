// Close-loop reconciler (ADR-005 "After DONE"; Phase 8 task 3). Run by the cron every 30 minutes
// inside IST working hours (Mon–Sat 09:00–19:00); outside them it does nothing.
//
//   FILED_BY_HUMAN    → run the filed hook (Turia step + CLOSING) the request may have missed.
//   CLOSING           → try closeJob(); if still held:
//                         filed > 15 min ago → remind the assignee (CoachEvent "reminder"),
//                         filed > 24 h ago   → escalate to the reviewer and the assignee's manager
//                                              (partners when neither exists) (CoachEvent "escalation").
//                       Each person gets at most one of each per job per IST day, so a cron that fires
//                       twice sends nothing twice. Enforced by the database: every nudge carries a
//                       unique CoachEvent.dedupeKey (reminder:<job>:<user>:<IST day>,
//                       escalation:<job>:<user>:<IST day>), and a unique-key violation means another
//                       run already sent it — so even two runs at the same moment cannot double-nudge.
//   DONE (last 30 d)  → backstop: the DONE event must be CLOSING → DONE by system:close-gate with
//                       passing evidence; and every Final file in that evidence must still be live and
//                       unchanged. A violation raises an alert (CoachEvent "escalation" + AuditEvent)
//                       once per job per IST day: the run that creates done-alert:<job>:<IST day>
//                       (on the first recipient's event) sends it, the others' events carry
//                       done-alert:<job>:<IST day>:<user>, and only that run writes the AuditEvent.
//                       The job is NEVER reopened and its state is never changed here.
import type { JobTaskState } from "@prisma/client";
import { istDayKey, istWeekday, utcToIstWall } from "@/lib/ist";
import type { Actor } from "@/lib/agents/core/state";
import { formatDuration } from "./cycle-time";
import {
  audit,
  JOB_SELECT,
  loadDoneFacts,
  loadEvents,
  type CloseJobRow,
  type CloseLoopDb,
  type CoachEventData,
  type DeliverableRow,
  type JobEventRow,
} from "./db";
import { GATE_ACTOR_REF, closeJob, parseGateEvidence, verifyDeliverable, type CanCloseResult, type GateDeps } from "./gate";
import { onFiledByHuman, type HookDeps } from "./hooks";

export const RECONCILER_ACTOR: Actor = { kind: "system", name: "close-loop-reconciler" };
const RECONCILER_REF = "system:close-loop-reconciler";

export const NUDGE_AFTER_MS = 15 * 60_000;
export const ESCALATE_AFTER_MS = 24 * 60 * 60_000;
export const RECHECK_DONE_DAYS = 30;
/** Upper bound per run and per list, so one run stays well inside the route's time limit. */
export const MAX_JOBS_PER_RUN = 500;

export const WORK_START_MIN = 9 * 60;
export const WORK_END_MIN = 19 * 60;

/** Mon–Sat, 09:00 ≤ IST time < 19:00. */
export function isWorkingHours(d: Date): boolean {
  if (istWeekday(d) === 0) return false;
  const [h, m] = utcToIstWall(d).slice(11, 16).split(":").map(Number);
  const mins = h * 60 + m;
  return mins >= WORK_START_MIN && mins < WORK_END_MIN;
}

export type ReconcileDeps = GateDeps & Pick<HookDeps, "turia">;

export interface ReconcileSummary {
  at: string;
  skipped?: "outside-working-hours";
  open: number;
  movedToClosing: string[];
  closed: string[];
  reminders: number;
  escalations: number;
  doneChecked: number;
  alerts: string[];
  backstopViolations: string[];
  /** DONE jobs whose files could not be checked (Graph outage, credentials): no alert raised. */
  unverifiable: string[];
}

// ------------------------------------------------------------------ nudges

/** Dedupe keys (CoachEvent.dedupeKey is unique). `day` is the IST date, YYYY-MM-DD. */
export const dedupeKeys = {
  reminder: (jobId: string, userId: string, day: string) => `reminder:${jobId}:${userId}:${day}`,
  escalation: (jobId: string, userId: string, day: string) => `escalation:${jobId}:${userId}:${day}`,
  doneAlert: (jobId: string, day: string) => `done-alert:${jobId}:${day}`,
  doneAlertRecipient: (jobId: string, day: string, userId: string) => `done-alert:${jobId}:${day}:${userId}`,
};

/** Prisma's unique-constraint error (P2002), from the real client or a fake that mimics it. */
export function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: unknown }).code === "P2002";
}

/**
 * Creates the CoachEvent with its dedupe key. A unique-key violation means another run (or an
 * earlier one today) already sent it: not an error, just "already sent" (false).
 */
async function nudgeOnce(db: CloseLoopDb, data: CoachEventData, dedupeKey: string): Promise<boolean> {
  try {
    await db.coachEvent.create({ data: { ...data, dedupeKey }, select: { id: true } });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

/** Per-run memo of the user reads escalationRecipients makes (a manager per assignee, the partners once). */
export type RecipientMemo = { managers: Map<string, Promise<string | null>>; partners?: Promise<string[]> };
export const recipientMemo = (): RecipientMemo => ({ managers: new Map() });

/** Reviewer (job, else engagement) and the assignee's manager; partners when there is nobody. Never the assignee. */
export async function escalationRecipients(db: CloseLoopDb, job: CloseJobRow, memo: RecipientMemo = recipientMemo()): Promise<string[]> {
  const ids = new Set<string>();
  const reviewer = job.reviewerId ?? job.engagement?.reviewerId ?? null;
  if (reviewer) ids.add(reviewer);
  if (job.assigneeId) {
    const assignee = job.assigneeId;
    if (!memo.managers.has(assignee)) memo.managers.set(assignee, Promise.resolve(db.user.findUnique({ where: { id: assignee }, select: { managerId: true } })).then((u) => u?.managerId ?? null));
    const manager = await memo.managers.get(assignee)!;
    if (manager) ids.add(manager);
  }
  const out = [...ids].filter((id) => id !== job.assigneeId);
  if (out.length) return out.sort();
  memo.partners ??= Promise.resolve(db.user.findMany({ where: { level: "PARTNER", active: true }, select: { id: true }, orderBy: { id: "asc" } })).then((us) => us.map((u) => u.id));
  return [...(await memo.partners)];
}

function missingList(m: CanCloseResult["missing"]): string[] {
  return [
    ...(m.finalFile ? ["the Final file in SharePoint"] : []),
    ...(m.turiaClose ? ["the Turia task close with time logged"] : []),
    ...(m.filing ? ["the filing confirmation"] : []),
  ];
}

const jobLabel = (j: CloseJobRow) => `${j.title} ${j.period} for ${j.firmClient.clientCode}`;

async function filedAtOf(db: CloseLoopDb, job: CloseJobRow): Promise<Date> {
  if (job.filedAt) return job.filedAt;
  const filed = (await loadEvents(db, job.id)).filter((e) => e.toState === "FILED_BY_HUMAN").at(-1);
  return filed?.createdAt ?? job.updatedAt;
}

// ------------------------------------------------------------------ open jobs

async function reconcileOpen(job: CloseJobRow, deps: ReconcileDeps, now: Date, s: ReconcileSummary, memo: RecipientMemo): Promise<void> {
  let state: JobTaskState = job.state;
  if (state === "FILED_BY_HUMAN") {
    const hook = await onFiledByHuman(job.id, { ...deps, now: () => now });
    if (hook.closing.ok) {
      s.movedToClosing.push(job.id);
      state = "CLOSING";
    }
  }
  const c = await closeJob(job.id, RECONCILER_ACTOR, { ...deps, now: () => now });
  if (c.ok) {
    s.closed.push(job.id);
    return;
  }
  const missing = missingList(c.missing);
  if (missing.length === 0) return;

  const age = now.getTime() - (await filedAtOf(deps.db, job)).getTime();
  const base = { reason: "close-loop", state, missing, reasons: c.reasons, ageMinutes: Math.floor(age / 60_000) };
  const day = istDayKey(now);
  if (age > NUDGE_AFTER_MS) {
    const to = job.assigneeId ?? job.reviewerId;
    const message = `${jobLabel(job)} was marked filed ${formatDuration(age)} ago and is not closed yet. Still needed: ${missing.join("; ")}.`;
    if (to && (await nudgeOnce(deps.db, { userId: to, kind: "reminder", jobTaskId: job.id, payload: { ...base, message } }, dedupeKeys.reminder(job.id, to, day)))) s.reminders += 1;
  }
  if (age > ESCALATE_AFTER_MS) {
    const message = `${jobLabel(job)} has waited ${formatDuration(age)} since filing without closing. Still needed: ${missing.join("; ")}.`;
    for (const to of await escalationRecipients(deps.db, job, memo)) {
      const data: CoachEventData = { userId: to, kind: "escalation", jobTaskId: job.id, payload: { ...base, message, assigneeId: job.assigneeId } };
      if (await nudgeOnce(deps.db, data, dedupeKeys.escalation(job.id, to, day))) s.escalations += 1;
    }
  }
}

// ------------------------------------------------------------------ DONE jobs

type DoneFacts = { events: JobEventRow[]; rows: DeliverableRow[] };

async function recheckDone(job: CloseJobRow, deps: ReconcileDeps, now: Date, s: ReconcileSummary, facts: DoneFacts, memo: RecipientMemo): Promise<void> {
  s.doneChecked += 1;
  const events = facts.events;
  const doneEvent = events.filter((e) => e.toState === "DONE").at(-1);
  const evidence =
    doneEvent && doneEvent.fromState === "CLOSING" && doneEvent.actorId === GATE_ACTOR_REF ? parseGateEvidence(doneEvent.note) : null;

  const problems: string[] = [];
  if (!evidence) {
    s.backstopViolations.push(job.id);
    problems.push("DONE was set without close-gate evidence (not by system:close-gate)");
  }
  const rows = facts.rows;
  const toCheck = evidence ? evidence.deliverables : rows.map((r) => ({ id: r.id, sha256: r.sha256 }));
  let unverifiable = false;
  for (const want of toCheck) {
    const row = rows.find((r) => r.id === want.id);
    if (!row || row.sha256.toLowerCase() !== want.sha256.toLowerCase()) {
      problems.push(`Final deliverable ${want.id} no longer matches what the gate verified`);
      continue;
    }
    const r = await verifyDeliverable(job, row, deps.verifier);
    if (r.ok) continue;
    if (r.unverifiable) unverifiable = true;
    else problems.push(r.check.message);
  }
  if (unverifiable && problems.length === 0) s.unverifiable.push(job.id);
  if (problems.length === 0) return;

  const message = `${jobLabel(job)} is DONE but needs attention: ${problems.join("; ")}. The job was not reopened.`;
  const payload = { reason: "done-recheck", problems, message, assigneeId: job.assigneeId };
  const day = istDayKey(now);
  const [first, ...rest] = await escalationRecipients(deps.db, job, memo);
  if (!first) return;
  // The run that creates done-alert:<job>:<day> owns today's alert: it alone notifies the others
  // and writes the AuditEvent. A concurrent or later run gets the unique violation and stops.
  if (!(await nudgeOnce(deps.db, { userId: first, kind: "escalation", jobTaskId: job.id, payload }, dedupeKeys.doneAlert(job.id, day)))) return;
  for (const to of rest) await nudgeOnce(deps.db, { userId: to, kind: "escalation", jobTaskId: job.id, payload }, dedupeKeys.doneAlertRecipient(job.id, day, to));
  s.alerts.push(job.id);
  await audit(deps.db, { actorId: RECONCILER_REF, action: "done-alert", entity: "JobTask", entityId: job.id, meta: { problems } });
}

// ------------------------------------------------------------------ entry

export async function reconcile(deps: ReconcileDeps): Promise<ReconcileSummary> {
  const now = deps.now?.() ?? new Date();
  const s: ReconcileSummary = {
    at: now.toISOString(),
    open: 0,
    movedToClosing: [],
    closed: [],
    reminders: 0,
    escalations: 0,
    doneChecked: 0,
    alerts: [],
    backstopViolations: [],
    unverifiable: [],
  };
  if (!isWorkingHours(now)) return { ...s, skipped: "outside-working-hours" };

  const open = await deps.db.jobTask.findMany({
    where: { state: { in: ["FILED_BY_HUMAN", "CLOSING"] } },
    select: JOB_SELECT,
    orderBy: { id: "asc" },
    take: MAX_JOBS_PER_RUN,
  });
  s.open = open.length;
  const memo = recipientMemo();
  for (const job of open) await reconcileOpen(job, deps, now, s, memo);

  const since = new Date(now.getTime() - RECHECK_DONE_DAYS * 24 * 60 * 60_000);
  const done = await deps.db.jobTask.findMany({
    where: { state: "DONE", OR: [{ doneAt: { gte: since } }, { doneAt: null }, { updatedAt: { gte: since } }] },
    select: JOB_SELECT,
    orderBy: { id: "asc" },
    take: MAX_JOBS_PER_RUN,
  });
  // Two reads for all DONE jobs (their DONE events and Final deliverables), not two per job.
  const facts = await loadDoneFacts(deps.db, done.map((j) => j.id));
  for (const job of done) await recheckDone(job, deps, now, s, facts.get(job.id)!, memo);
  return s;
}
