// Read model for the "Filing and close" part of the /agents run review screen (Phase 8): what the
// job's close loop looks like now and the one human action that moves it on. Server-side only.
//   APPROVED                 → "Mark filed" (ack ref: GST ARN / MCA SRN / ITR or TDS ack no.)
//   FILED_BY_HUMAN, CLOSING  → "Close in Turia" (task ref + minutes), or "Check again" once the
//                              Turia close is recorded and the gate still refuses; managers and
//                              partners may also "Retract filing" (→ APPROVED, note required)
//   DONE                     → nothing to do; DONE chip with the cycle time
// Firm OS never files anything: the person files on the portal and records it here. Access is the
// close-loop rule (actions.ts canActOnJob): assignee, reviewer, manager or partner, active.
import type { FirmService, JobTaskState } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { actorOf } from "@/lib/agents/access";
import { ACK_REF_REQUIRED, canTransition } from "@/lib/agents/core/state";
import { formatDateTimeIst } from "@/lib/agents/core/format";
import { canActOnJob } from "./actions";
import { cycleTimes, formatDuration } from "./cycle-time";

export type CloseLoopAction = "mark-filed" | "turia-close" | "retry-close";

export interface CloseLoopView {
  jobId: string;
  state: JobTaskState;
  service: FirmService;
  /** The acknowledgement the portal gives for this service, and whether filing needs it. */
  ack: { required: boolean; label: string };
  ackRef: string | null;
  /** "DD MMM YYYY HH:mm IST", when the filing was recorded. */
  filedAt: string | null;
  hasFinal: boolean;
  turia: { status: "none" | "issued" | "closed"; ref: string | null; minutes: number | null };
  /** Prefill for the Turia task ref: the confirmed createTask ref, if any. */
  suggestedTuriaRef: string | null;
  /** The last refused close-gate attempt since the filing, while the job is not DONE. */
  gate: { at: string; reasons: string[] } | null;
  done: { at: string; cycleTime: string } | null;
  /** The one action this person can take now (latest run only); null when none. */
  action: CloseLoopAction | null;
  /**
   * FILED_BY_HUMAN / CLOSING → APPROVED ("Retract filing", edge `retract-filing`): a manager or
   * partner, latest run only. Decided by the state machine with a placeholder note; the route still
   * needs the real one.
   */
  canRetract: boolean;
}

const CLOSE_LOOP_STATES: readonly JobTaskState[] = ["APPROVED", "FILED_BY_HUMAN", "CLOSING", "DONE"];

const ACK_LABEL: Partial<Record<FirmService, string>> = {
  GST: "GST ARN",
  ROC: "MCA SRN",
  IncomeTax: "ITR acknowledgement no.",
  TDS: "TDS acknowledgement no.",
};

/** What "Mark filed" asks for: required for GST / ROC / IncomeTax / TDS (state.ts ACK_REF_REQUIRED). */
export function ackRefFor(service: FirmService): { required: boolean; label: string } {
  return { required: ACK_REF_REQUIRED[service] ?? false, label: ACK_LABEL[service] ?? "Acknowledgement reference" };
}

const VIEW_JOB_SELECT = {
  id: true,
  state: true,
  service: true,
  ackRef: true,
  filedAt: true,
  doneAt: true,
  assigneeId: true,
  reviewerId: true,
} as const;

type ViewJobRow = {
  id: string;
  state: JobTaskState;
  service: FirmService;
  ackRef: string | null;
  filedAt: Date | null;
  doneAt: Date | null;
  assigneeId: string | null;
  reviewerId: string | null;
};

type ViewEventRow = { fromState: JobTaskState | null; toState: JobTaskState; note: string | null; createdAt: Date };
type ViewSyncRow = { operation: string; status: string; turiaRef: string | null; minutesLogged: number | null; updatedAt: Date };

