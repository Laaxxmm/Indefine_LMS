// Firm OS access policy (Phase 11): one place to answer "who may do X". Roles are derived from the
// existing LMS session fields through src/lib/access.ts, never from role/level string literals here.
//
//   admin    role = ADMIN                      (IT: sees everything, takes no job edges)
//   partner  level = PARTNER
//   manager  level = MANAGER or SENIOR_MANAGER
//   staff    everyone else (and anyone not signed in)
//
// The per-job rules for agent runs live next to the agent framework (src/lib/agents/access.ts) and
// the edge rules in the JobTask state machine (src/lib/agents/core/state.ts). This module composes
// and re-exports them, so routes, pages and scripts/verify-rbac.ts import policy from one place.
// Nothing here touches the database. The decisions, in one table:
//
//   see a job / its runs / its files     assignee or reviewer; managers, partners, admins see all
//   act on a job (close-loop actions)    assignee or reviewer, manager or partner (not admin)
//   onboard a client (/onboard)          partner, manager, admin
//   approve SOP rule changes (MistakeLog decisions → new SopPack version)   partner only
//   change thresholds (accuracy gates, guardrail rates, retention windows)   partner only
//   retract a filing confirmation        manager or partner (state.ts retract-filing edge)
//   set a job DONE                       nobody: only the close-loop gate, with a token (ADR-005)
//   spot-check manual Turia closes       partner only
//   see a client comms draft             its author, the job's assignee/reviewer; managers, partners, admins
//
// Entra group mapping (Partners / Staff security groups) is Blocked: the session does not carry
// group ids today (docs/inventory.md G-4). ENTRA_GROUP_ROLES and roleFromEntraGroups() are the hook:
// once the Entra app emits a `groups` claim and auth.ts copies it onto session.user.groups,
// firmRole() should prefer roleFromEntraGroups(user.groups) and fall back to the level mapping.
import type { Prisma } from "@prisma/client";
import { isActive, isAdmin, isManager, isPartner, type SessionUser } from "@/lib/access";
import {
  canDecideMistakes,
  canSeeAllRuns,
  canSeeMistakeLog,
  canUseAgents,
  canViewJob,
  jobScopeWhere,
  reviewActions,
  runScopeWhere,
} from "@/lib/agents/access";

export { canDecideMistakes, canSeeAllRuns, canSeeMistakeLog, canUseAgents, canViewJob, jobScopeWhere, reviewActions, runScopeWhere };

export type FirmRole = "admin" | "partner" | "manager" | "staff";

/** Entra security group object id → Firm OS role (orchestrator spec). Not wired yet — see header. */
export const ENTRA_GROUP_ROLES: Readonly<Record<string, FirmRole>> = {
  "e5583268-4c8c-4abf-8b35-3ef1f0d37a78": "partner",
  "67ed1191-302b-495a-913b-b93cc6ee118d": "staff",
};

const RANK: Record<FirmRole, number> = { staff: 0, manager: 1, partner: 2, admin: 3 };

/** Highest role granted by the given Entra group ids, or null when none is mapped. */
export function roleFromEntraGroups(groupIds: readonly string[] | null | undefined): FirmRole | null {
  let best: FirmRole | null = null;
  for (const id of groupIds ?? []) {
    const role = ENTRA_GROUP_ROLES[id.toLowerCase()];
    if (role && (best === null || RANK[role] > RANK[best])) best = role;
  }
  return best;
}

export function firmRole(user: SessionUser): FirmRole {
  if (isAdmin(user)) return "admin";
  if (isPartner(user)) return "partner";
  if (isManager(user)) return "manager";
  return "staff";
}

/** Active partner (an LMS admin who is also a partner keeps partner rights). */
const activePartner = (user: SessionUser) => isActive(user) && isPartner(user);
/** Active manager or partner. */
const activeManagerUp = (user: SessionUser) => isActive(user) && (isPartner(user) || isManager(user));

/** Plain-English onboarding (/onboard): partners, managers and admins, and only while active. */
export function canOnboard(user: SessionUser): boolean {
  return isActive(user) && firmRole(user) !== "staff";
}

/**
 * Close-loop actions on a job (mark filed, record the Turia close, other state edges): the job's
 * assignee or reviewer, a manager or a partner, and only while active. Admin (IT) takes no job edges.
 */
export function canActOnJob(user: SessionUser, job: { assigneeId: string | null; reviewerId: string | null }): boolean {
  if (!user || !isActive(user)) return false;
  return activeManagerUp(user) || user.id === job.assigneeId || user.id === job.reviewerId;
}

/** SOP rule changes: approving or rejecting a MistakeLog proposal (approval mints a new SopPack version). Partner only. */
export const canApproveSopRuleChange = (user: SessionUser): boolean => canDecideMistakes(user);

/**
 * Changing a threshold: accuracy gates, guardrail breach rates (GUARDRAIL_MAX_*), retention windows,
 * rate limits. Partner only, and an ADR records the reason (orchestrator FAILURE RULES). No route
 * changes a threshold today (they are env + code); any future one must call this.
 */
export function canChangeThresholds(user: SessionUser): boolean {
  return activePartner(user);
}

/** Retract a filing confirmation (FILED_BY_HUMAN / CLOSING → APPROVED, note required): manager or partner. */
export function canRetractFiling(user: SessionUser): boolean {
  return activeManagerUp(user);
}

/** Nobody sets DONE by hand: only src/lib/close-loop/gate.ts, with a CloseGateToken (ADR-005). */
export function canSetDone(user: SessionUser): false {
  void user;
  return false;
}

/** Partner spot-check of manual Turia closes (/agents/spot-checks). Partner only. */
export function canSpotCheck(user: SessionUser): boolean {
  return activePartner(user);
}

/** The job a comms draft is about, as far as access needs it. */
export type CommsDraftAccessView = {
  createdById: string;
  job?: { assigneeId: string | null; reviewerId: string | null } | null;
};

/** A client comms draft (Phase 10): its author, the job's assignee or reviewer; managers, partners and admins see all. */
export function canViewCommsDraft(user: SessionUser, draft: CommsDraftAccessView): boolean {
  if (!user || !canUseAgents(user)) return false;
  if (canSeeAllRuns(user) || draft.createdById === user.id) return true;
  return !!draft.job && canViewJob(user, draft.job);
}

/**
 * Prisma filter for the comms drafts a person may see. CommsDraft has no relation to JobTask, so
 * the caller passes the ids of the jobs the person may see (from jobScopeWhere) for staff.
 */
export function commsDraftScopeWhere(user: SessionUser, visibleJobIds: readonly string[] = []): Prisma.CommsDraftWhereInput {
  if (!user || !canUseAgents(user)) return { id: "__none__" };
  if (canSeeAllRuns(user)) return {};
  const or: Prisma.CommsDraftWhereInput[] = [{ createdById: user.id }];
  if (visibleJobIds.length) or.push({ jobTaskId: { in: [...visibleJobIds] } });
  return { OR: or };
}

/** Labels for chips and messages. */
export const FIRM_ROLE_LABELS: Record<FirmRole, string> = {
  admin: "Admin",
  partner: "Partner",
  manager: "Manager",
  staff: "Staff",
};
