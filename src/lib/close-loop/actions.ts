// Human close-loop actions: the one lib call behind each /api/firm-os/jobs/[id]/* route.
//   markFiled          APPROVED → FILED_BY_HUMAN (ack ref), then the hook issues the Turia close
//                      step and moves the job to CLOSING.
//   confirmTuriaClose  staff type the Turia task ref + minutes → TuriaSync CLOSED (ManualBridge
//                      confirm), then the close gate is tried.
//   setJobState        any other human edge of the state machine. A target of DONE is refused
//                      outright: DONE is set only by closeJob() in gate.ts.
// Access: the job's assignee or reviewer, a manager or a partner (src/lib/rbac/policy.ts canActOnJob),
// and only while active. Admin (IT) takes no job edges.
import type { JobTaskState } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { actorOf } from "@/lib/agents/access";
import { transitionJobTask } from "@/lib/agents/core/state-db";
import { scrubFreeText } from "@/lib/corrections/mask";
import type { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { canActOnJob } from "@/lib/rbac/policy";
import { audit, loadJob } from "./db";
import { CloseLoopError, transitionError } from "./errors";
import { closeJob, type CloseJobResult, type GateDeps } from "./gate";
import { HOOK_ACTOR, afterTransition, onFiledByHuman, type HookDeps, type HookOutcome, type TuriaStep } from "./hooks";

export interface CloseLoopDeps extends GateDeps, HookDeps {
  /** Confirmations are always recorded through the manual bridge, whatever bridge is active. */
  manual: Pick<ManualBridge, "closeTask" | "confirm">;
}

/** Assignee, reviewer, manager or partner of this job, and active (the rule lives in src/lib/rbac/policy.ts). */
export { canActOnJob };

async function jobFor(user: SessionUser, jobTaskId: string, deps: CloseLoopDeps) {
  const job = await loadJob(deps.db, jobTaskId);
  if (!job) throw new CloseLoopError("not-found", "Job not found");
  const actor = actorOf(user);
  if (!canActOnJob(user, job) || !actor) throw new CloseLoopError("forbidden", "Only the job's assignee or reviewer, a manager or a partner can do this");
  return { job, actor };
}

const DONE_REFUSED =
  "DONE is set only by the close gate. Mark the job filed, close the Turia task with the time logged, and keep the Final file in SharePoint; the job then closes itself.";

// ------------------------------------------------------------------ mark filed

export interface MarkFiledInput {
  ackRef?: string | null;
  turiaTaskRef?: string | null;
  minutes?: number | null;
}

export interface MarkFiledResult {
  state: JobTaskState;
  ackRef: string | null;
  turia: TuriaStep;
  prompt: string;
}

export async function markFiled(jobTaskId: string, input: MarkFiledInput, user: SessionUser, deps: CloseLoopDeps): Promise<MarkFiledResult> {
  const { actor } = await jobFor(user, jobTaskId, deps);
  const now = deps.now?.() ?? new Date();
  const t = await transitionJobTask(deps.db, jobTaskId, "FILED_BY_HUMAN", actor, { expectedState: "APPROVED", ackRef: input.ackRef ?? null, now });
  if (!t.ok) throw transitionError(t);
  await audit(deps.db, { actorId: actor.userId, action: t.edge, entity: "JobTask", entityId: jobTaskId, meta: { from: t.from, to: t.to, eventId: t.eventId, ackRef: input.ackRef?.trim() || null } });
  const hook = await onFiledByHuman(jobTaskId, deps, { turiaTaskRef: input.turiaTaskRef, minutes: input.minutes, actorId: actor.userId });
  const job = await loadJob(deps.db, jobTaskId);
  return { state: job?.state ?? "FILED_BY_HUMAN", ackRef: job?.ackRef ?? null, turia: hook.turia, prompt: hook.prompt };
}

// ------------------------------------------------------------------ Turia close

export interface TuriaCloseInput {
  turiaTaskRef: string;
  minutes: number;
}

export interface TuriaCloseResult {
  turia: { syncId: string; status: string; turiaRef: string | null; minutesLogged: number | null };
  close: CloseJobResult;
}

export async function confirmTuriaClose(jobTaskId: string, input: TuriaCloseInput, user: SessionUser, deps: CloseLoopDeps): Promise<TuriaCloseResult> {
  const { job, actor } = await jobFor(user, jobTaskId, deps);
  const now = deps.now?.() ?? new Date();
  if (job.state !== "FILED_BY_HUMAN" && job.state !== "CLOSING") {
    throw new CloseLoopError("state", `The Turia close is recorded after the job is marked filed (the job is ${job.state})`);
  }
  if (job.state === "FILED_BY_HUMAN") {
    const t = await transitionJobTask(deps.db, jobTaskId, "CLOSING", HOOK_ACTOR, { expectedState: "FILED_BY_HUMAN", now });
    if (!t.ok) throw transitionError(t);
  }
  const ref = input.turiaTaskRef.trim();
  const issued = await deps.manual.closeTask(
    ref,
    input.minutes,
    { jobTaskId, firmClientId: job.firmClientId, clientCode: job.firmClient.clientCode, title: `${job.title} ${job.period}` },
    actor.userId,
  );
  const sync = await deps.manual.confirm(issued.syncId, { turiaRef: ref, minutes: input.minutes, confirmedBy: actor.userId });
  await audit(deps.db, { actorId: actor.userId, action: "turia-close-confirmed", entity: "TuriaSync", entityId: sync.id, meta: { jobTaskId, turiaRef: sync.turiaRef, minutes: sync.minutesLogged } });
  const close = await closeJob(jobTaskId, actor, deps);
  return { turia: { syncId: sync.id, status: sync.status, turiaRef: sync.turiaRef, minutesLogged: sync.minutesLogged }, close };
}

// ------------------------------------------------------------------ generic edge

export interface SetStateInput {
  to: JobTaskState;
  expectedState: JobTaskState;
  note?: string | null;
}

export async function setJobState(jobTaskId: string, input: SetStateInput, user: SessionUser, deps: CloseLoopDeps): Promise<{ state: JobTaskState; hook: HookOutcome }> {
  if (input.to === "DONE") {
    await audit(deps.db, { actorId: user?.id ?? null, action: "done-refused", entity: "JobTask", entityId: jobTaskId, meta: { via: "state", expectedState: input.expectedState } });
    throw new CloseLoopError("gate-required", DONE_REFUSED);
  }
  if (input.to === "FILED_BY_HUMAN") throw new CloseLoopError("invalid", "Use Mark filed, with the acknowledgement reference");
  const { actor } = await jobFor(user, jobTaskId, deps);
  // The note is stored with identifiers (PAN, GSTIN, phone, email …) masked (ADR-006).
  const note = input.note?.trim() ? scrubFreeText(input.note) : (input.note ?? null);
  const t = await transitionJobTask(deps.db, jobTaskId, input.to, actor, { expectedState: input.expectedState, note, now: deps.now?.() ?? new Date() });
  if (!t.ok) throw transitionError(t);
  // e.g. "retract-filing" (FILED_BY_HUMAN / CLOSING → APPROVED, manager or partner, note kept).
  await audit(deps.db, { actorId: actor.userId, action: t.edge, entity: "JobTask", entityId: jobTaskId, meta: { from: t.from, to: t.to, eventId: t.eventId, note } });
  return { state: t.to, hook: await afterTransition(t, user, deps) };
}