/** The reads the view makes. PrismaClient satisfies it (the page casts, as it does for FirmDb). */
export interface CloseLoopViewDb {
  jobTask: { findFirst(args: { where: { id: string }; select: typeof VIEW_JOB_SELECT }): PromiseLike<ViewJobRow | null> };
  jobTaskEvent: {
    findMany(args: {
      where: { jobTaskId: string };
      select: { fromState: true; toState: true; note: true; createdAt: true };
      orderBy: { createdAt: "asc" };
    }): PromiseLike<ViewEventRow[]>;
  };
  deliverable: { count(args: { where: { jobTaskId: string; kind: "Final" } }): PromiseLike<number> };
  turiaSync: {
    findMany(args: {
      where: { jobTaskId: string };
      select: { operation: true; status: true; turiaRef: true; minutesLogged: true; updatedAt: true };
      orderBy: { updatedAt: "desc" };
    }): PromiseLike<ViewSyncRow[]>;
  };
  auditEvent: {
    findFirst(args: {
      where: { entity: "JobTask"; entityId: string; action: "close-refused" };
      orderBy: { createdAt: "desc" };
      select: { meta: true; createdAt: true };
    }): PromiseLike<{ meta: unknown; createdAt: Date } | null>;
  };
}

const ist = (d: Date) => `${formatDateTimeIst(d)} IST`;

/** The close-loop view of a job, or null when the job is not at or past APPROVED. */
export async function loadCloseLoopView(db: CloseLoopViewDb, user: SessionUser, jobTaskId: string, opts: { isLatest: boolean }): Promise<CloseLoopView | null> {
  const job = await db.jobTask.findFirst({ where: { id: jobTaskId }, select: VIEW_JOB_SELECT });
  if (!job || !CLOSE_LOOP_STATES.includes(job.state)) return null;

  const [events, finals, syncs, refused] = await Promise.all([
    db.jobTaskEvent.findMany({ where: { jobTaskId }, select: { fromState: true, toState: true, note: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    db.deliverable.count({ where: { jobTaskId, kind: "Final" } }),
    db.turiaSync.findMany({ where: { jobTaskId }, select: { operation: true, status: true, turiaRef: true, minutesLogged: true, updatedAt: true }, orderBy: { updatedAt: "desc" } }),
    db.auditEvent.findFirst({ where: { entity: "JobTask", entityId: jobTaskId, action: "close-refused" }, orderBy: { createdAt: "desc" }, select: { meta: true, createdAt: true } }),
  ]);

  const close = syncs.find((s) => s.operation === "closeTask" && s.status === "CLOSED") ?? syncs.find((s) => s.operation === "closeTask" && s.status !== "FAILED");
  const turia: CloseLoopView["turia"] = !close
    ? { status: "none", ref: null, minutes: null }
    : close.status === "CLOSED"
      ? { status: "closed", ref: close.turiaRef, minutes: close.minutesLogged }
      : { status: "issued", ref: close.turiaRef, minutes: null };
  const created = syncs.find((s) => s.operation === "createTask" && (s.status === "CONFIRMED" || s.status === "CLOSED") && s.turiaRef?.trim());

  const closing = job.state === "FILED_BY_HUMAN" || job.state === "CLOSING";
  const lastFiled = [...events].reverse().find((e) => e.toState === "FILED_BY_HUMAN");
  const reasons = (refused?.meta as { reasons?: unknown } | null)?.reasons;
  const gate =
    closing && refused && Array.isArray(reasons) && reasons.length && (!lastFiled || refused.createdAt >= lastFiled.createdAt)
      ? { at: ist(refused.createdAt), reasons: reasons.map(String) }
      : null;

  let done: CloseLoopView["done"] = null;
  if (job.state === "DONE") {
    const doneAt = job.doneAt ?? [...events].reverse().find((e) => e.toState === "DONE")?.createdAt ?? null;
    done = { at: doneAt ? ist(doneAt) : "—", cycleTime: formatDuration(cycleTimes(events).assignedToDone) };
  }

  let action: CloseLoopAction | null = null;
  let canRetract = false;
  if (opts.isLatest && canActOnJob(user, job)) {
    if (job.state === "APPROVED") action = "mark-filed";
    else if (closing) action = turia.status === "closed" && turia.ref && turia.minutes ? "retry-close" : "turia-close";
    const actor = actorOf(user);
    canRetract =
      closing &&
      !!actor &&
      canTransition(job.state, "APPROVED", { actor, jobTaskId: job.id, service: job.service, assigneeId: job.assigneeId, reviewerId: job.reviewerId, note: "note", now: new Date() }).ok;
  }

  return {
    jobId: job.id,
    state: job.state,
    service: job.service,
    ack: ackRefFor(job.service),
    ackRef: job.ackRef?.trim() || null,
    filedAt: job.filedAt ? ist(job.filedAt) : null,
    hasFinal: finals > 0,
    turia,
    suggestedTuriaRef: created?.turiaRef?.trim() ?? null,
    gate,
    done,
    action,
    canRetract,
  };
}
