// Who may see and act on agent runs. Composes src/lib/access.ts; the edge rules themselves come
// from the JobTask state machine (core/state.ts canTransition), so a button is shown exactly when
// the transition behind it would be allowed. To be consolidated with src/lib/rbac/policy.ts
// (Phase 3) once that lands; until then the Firm OS roles are derived here:
//
//   every active user      staff
//   level MANAGER / SENIOR_MANAGER  + manager
//   level PARTNER (isPartner)       + partner
//   role ADMIN (isAdmin)            + admin   (sees everything; state.ts gives admin no job edges)
//
// Staff see only runs of JobTasks assigned to them or where they are the reviewer; managers,
// partners and admins see all runs. Only partners and managers decide MistakeLog promotions.
import type { FirmService, JobTaskState, Prisma } from "@prisma/client";
import { isActive, isAdmin, isPartner, type SessionUser } from "@/lib/access";
import { canTransition, type Actor, type FirmRole } from "@/lib/agents/core/state";

/** Employee levels that act as managers in Firm OS. */
const MANAGER_LEVELS: ReadonlySet<string> = new Set(["MANAGER", "SENIOR_MANAGER"]);

export function firmRolesOf(user: SessionUser): FirmRole[] {
  if (!user || !isActive(user)) return [];
  const roles: FirmRole[] = ["staff"];
  if (MANAGER_LEVELS.has(user.level)) roles.push("manager");
  if (isPartner(user)) roles.push("partner");
  if (isAdmin(user)) roles.push("admin");
  return roles;
}

/** The state-machine actor for a signed-in person (null when inactive / signed out). */
export function actorOf(user: SessionUser): Extract<Actor, { kind: "human" }> | null {
  const roles = firmRolesOf(user);
  return user && roles.length ? { kind: "human", userId: user.id, roles } : null;
}

const has = (user: SessionUser, ...want: FirmRole[]) => firmRolesOf(user).some((r) => want.includes(r));

export const canUseAgents = (user: SessionUser) => isActive(user);
export const canSeeAllRuns = (user: SessionUser) => has(user, "manager", "partner", "admin");
export const canDecideMistakes = (user: SessionUser) => has(user, "manager", "partner");
/** /agents/mistakes: the deciders plus admins, who may look. The nav link and the page guard both use this. */
export const canSeeMistakeLog = (user: SessionUser) => canDecideMistakes(user) || canSeeAllRuns(user);

export type JobAccessView = { id: string; state: JobTaskState; service: FirmService; assigneeId: string | null; reviewerId: string | null };

export function canViewJob(user: SessionUser, job: Pick<JobAccessView, "assigneeId" | "reviewerId">): boolean {
  if (!canUseAgents(user) || !user) return false;
  return canSeeAllRuns(user) || job.assigneeId === user.id || job.reviewerId === user.id;
}

/** Prisma filter for the JobTasks a person may see. */
export function jobScopeWhere(user: SessionUser): Prisma.JobTaskWhereInput {
  if (!user || !canUseAgents(user)) return { id: "__none__" };
  return canSeeAllRuns(user) ? {} : { OR: [{ assigneeId: user.id }, { reviewerId: user.id }] };
}

/** Prisma filter for the AgentRuns a person may see. */
export function runScopeWhere(user: SessionUser): Prisma.AgentRunWhereInput {
  if (!user || !canUseAgents(user)) return { id: "__none__" };
  return canSeeAllRuns(user) ? {} : { jobTask: { OR: [{ assigneeId: user.id }, { reviewerId: user.id }] } };
}

export type ReviewActions = {
  /** Start an agent run (job ASSIGNED or IN_PREP). */
  run: boolean;
  /** AGENT_DONE → IN_REVIEW. */
  submit: boolean;
  /** AGENT_DONE → IN_PREP with a note, then a new run ("Re-run with a note"). */
  rerun: boolean;
  /** IN_REVIEW → IN_PREP with a note, then a new run. */
  requestChanges: boolean;
  /** IN_REVIEW → APPROVED. */
  approve: boolean;
  /** Approval is over block failures: partner + note. */
  approveNeedsNote: boolean;
  /** Log a missed or wrong finding (MistakeLog PROPOSED). */
  proposeMistake: boolean;
};

const NONE: ReviewActions = { run: false, submit: false, rerun: false, requestChanges: false, approve: false, approveNeedsNote: false, proposeMistake: false };

/**
 * What the person may do on a job right now. `blockingFailures` = block-severity failures on the
 * latest run. Decisions reuse canTransition with a placeholder note where the edge needs one (the
 * route still requires the real note).
 */
export function reviewActions(user: SessionUser, job: JobAccessView, blockingFailures: number, now: Date): ReviewActions {
  const actor = actorOf(user);
  if (!actor || !canViewJob(user, job)) return NONE;
  const ctx = { actor, jobTaskId: job.id, service: job.service, assigneeId: job.assigneeId, reviewerId: job.reviewerId, blockingFailures, now };
  const may = (from: JobTaskState, to: JobTaskState, note: string | null = null) => job.state === from && canTransition(from, to, { ...ctx, note }).ok;
  const preparer = actor.userId === job.assigneeId || has(user, "manager", "partner");
  return {
    run: (job.state === "ASSIGNED" && may("ASSIGNED", "IN_PREP")) || (job.state === "IN_PREP" && preparer),
    submit: may("AGENT_DONE", "IN_REVIEW"),
    rerun: may("AGENT_DONE", "IN_PREP", "note"),
    requestChanges: may("IN_REVIEW", "IN_PREP", "note"),
    approve: may("IN_REVIEW", "APPROVED", "note"),
    approveNeedsNote: job.state === "IN_REVIEW" && blockingFailures > 0,
    proposeMistake: true,
  };
}
