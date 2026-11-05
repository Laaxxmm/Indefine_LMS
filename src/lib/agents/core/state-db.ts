// Applies one JobTask transition in ONE transaction (ADR-005): re-read the row, decide with the
// pure state machine (state.ts), update state + timestamps with an optimistic-concurrency guard,
// append a JobTaskEvent. Takes a narrow Prisma-like client so tests can pass a fake; the real
// PrismaClient satisfies JobTaskDb (compile-time check in state-db.test.ts). Nothing is deleted.
import type { FirmService, JobTaskState } from "@prisma/client";
import {
  actorRef,
  canTransition,
  consumeCloseGateToken,
  type Actor,
  type CloseGateToken,
  type DenyCode,
  type EdgeName,
} from "./state";

// ------------------------------------------------------------------ narrow client

export type JobTaskRow = {
  id: string;
  state: JobTaskState;
  service: FirmService;
  assigneeId: string | null;
  reviewerId: string | null;
  ackRef: string | null;
  updatedAt: Date;
};

const ROW_SELECT = {
  id: true,
  state: true,
  service: true,
  assigneeId: true,
  reviewerId: true,
  ackRef: true,
  updatedAt: true,
} as const;

export type JobTaskUpdate = {
  state: JobTaskState;
  filedAt?: Date | null;
  filedById?: string | null;
  ackRef?: string | null;
  doneAt?: Date | null;
};

export interface JobTaskTx {
  jobTask: {
    findUnique(args: { where: { id: string }; select: typeof ROW_SELECT }): PromiseLike<JobTaskRow | null>;
    updateMany(args: { where: { id: string; state: JobTaskState; updatedAt: Date }; data: JobTaskUpdate }): PromiseLike<{ count: number }>;
  };
  jobTaskEvent: {
    create(args: {
      data: { jobTaskId: string; fromState: JobTaskState; toState: JobTaskState; actorId: string; note: string | null };
      select: { id: true };
    }): PromiseLike<{ id: string }>;
  };
  agentRun: {
    findFirst(args: {
      where: { jobTaskId: string };
      orderBy: { startedAt: "desc" };
      select: { id: true };
    }): PromiseLike<{ id: string } | null>;
  };
  checklistResult: {
    count(args: { where: { agentRunId: string; severity: "block"; status: "fail" } }): PromiseLike<number>;
  };
  /** Raw query on the same connection: arms the DONE trigger (see CLOSE_GATE_SETTING). */
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<unknown>;
}

/**
 * ADR-005 database backstop (migration 20261106000000_firm_os_done_trigger): a BEFORE UPDATE OF state
 * trigger on "JobTask" raises unless current_setting('firm_os.close_gate', true) equals the row's id
 * when it enters DONE. transitionJobTask sets it — transaction-local, for that one job — only for the
 * CLOSING → DONE edge, after the state machine accepted a valid CloseGateToken and the token was
 * consumed, immediately before the UPDATE. Nothing else in the codebase sets this name.
 */
export const CLOSE_GATE_SETTING = "firm_os.close_gate";

export interface JobTaskDb {
  $transaction<R>(fn: (tx: JobTaskTx) => Promise<R>): PromiseLike<R>;
}

// ------------------------------------------------------------------ service

export type TransitionOptions = {
  /** The state the caller saw. Refused with CONFLICT if the row has moved since. */
  expectedState: JobTaskState;
  note?: string | null;
  ackRef?: string | null;
  gateToken?: CloseGateToken | null;
  /** Injected clock (tests); defaults to the real time. */
  now?: Date;
};

export type TransitionResult =
  | { ok: true; jobTaskId: string; from: JobTaskState; to: JobTaskState; edge: EdgeName; eventId: string; at: Date }
  | { ok: false; code: DenyCode | "NOT_FOUND" | "CONFLICT"; reason: string };

