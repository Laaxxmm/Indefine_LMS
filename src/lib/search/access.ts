// Who may find what. Every provider reuses the rule of the page that opens the entity, so a
// person never sees a result they could not open:
//
//   clients, client jobs, documents   canViewClients (src/lib/clients/core.ts) — /clients/[id]
//   Firm OS jobs, deliverables        jobScopeWhere (src/lib/agents/access.ts) — staff: jobs they
//                                     prepare or review; managers, partners, admins: all
//   agent runs                        runScopeWhere — the /agents run review page
//   onboarding runs                   canOnboard (src/lib/rbac/policy.ts) — /onboard?run=
//   comms drafts                      the draft's creator, the assignee of its job, and managers,
//                                     partners and admins (canSeeAllRuns)
//
// Inactive (deactivated) people find nothing. Who may search at all is src/lib/rbac/policy.ts
// canSearch (re-exported here, so the module's public API is unchanged).
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { canSeeAllRuns, jobScopeWhere, runScopeWhere } from "@/lib/agents/access";
import { canViewClients } from "@/lib/clients/core";
import { canOnboard, canSearch } from "@/lib/rbac/policy";
import type { SearchDb } from "./db";

export { canSearch, jobScopeWhere, runScopeWhere };

export const SIGNED_OUT_MESSAGE = "Sign in to search.";
export const INACTIVE_MESSAGE = "Your account is not active, so search is not available. Ask an admin to reactivate it.";
export const canFindClients = (user: SessionUser): boolean => canSearch(user) && canViewClients(user);
export const canFindFirmWork = (user: SessionUser): boolean => canSearch(user);
export const canFindOnboarding = (user: SessionUser): boolean => canSearch(user) && canOnboard(user);
export const canFindDrafts = (user: SessionUser): boolean => canSearch(user);

/** Prisma filter for the Deliverables a person may see (those of jobs they may see). */
export function deliverableScopeWhere(user: SessionUser): Prisma.DeliverableWhereInput {
  return { jobTask: jobScopeWhere(user) };
}

/** Upper bound on the jobs a staff member is assignee of, for the draft filter below. */
const MAX_ASSIGNED_JOBS = 2000;

/**
 * Prisma filter for the CommsDrafts a person may see. CommsDraft has no relation to JobTask in the
 * schema, so the assignee rule is resolved through the ids of the person's assigned jobs.
 */
export async function draftScopeWhere(db: SearchDb, user: SessionUser): Promise<Prisma.CommsDraftWhereInput> {
  if (!user || !canFindDrafts(user)) return { id: "__none__" };
  if (canSeeAllRuns(user)) return {};
  const mine = await db.jobTask.findMany({ where: { assigneeId: user.id }, select: { id: true }, take: MAX_ASSIGNED_JOBS });
  const or: Prisma.CommsDraftWhereInput[] = [{ createdById: user.id }];
  if (mine.length) or.push({ jobTaskId: { in: mine.map((j) => j.id) } });
  return { OR: or };
}
