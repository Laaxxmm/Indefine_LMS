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
//   Daily Coach (board, heartbeat)       every active person, for their own data only
//   change coach preferences / dismiss   the person themself (nobody else, not even a partner or admin)
//   see a coach event                    the person; their manager sees their weekly summary only
//   pair / use the Companion extension   active admins and partners, or anyone an admin switched it on for
//   revoke a Companion pairing           its owner, while active (even after access was switched off)
//   correct a record (allow-listed)      per field: management (admins, partners) / a partner or the
//                                        assignee's manager / the record's creator
//   see a record's correction history    whoever may see the record
//   privacy requests, erasure decisions  active admins and partners
//   breach register                      active admins and partners
//   lift a DPDP processing restriction   partner only
//   search                               every active person (each result type scoped by its own page rule)
//   workspace settings (modules, focus)  active admins only
//   reveal a client's PAN / phone / email  management: whoever may edit the client (canManageClients)
//
// Entra group mapping (Partners / Staff security groups) is Blocked: the session does not carry
// group ids today (docs/inventory.md G-4). ENTRA_GROUP_ROLES and roleFromEntraGroups() are the hook:
// once the Entra app emits a `groups` claim and auth.ts copies it onto session.user.groups,
// firmRole() should prefer roleFromEntraGroups(user.groups) and fall back to the level mapping.
import type { Prisma } from "@prisma/client";
import { isActive, isAdmin, isManagement, isManager, isPartner, type SessionUser } from "@/lib/access";
import { canManageClients, canViewClients } from "@/lib/clients/core";
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
 * Open or continue one onboarding run (answer, plan, create, resume, Turia confirm, view): the
 * person who started it, or a partner (level PARTNER, admin-partners included). Other managers
 * and admins start their own. Start itself is canOnboard.
 */
