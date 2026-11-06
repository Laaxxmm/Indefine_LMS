// JobTask state machine (ADR-005). Pure rules: no Prisma, no fetch, no clock reads (the caller
// passes `now`). src/lib/agents/core/state-db.ts applies a transition inside one transaction.
//
//   DRAFT → ASSIGNED → IN_PREP → AGENT_DONE → IN_REVIEW → APPROVED → FILED_BY_HUMAN → CLOSING → DONE
//
// Backward edges (each needs a note, each is appended to JobTaskEvent like any other):
//   AGENT_DONE → IN_PREP        re-run the agent
//   IN_REVIEW  → IN_PREP        reviewer "Request changes"
//   FILED_BY_HUMAN → APPROVED   retract a filing confirmation entered by mistake (manager/partner)
//   CLOSING    → APPROVED       same, after closing started (wrong ack ref, filed in error)
// Deliberately absent: CLOSING → FILED_BY_HUMAN (a wrong ack ref is corrected by retracting to
// APPROVED and confirming again, so the history shows both refs), any edge out of DONE (the
// reconciler raises an alert instead of reopening, ADR-005), any edge into DRAFT, self-loops.
//
// DONE is impossible through this module alone. CLOSING → DONE needs a CloseGateToken, an opaque
// object that only the close-loop gate can mint: the gate calls registerCloseGate() once at module
// load and keeps the returned minter private. registerCloseGate is NOT re-exported from the barrel,
// can be claimed only once per module instance, and a repo-scan test (state.test.ts) fails if any
// file other than src/lib/close-loop/gate.ts (and this module's own tests) mentions it.
import type { FirmService, JobTaskState } from "@prisma/client";

// ------------------------------------------------------------------ states

export const JOB_TASK_STATES = [
  "DRAFT",
  "ASSIGNED",
  "IN_PREP",
  "AGENT_DONE",
  "IN_REVIEW",
  "APPROVED",
  "FILED_BY_HUMAN",
  "CLOSING",
  "DONE",
] as const satisfies readonly JobTaskState[];

// Compile-time: the list above covers every Prisma enum member (and nothing else).
type Missing = Exclude<JobTaskState, (typeof JOB_TASK_STATES)[number]>;
const _exhaustive: Missing extends never ? true : never = true;
void _exhaustive;

export type { JobTaskState };

export const isJobTaskState = (s: unknown): s is JobTaskState =>
  typeof s === "string" && (JOB_TASK_STATES as readonly string[]).includes(s);

// ------------------------------------------------------------------ actors

/** Firm OS roles (orchestrator ARCHITECTURE; mapped from Entra groups by src/lib/rbac later). */
export type FirmRole = "partner" | "manager" | "staff" | "admin";

export type Actor =
  | { kind: "human"; userId: string; roles: readonly FirmRole[] }
  | { kind: "agent"; runId: string }
  | { kind: "system"; name: string };

/** Value stored in JobTaskEvent.actorId: a user id, or `agent:<runId>` / `system:<name>`. */
export function actorRef(actor: Actor): string {
  if (actor.kind === "human") return actor.userId;
  if (actor.kind === "agent") return `agent:${actor.runId}`;
  return `system:${actor.name}`;
}

const hasRole = (actor: Actor, ...roles: FirmRole[]) =>
  actor.kind === "human" && actor.roles.some((r) => roles.includes(r));
const isManagerUp = (actor: Actor) => hasRole(actor, "manager", "partner");
const isUser = (actor: Actor, id: string | null | undefined) => actor.kind === "human" && !!id && actor.userId === id;

// ------------------------------------------------------------------ acknowledgement refs

/**
 * Services whose filing produces a portal acknowledgement (GST ARN, MCA SRN, ITR / TDS ack no.).
 * FILED_BY_HUMAN for these needs the reference typed by the person who filed. It is stored, never
 * verified against a portal (Firm OS never contacts one). Books / Audit / Engagement have none.
 */
export const ACK_REF_REQUIRED: Readonly<Record<FirmService, boolean>> = {
  GST: true,
  ROC: true,
  IncomeTax: true,
  TDS: true,
  Books: false,
  Audit: false,
  Engagement: false,
};
export const ACK_REF_MAX = 64;
const ACK_REF_RE = /^[A-Za-z0-9][A-Za-z0-9/\-_. ]*$/;

// ------------------------------------------------------------------ close gate token

declare const CLOSE_GATE_BRAND: unique symbol;

/** Opaque proof, minted only by src/lib/close-loop/gate.ts, that the ADR-005 close conditions held. */
export type CloseGateToken = {
  readonly [CLOSE_GATE_BRAND]: true;
  readonly jobTaskId: string;
  readonly mintedAt: Date;
  readonly expiresAt: Date;
  readonly evidence: Readonly<Record<string, unknown>>;
};