/** Data written for a transition into `to` (pure; exported for tests and the admin page). */
export function updateFor(to: JobTaskState, from: JobTaskState, actor: Actor, ackRef: string | null, now: Date): JobTaskUpdate {
  if (to === "FILED_BY_HUMAN") {
    return { state: to, filedAt: now, filedById: actor.kind === "human" ? actor.userId : null, ackRef };
  }
  if (to === "DONE") return { state: to, doneAt: now };
  if (to === "APPROVED" && (from === "FILED_BY_HUMAN" || from === "CLOSING")) {
    // Retracted filing: the confirmation no longer stands. The old ref is kept in the event note.
    return { state: to, filedAt: null, filedById: null, ackRef: null };
  }
  return { state: to };
}

function eventNote(row: JobTaskRow, to: JobTaskState, note: string | null, ackRef: string | null): string | null {
  const parts: string[] = [];
  if (note?.trim()) parts.push(note.trim());
  if (to === "FILED_BY_HUMAN" && ackRef) parts.push(`ack ref ${ackRef}`);
  if (to === "APPROVED" && row.ackRef && (row.state === "FILED_BY_HUMAN" || row.state === "CLOSING")) parts.push(`retracted ack ref ${row.ackRef}`);
  return parts.length ? parts.join(" · ") : null;
}

export async function transitionJobTask(
  db: JobTaskDb,
  jobTaskId: string,
  to: JobTaskState,
  actor: Actor,
  opts: TransitionOptions,
): Promise<TransitionResult> {
  const now = opts.now ?? new Date();
  return db.$transaction(async (tx): Promise<TransitionResult> => {
    const row = await tx.jobTask.findUnique({ where: { id: jobTaskId }, select: ROW_SELECT });
    if (!row) return { ok: false, code: "NOT_FOUND", reason: `JobTask ${jobTaskId} not found` };
    if (row.state !== opts.expectedState) {
      return { ok: false, code: "CONFLICT", reason: `Job moved to ${row.state} since you loaded it (expected ${opts.expectedState}); reload and try again` };
    }

    let blockingFailures = 0;
    if (row.state === "IN_REVIEW" && to === "APPROVED") {
      const run = await tx.agentRun.findFirst({ where: { jobTaskId }, orderBy: { startedAt: "desc" }, select: { id: true } });
      if (run) blockingFailures = await tx.checklistResult.count({ where: { agentRunId: run.id, severity: "block", status: "fail" } });
    }

    const ackRef = opts.ackRef?.trim() || null;
    const decision = canTransition(row.state, to, {
      actor,
      jobTaskId,
      service: row.service,
      assigneeId: row.assigneeId,
      reviewerId: row.reviewerId,
      blockingFailures,
      note: opts.note ?? null,
      ackRef,
      gateToken: opts.gateToken ?? null,
      now,
    });
    if (!decision.ok) return decision;

    if (to === "DONE") {
      if (!consumeCloseGateToken(opts.gateToken as CloseGateToken)) return { ok: false, code: "GATE_REQUIRED", reason: "Close gate token already used" };
      // Arm the DONE trigger for this job only, inside this transaction (is_local = true).
      await tx.$queryRaw`SELECT set_config(${CLOSE_GATE_SETTING}, ${jobTaskId}, true)`;
    }

    const updated = await tx.jobTask.updateMany({
      where: { id: jobTaskId, state: row.state, updatedAt: row.updatedAt },
      data: updateFor(to, row.state, actor, ackRef, now),
    });
    if (updated.count !== 1) {
      return { ok: false, code: "CONFLICT", reason: "Job changed while this transition was being saved; reload and try again" };
    }

    const event = await tx.jobTaskEvent.create({
      data: { jobTaskId, fromState: row.state, toState: to, actorId: actorRef(actor), note: eventNote(row, to, opts.note ?? null, ackRef) },
      select: { id: true },
    });
    return { ok: true, jobTaskId, from: row.state, to, edge: decision.edge, eventId: event.id, at: now };
  });
}