export function canOpenOnboardingRun(user: SessionUser, run: { createdById: string }): boolean {
  if (!canOnboard(user) || !user) return false;
  return user.id === run.createdById || isPartner(user);
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

/** The job (or, for a client-level draft, the client) a comms draft is about, as far as access needs it. */
export type CommsDraftAccessView = {
  createdById: string;
  job?: { assigneeId: string | null; reviewerId: string | null } | null;
  /** The LMS client's primary handler (Client.primaryHandlerId); decides job-less drafts. */
  client?: { primaryHandlerId: string | null } | null;
};

/**
 * A client comms draft (Phase 10): its author; for a draft about a job, the job's assignee or
 * reviewer; for a client-level draft (no job), the client's primary handler; managers, partners
 * and admins see all. Working on some other job of the client does not open a client-level draft.
 */
export function canViewCommsDraft(user: SessionUser, draft: CommsDraftAccessView): boolean {
  if (!user || !canUseAgents(user)) return false;
  if (canSeeAllRuns(user) || draft.createdById === user.id) return true;
  if (draft.job) return canViewJob(user, draft.job);
  return !!draft.client?.primaryHandlerId && draft.client.primaryHandlerId === user.id;
}

/**
 * Prisma filter for the comms drafts a person may see. CommsDraft has no relation to JobTask or
 * Client, so the caller passes, for staff, the ids of the jobs the person may see (from
 * jobScopeWhere) and of the Firm OS clients whose LMS client they are primary handler of. A
 * client-level draft (no job) matches only through the second list.
 */
export function commsDraftScopeWhere(user: SessionUser, visibleJobIds: readonly string[] = [], handledFirmClientIds: readonly string[] = []): Prisma.CommsDraftWhereInput {
  if (!user || !canUseAgents(user)) return { id: "__none__" };
  if (canSeeAllRuns(user)) return {};
  const or: Prisma.CommsDraftWhereInput[] = [{ createdById: user.id }];
  if (visibleJobIds.length) or.push({ jobTaskId: { in: [...visibleJobIds] } });
  if (handledFirmClientIds.length) or.push({ jobTaskId: null, firmClientId: { in: [...handledFirmClientIds] } });
  return { OR: or };
}

// ------------------------------------------------------------------ Daily Coach (Phase 9)
// Coach data is personal (ADR-006): no role sees another person's notices, heartbeats or breaks.

/** The coach board, notices and break-nudge heartbeat: every active person, for their own data only. */
export function canUseCoach(user: SessionUser): boolean {
  return isActive(user);
}

/**
 * Change coach preferences (break reminders, snooze, morning board): the person themself, while
 * active. Routes pass the session's own id as `ownerId`; nobody (manager, partner, admin) may
 * change someone else's.
 */
export function canManageOwnCoachPrefs(user: SessionUser, ownerId: string): boolean {
  return canUseCoach(user) && !!user && user.id === ownerId;
}

/** Dismiss a coach notice: only the person it was raised for (routes check canUseCoach first). */
export function canDismissCoachEvent(viewer: { id: string } | null | undefined, event: { userId: string }): boolean {
  return !!viewer && event.userId === viewer.id;
}

/**
 * See a coach event: the person sees every event of theirs; their manager (User.managerId) sees
 * their weekly summary only, never anything else; nobody else sees anything (break nudges and
 * heartbeats are the person's alone, ADR-006).
 */
export function canViewCoachEvent(viewer: { id: string } | null | undefined, event: { userId: string; kind: string }, owner: { managerId: string | null } | null): boolean {
  if (!viewer) return false;
  if (event.userId === viewer.id) return true;
  return event.kind === "summary" && !!owner?.managerId && owner.managerId === viewer.id;
}

// ------------------------------------------------------------------ Companion extension

/**
 * Pair the Companion side panel, and use a pairing (every next-task call re-checks this): active,
 * and either an admin or partner, or someone an admin switched it on for
 * (WorkspaceSetting.companionEnabled, read by the caller; false when there is no row).
 */
export function canPairCompanion(user: SessionUser, companionEnabled: boolean): boolean {
  if (!user || !isActive(user)) return false;
  return companionEnabled || isAdmin(user) || isPartner(user);
}

/** Revoke a pairing: its owner, while active — even after companion access was switched off. */
export function canRevokePairing(user: SessionUser, pairing: { userId: string }): boolean {
  return !!user && isActive(user) && pairing.userId === user.id;
}

// ------------------------------------------------------------------ corrections (Phase 15)

/** Who an allow-listed field names as its corrector (src/lib/corrections/allowlist.ts). */
export type CorrectorRule = "management" | "job-manager" | "creator";
export type CorrectionContext = {
  /** CommsDraft.createdById. */
  createdById?: string | null;
  /** managerId of the record's current assignee (JobTask / Engagement). */
  assigneeManagerId?: string | null;
};

/**
 * Correct one allow-listed field, by the rule the field names:
 *   management   whoever may edit the client on /clients (canManageClients: active admins, partners)
 *   job-manager  an active partner, or the line manager of the record's current assignee
 *   creator      the active person who created the record
 */
export function canCorrect(user: SessionUser, who: CorrectorRule, ctx: CorrectionContext): boolean {
  if (!user || !isActive(user)) return false;
  if (who === "management") return canManageClients(user);
  if (who === "job-manager") return isPartner(user) || (!!ctx.assigneeManagerId && ctx.assigneeManagerId === user.id);
  return !!ctx.createdById && ctx.createdById === user.id;
}

export type CorrectionRecordKind = "FirmClient" | "Client" | "JobTask" | "Engagement" | "CommsDraft";
export type CorrectionViewContext = { assigneeId?: string | null; reviewerId?: string | null; createdById?: string | null };

/**
 * See a record's correction history: whoever may see the record — any active person for clients
 * (canViewClients), the creator or management for drafts, the job's people plus managers,
 * partners and admins for jobs and engagements.
 */
export function canViewCorrectionHistory(user: SessionUser, entity: CorrectionRecordKind, ctx: CorrectionViewContext): boolean {
  if (!user || !isActive(user)) return false;
  if (entity === "Client" || entity === "FirmClient") return canViewClients(user);
  if (entity === "CommsDraft") return isManagement(user) || (!!ctx.createdById && ctx.createdById === user.id);
  return canSeeAllRuns(user) || isPartner(user) || ctx.assigneeId === user.id || ctx.reviewerId === user.id;
}

// ------------------------------------------------------------------ DPDP privacy and breaches

/** Work the DPDP request register (log, verify, export, correct, restrict, nominate, close): active admins and partners. */
export function canHandlePrivacyRequests(user: SessionUser): boolean {
  return isActive(user) && isManagement(user);
}

/** Confirm an erasure plan (anonymise / legal hold): active admins and partners. */
export function canDecideErasure(user: SessionUser): boolean {
  return canHandlePrivacyRequests(user);
}

/** Record or update a personal data breach (docs/runbooks/breach.md): active admins and partners. */
export function canManageBreaches(user: SessionUser): boolean {
  return isActive(user) && isManagement(user);
}

/**
 * Lift a DPDP processing restriction (consent withdrawal or erasure hold): partner only. Lifting
 * lets AI processing and drafting resume for the person, so it takes a partner's decision and a
 * written reason (AuditEvent), never an admin's.
 */
export function canLiftRestriction(user: SessionUser): boolean {
  return activePartner(user);
}

// ------------------------------------------------------------------ search, workspace, client PII

/** Firm OS search (/search, the command palette, identifier lookups): every active person. Each result type is scoped by the rule of the page that opens it. */
export function canSearch(user: SessionUser): boolean {
  return isActive(user);
}

/** Workspace settings (role defaults, a person's modules, focus mode, Companion switch): active admins only. */
export function canManageWorkspace(user: SessionUser): boolean {
  return isActive(user) && isAdmin(user);
}

/**
 * See a client's full PAN, GSTIN, phone or email on /clients/[id] (everyone else sees them masked):
 * management — whoever may edit the client today (canManageClients: active admins and partners).
 * Each reveal is an AuditEvent.
 */
export function canRevealClientPii(user: SessionUser): boolean {
  return canManageClients(user);
}

/** Labels for chips and messages. */
export const FIRM_ROLE_LABELS: Record<FirmRole, string> = {
  admin: "Admin",
  partner: "Partner",
  manager: "Manager",
  staff: "Staff",
};