export type CloseGateMinter = (args: {
  jobTaskId: string;
  now: Date;
  evidence: Readonly<Record<string, unknown>>;
}) => CloseGateToken;

/** A token is good for one transition, for this long after minting. */
export const CLOSE_GATE_TOKEN_TTL_MS = 60_000;

// WeakMap, not Set: tokens are never enumerated and consumption only flips a flag.
const mintedTokens = new WeakMap<object, { consumed: boolean }>();
let gateRegistered = false;

/**
 * Claim the single minter for CloseGateTokens. Only src/lib/close-loop/gate.ts may call this
 * (enforced by the repo-scan test in state.test.ts); a second call in the same module instance
 * throws, so a rogue caller that claims first breaks the real gate loudly instead of silently.
 */
export function registerCloseGate(): CloseGateMinter {
  if (gateRegistered) throw new Error("Close gate already registered: only src/lib/close-loop/gate.ts may mint DONE tokens");
  gateRegistered = true;
  return ({ jobTaskId, now, evidence }) => {
    if (!jobTaskId) throw new Error("CloseGateToken needs a jobTaskId");
    const token = Object.freeze({
      jobTaskId,
      mintedAt: new Date(now.getTime()),
      expiresAt: new Date(now.getTime() + CLOSE_GATE_TOKEN_TTL_MS),
      evidence: Object.freeze({ ...evidence }),
    }) as unknown as CloseGateToken;
    mintedTokens.set(token, { consumed: false });
    return token;
  };
}

export type GateTokenProblem = "MISSING" | "FORGED" | "CONSUMED" | "WRONG_JOB" | "EXPIRED";

/** Why a token cannot close `jobTaskId` at `now`, or null when it can. Reads, never consumes. */
export function gateTokenProblem(token: unknown, jobTaskId: string, now: Date): GateTokenProblem | null {
  if (token == null) return "MISSING";
  if (typeof token !== "object") return "FORGED";
  const entry = mintedTokens.get(token);
  if (!entry) return "FORGED";
  if (entry.consumed) return "CONSUMED";
  const t = token as CloseGateToken;
  if (t.jobTaskId !== jobTaskId) return "WRONG_JOB";
  if (now.getTime() > t.expiresAt.getTime() || now.getTime() < t.mintedAt.getTime()) return "EXPIRED";
  return null;
}

/** Marks a valid token used (state-db calls this inside the DONE transaction). Returns false if it was not usable. */
export function consumeCloseGateToken(token: CloseGateToken): boolean {
  const entry = mintedTokens.get(token);
  if (!entry || entry.consumed) return false;
  entry.consumed = true;
  return true;
}

// ------------------------------------------------------------------ words for people

/** A job's stage in words, for refusal sentences (the chips show the state names themselves). */
export const STATE_WORDS: Readonly<Record<JobTaskState, string>> = {
  DRAFT: "Still a draft",
  ASSIGNED: "Assigned",
  IN_PREP: "In preparation",
  AGENT_DONE: "Prepared by the agent",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  FILED_BY_HUMAN: "Filed",
  CLOSING: "Closing",
  DONE: "Done",
};

const SERVICE_WORDS: Readonly<Record<FirmService, string>> = { GST: "GST", ROC: "ROC", IncomeTax: "income tax", TDS: "TDS", Books: "books", Audit: "audit", Engagement: "engagement" };

const GATE_PROBLEM_WORDS: Readonly<Record<GateTokenProblem, string>> = {
  MISSING: "they have not been run for this job",
  FORGED: "the closing check was not valid",
  CONSUMED: "that closing check was already used",
  WRONG_JOB: "that closing check was for a different job",
  EXPIRED: "the closing check has expired",
};

// ------------------------------------------------------------------ edges

export type TransitionContext = {
  actor: Actor;
  jobTaskId: string;
  service: FirmService;
  assigneeId?: string | null;
  reviewerId?: string | null;
  /** Block-severity checklist failures on the latest agent run (state-db counts them). */
  blockingFailures?: number;
  note?: string | null;
  ackRef?: string | null;
  gateToken?: CloseGateToken | null;
  now: Date;
};

export type DenyCode =
  | "UNKNOWN_STATE"
  | "SAME_STATE"
  | "ILLEGAL_EDGE"
  | "FORBIDDEN"
  | "NOTE_REQUIRED"
  | "ASSIGNEE_REQUIRED"
  | "ACK_REF_REQUIRED"
  | "ACK_REF_INVALID"
  | "SELF_APPROVAL"
  | "BLOCKING_FAILURES"
  | "GATE_REQUIRED";

