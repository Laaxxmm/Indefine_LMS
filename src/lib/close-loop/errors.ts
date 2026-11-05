// Typed failures for close-loop actions. Route handlers map `code` to an HTTP status
// (src/lib/close-loop/http.ts); nothing here knows about HTTP.
import type { TransitionResult } from "@/lib/agents/core/state-db";

export type CloseLoopErrorCode = "not-found" | "forbidden" | "invalid" | "conflict" | "state" | "gate-required";

export class CloseLoopError extends Error {
  readonly code: CloseLoopErrorCode;
  constructor(code: CloseLoopErrorCode, message: string) {
    super(message);
    this.name = "CloseLoopError";
    this.code = code;
  }
}

const DENY_TO_CODE: Record<string, CloseLoopErrorCode> = {
  NOT_FOUND: "not-found",
  CONFLICT: "conflict",
  FORBIDDEN: "forbidden",
  SELF_APPROVAL: "forbidden",
  BLOCKING_FAILURES: "forbidden",
  GATE_REQUIRED: "gate-required",
  UNKNOWN_STATE: "state",
  SAME_STATE: "state",
  ILLEGAL_EDGE: "state",
  NOTE_REQUIRED: "invalid",
  ASSIGNEE_REQUIRED: "invalid",
  ACK_REF_REQUIRED: "invalid",
  ACK_REF_INVALID: "invalid",
};

/** A refused transition as a CloseLoopError (the state machine's reason is kept verbatim). */
export function transitionError(r: Extract<TransitionResult, { ok: false }>): CloseLoopError {
  return new CloseLoopError(DENY_TO_CODE[r.code] ?? "state", r.reason);
}
