// Close-loop hooks (ADR-005 "Consequences"; Phase 8 task 2). They take the two extra steps off
// staff as far as code can:
//   APPROVED        → make sure the approved pack is copied to {Period}/Final (copyToFinal is
//                     injected; the Phase 4 deliverable store implements the copy).
//   FILED_BY_HUMAN  → issue the Turia closeTask step at once (ManualBridge checklist) and move the
//                     job to CLOSING as `system:close-loop-hook`.
// A hook failure never undoes the transition that triggered it: it is recorded (AuditEvent) and
// reported, and the reconciler picks the job up. Nothing here can set DONE.
import type { TuriaAdapter, TuriaChecklist, TuriaMode } from "@/lib/integrations/turia/adapter";
import { BlockedError } from "@/lib/integrations/sharepoint/errors";
import type { SessionUser } from "@/lib/access";
import type { Actor } from "@/lib/agents/core/state";
import { transitionJobTask, type TransitionResult } from "@/lib/agents/core/state-db";
import { audit, loadFinalDeliverables, loadJob, SYNC_SELECT, type CloseLoopDb } from "./db";

export { cycleTimes, type CycleEvent, type CycleTimes } from "./cycle-time";

export const HOOK_ACTOR: Actor = { kind: "system", name: "close-loop-hook" };
const HOOK_ACTOR_REF = "system:close-loop-hook";

/**
 * Copies the job's approved Working deliverables to Final and records Final Deliverable rows, as
 * the person who approved. Production: the agents service finalize path (src/lib/close-loop/defaults.ts).
 */
export type CopyToFinal = (jobTaskId: string, user: SessionUser) => Promise<{ copied: number }>;

export interface HookDeps {
  db: CloseLoopDb;
  turia: TuriaAdapter;
  copyToFinal: CopyToFinal;
  now?: () => Date;
}

const why = (e: unknown) => (e as { action?: string }).action ?? (e as Error).message;

// ------------------------------------------------------------------ APPROVED

export type ApprovedHookResult =
  | { status: "already-final"; finals: number }
  | { status: "copied"; copied: number }
  | { status: "blocked" | "failed"; reason: string };

/** Ensures Final copies exist. Idempotent: does nothing when the job already has Final deliverables. */
export async function onApproved(jobTaskId: string, user: SessionUser, deps: Pick<HookDeps, "db" | "copyToFinal">): Promise<ApprovedHookResult> {
  const finals = await loadFinalDeliverables(deps.db, jobTaskId);
  if (finals.length) return { status: "already-final", finals: finals.length };
  try {
    const { copied } = await deps.copyToFinal(jobTaskId, user);
    await audit(deps.db, { actorId: HOOK_ACTOR_REF, action: "copy-to-final", entity: "JobTask", entityId: jobTaskId, meta: { copied } });
    return { status: "copied", copied };
  } catch (e) {
    const status = e instanceof BlockedError ? "blocked" : "failed";
    await audit(deps.db, { actorId: HOOK_ACTOR_REF, action: `copy-to-final-${status}`, entity: "JobTask", entityId: jobTaskId, meta: { reason: why(e) } });
    return { status, reason: why(e) };
  }
}

// ------------------------------------------------------------------ FILED_BY_HUMAN

export interface FiledHookInput {
  /** Turia task ref when the person filing knows it; otherwise the confirmed createTask ref is used. */
  turiaTaskRef?: string | null;
  /** Minutes spent, prefilled into the Turia checklist (the confirmation records the real figure). */
  minutes?: number | null;
  actorId?: string | null;
}

export type TuriaStep =
  | { status: "issued"; mode: TuriaMode; syncId: string; reused: boolean; checklist: TuriaChecklist | null }
  | { status: "needs-input"; missing: ("turiaTaskRef" | "minutes")[] }
  | { status: "blocked" | "failed"; reason: string };

export interface FiledHookResult {
  turia: TuriaStep;
  closing: TransitionResult;
  /** What to show the person straight after filing. */
  prompt: string;
}

const CLOSE_PROMPT = "Close the Turia task now: log the minutes, mark it complete, then enter the Turia task ref and minutes here.";

/** Issues the Turia close step, then FILED_BY_HUMAN → CLOSING. Each half is attempted even if the other fails. */
export async function onFiledByHuman(jobTaskId: string, deps: Pick<HookDeps, "db" | "turia" | "now">, input: FiledHookInput = {}): Promise<FiledHookResult> {
  const now = deps.now?.() ?? new Date();
  const job = await loadJob(deps.db, jobTaskId);
  if (!job) {
    return { turia: { status: "failed", reason: "Job not found" }, closing: { ok: false, code: "NOT_FOUND", reason: "That job wasn't found." }, prompt: CLOSE_PROMPT };
  }

  let taskRef = input.turiaTaskRef?.trim() || null;
  if (!taskRef) {
    const created = await deps.db.turiaSync.findMany({ where: { jobTaskId, operation: "createTask" }, select: SYNC_SELECT, orderBy: { updatedAt: "desc" } });
    taskRef = created.find((s) => (s.status === "CONFIRMED" || s.status === "CLOSED") && s.turiaRef?.trim())?.turiaRef?.trim() ?? null;
  }
  const minutes = input.minutes ?? null;

  let turia: TuriaStep;
  if (!taskRef || !minutes) {
    turia = { status: "needs-input", missing: [...(!taskRef ? (["turiaTaskRef"] as const) : []), ...(!minutes ? (["minutes"] as const) : [])] };
  } else {
    try {
      const r = await deps.turia.closeTask(taskRef, minutes, { jobTaskId, firmClientId: job.firmClientId, clientCode: job.firmClient.clientCode, title: `${job.title} ${job.period}` }, input.actorId ?? null);
      turia = { status: "issued", mode: r.mode, syncId: r.syncId, reused: r.reused, checklist: r.checklist ?? null };
    } catch (e) {
      turia = { status: e instanceof BlockedError ? "blocked" : "failed", reason: why(e) };
      await audit(deps.db, { actorId: HOOK_ACTOR_REF, action: "turia-close-step-failed", entity: "JobTask", entityId: jobTaskId, meta: { reason: why(e) } });
    }
  }

  const closing: TransitionResult =
    job.state === "FILED_BY_HUMAN"
      ? await transitionJobTask(deps.db, jobTaskId, "CLOSING", HOOK_ACTOR, { expectedState: "FILED_BY_HUMAN", now })
      : { ok: false, code: "ILLEGAL_EDGE", reason: "The job is no longer marked filed, so closing was not started." };
  return { turia, closing, prompt: CLOSE_PROMPT };
}

// ------------------------------------------------------------------ dispatch

export type HookOutcome = { hook: "approved"; result: ApprovedHookResult } | { hook: "filed"; result: FiledHookResult } | null;

/** Runs the hook for a transition that just succeeded (none for other edges). */
export async function afterTransition(
  r: Extract<TransitionResult, { ok: true }>,
  user: SessionUser,
  deps: HookDeps,
  input: FiledHookInput = {},
): Promise<HookOutcome> {
  if (r.to === "APPROVED" && r.from === "IN_REVIEW") return { hook: "approved", result: await onApproved(r.jobTaskId, user, deps) };
  if (r.to === "FILED_BY_HUMAN") return { hook: "filed", result: await onFiledByHuman(r.jobTaskId, deps, { actorId: user?.id ?? null, ...input }) };
  return null;
}