export type TransitionDecision =
  | { ok: true; edge: EdgeName }
  | { ok: false; code: DenyCode; reason: string };

export type EdgeName =
  | "assign"
  | "start-prep"
  | "agent-finished"
  | "submit-manual-prep"
  | "rerun-agent"
  | "submit-for-review"
  | "request-changes"
  | "approve"
  | "confirm-filed"
  | "start-closing"
  | "retract-filing"
  | "close";

type EdgeDef = {
  from: JobTaskState;
  to: JobTaskState;
  name: EdgeName;
  /** Who may take the edge, in words (for the docs and error messages). */
  who: string;
  check: (ctx: TransitionContext) => { code: DenyCode; reason: string } | null;
};

const deny = (code: DenyCode, reason: string) => ({ code, reason });
const hasNote = (ctx: TransitionContext) => !!ctx.note && ctx.note.trim().length > 0;

const preparerOrManager = (ctx: TransitionContext) =>
  isUser(ctx.actor, ctx.assigneeId) || isManagerUp(ctx.actor) ? null : deny("FORBIDDEN", "Only the person the job is assigned to, a manager or a partner can do this. Ask one of them.");

const EDGES: readonly EdgeDef[] = [
  {
    from: "DRAFT",
    to: "ASSIGNED",
    name: "assign",
    who: "manager or partner; the job must have an assignee",
    check: (ctx) => {
      if (!isManagerUp(ctx.actor)) return deny("FORBIDDEN", "Only a manager or a partner can assign a job. Ask one of them.");
      if (!ctx.assigneeId) return deny("ASSIGNEE_REQUIRED", "Choose who will prepare the job, then assign it.");
      return null;
    },
  },
  {
    from: "ASSIGNED",
    to: "IN_PREP",
    name: "start-prep",
    who: "the assignee, a manager or partner, or the agent runner",
    check: (ctx) => (ctx.actor.kind === "agent" ? null : preparerOrManager(ctx)),
  },
  {
    from: "IN_PREP",
    to: "AGENT_DONE",
    name: "agent-finished",
    who: "the agent runner only",
    check: (ctx) => (ctx.actor.kind === "agent" ? null : deny("FORBIDDEN", "Only the agent can mark its pack as ready. Run the agent, or submit your own preparation for review.")),
  },
  {
    from: "IN_PREP",
    to: "IN_REVIEW",
    name: "submit-manual-prep",
    who: "the assignee, a manager or partner (work prepared without an agent)",
    check: preparerOrManager,
  },
  {
    from: "AGENT_DONE",
    to: "IN_PREP",
    name: "rerun-agent",
    who: "the assignee, a manager or partner; note required",
    check: (ctx) => preparerOrManager(ctx) ?? (hasNote(ctx) ? null : deny("NOTE_REQUIRED", "Add a note saying why the agent should run again.")),
  },
  {
    from: "AGENT_DONE",
    to: "IN_REVIEW",
    name: "submit-for-review",
    who: "the assignee, a manager or partner",
    check: preparerOrManager,
  },
  {
    from: "IN_REVIEW",
    to: "IN_PREP",
    name: "request-changes",
    who: "the job's reviewer, a manager or partner; note required",
    check: (ctx) => {
      if (!isUser(ctx.actor, ctx.reviewerId) && !isManagerUp(ctx.actor))
        return deny("FORBIDDEN", "Only the job's reviewer, a manager or a partner can ask for changes. Ask one of them.");
      return hasNote(ctx) ? null : deny("NOTE_REQUIRED", "Add a note saying what needs to change.");
    },
  },
  {
    from: "IN_REVIEW",
    to: "APPROVED",
    name: "approve",
    who: "the job's reviewer, a manager or partner, not the assignee (a partner may approve own work); block failures need a partner and a note",
    check: (ctx) => {
      const a = ctx.actor;
      if (!isUser(a, ctx.reviewerId) && !isManagerUp(a)) return deny("FORBIDDEN", "Only the job's reviewer, a manager or a partner can approve this pack. Ask one of them.");
      if (isUser(a, ctx.assigneeId) && !hasRole(a, "partner")) return deny("SELF_APPROVAL", "You prepared this job, so someone else must approve it. Ask the reviewer, a manager or a partner.");
      if ((ctx.blockingFailures ?? 0) > 0) {
        if (!hasRole(a, "partner"))
          return deny("BLOCKING_FAILURES", `The checklist has ${ctx.blockingFailures === 1 ? "1 serious problem" : `${ctx.blockingFailures} serious problems`} that stop approval. Fix them and run the agent again, or ask a partner to approve with a note.`);
        if (!hasNote(ctx)) return deny("NOTE_REQUIRED", "Add a note saying why you are approving despite the serious checklist problems.");
      }
      return null;
    },
  },
  {
    from: "APPROVED",
    to: "FILED_BY_HUMAN",
    name: "confirm-filed",
    who: "a named person (staff, manager or partner) who filed it on the portal; ack ref where the service has one",
    check: (ctx) => {
      if (!hasRole(ctx.actor, "staff", "manager", "partner"))
        return deny("FORBIDDEN", "Only a member of the firm's staff can confirm a filing.");
      const ref = ctx.ackRef?.trim() ?? "";
      if (ref) {
        if (ref.length > ACK_REF_MAX || !ACK_REF_RE.test(ref)) return deny("ACK_REF_INVALID", "The acknowledgement number doesn't look right. Copy it again from the portal's acknowledgement, using only letters, digits and dashes.");
      } else if (ACK_REF_REQUIRED[ctx.service]) {
        return deny("ACK_REF_REQUIRED", `Enter the acknowledgement number for this ${SERVICE_WORDS[ctx.service]} filing (the ARN, SRN or acknowledgement number from the portal).`);
      }
      return null;
    },
  },
  {
    from: "FILED_BY_HUMAN",
    to: "CLOSING",
    name: "start-closing",
    who: "the close-loop hook (system) or any staff member",
    check: (ctx) =>
      ctx.actor.kind === "system" || hasRole(ctx.actor, "staff", "manager", "partner")
        ? null
        : deny("FORBIDDEN", "Only a member of the firm's staff can start closing a job."),
  },
  {
    from: "FILED_BY_HUMAN",
    to: "APPROVED",
    name: "retract-filing",
    who: "manager or partner; note required",
    check: (ctx) => retract(ctx),
  },
  {
    from: "CLOSING",
    to: "APPROVED",
    name: "retract-filing",
    who: "manager or partner; note required",
    check: (ctx) => retract(ctx),
  },
  {
    from: "CLOSING",
    to: "DONE",
    name: "close",
    who: "only with a CloseGateToken minted by src/lib/close-loop/gate.ts",
    check: (ctx) => {
      const problem = gateTokenProblem(ctx.gateToken, ctx.jobTaskId, ctx.now);
      return problem ? deny("GATE_REQUIRED", `A job is marked done only when the closing checks pass (${GATE_PROBLEM_WORDS[problem] ?? "the closing check was not valid"}). Run the closing checks again.`) : null;
    },
  },
];

function retract(ctx: TransitionContext) {
  if (!isManagerUp(ctx.actor)) return deny("FORBIDDEN", "Only a manager or a partner can take back a filing confirmation. Ask one of them.");
  return hasNote(ctx) ? null : deny("NOTE_REQUIRED", "Add a note saying why the filing confirmation is being taken back.");
}

const edgeOf = (from: JobTaskState, to: JobTaskState) => EDGES.find((e) => e.from === from && e.to === to);

/** The graph only (no actor checks): is `from → to` an edge at all? */
export function isLegalEdge(from: JobTaskState, to: JobTaskState): boolean {
  return !!edgeOf(from, to);
}

/** States reachable from `from` in one step, in pipeline order. */
export function nextStates(from: JobTaskState): JobTaskState[] {
  return JOB_TASK_STATES.filter((to) => isLegalEdge(from, to));
}

/** The transition table, for docs and the admin page. */
export function transitionTable(): { from: JobTaskState; to: JobTaskState; name: EdgeName; who: string }[] {
  return EDGES.map(({ from, to, name, who }) => ({ from, to, name, who }));
}

/** Full decision: edge exists, actor allowed, preconditions hold. */
export function canTransition(from: JobTaskState, to: JobTaskState, ctx: TransitionContext): TransitionDecision {
  if (!isJobTaskState(from) || !isJobTaskState(to)) return { ok: false, code: "UNKNOWN_STATE", reason: "That job stage isn't one Firm OS knows. Reload the page and try again." };
  if (from === to) return { ok: false, code: "SAME_STATE", reason: `The job is already ${STATE_WORDS[to].toLowerCase()}. Reload the page to see where it is now.` };
  const edge = edgeOf(from, to);
  if (!edge) {
    if (to === "DONE") return { ok: false, code: "GATE_REQUIRED", reason: "A job is marked done only when its closing checks pass. Mark it filed first, then run the closing checks." };
    return { ok: false, code: "ILLEGAL_EDGE", reason: `A job that is ${STATE_WORDS[from].toLowerCase()} can't move to ${STATE_WORDS[to].toLowerCase()}. Reload the page to see the job's current stage.` };
  }
  const problem = edge.check(ctx);
  return problem ? { ok: false, ...problem } : { ok: true, edge: edge.name };
}
