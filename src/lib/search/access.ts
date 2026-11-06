// Who may find what. Every provider reuses the rule of the page that opens the entity, so a
// person never sees a result they could not open:
//
//   clients, client jobs, documents   canViewClients (src/lib/clients/core.ts) — /clients/[id]
//   Firm OS jobs, deliverables        jobScopeWhere (src/lib/agents/access.ts) — staff: jobs they
//                                     prepare or review; managers, partners, admins: all
//   agent runs                        runScopeWhere — the /agents run review page
//   onboarding runs                   canOnboard (src/lib/rbac/policy.ts) — /onboard?run=
//   comms drafts                      the draft page's rule (commsDraftScopeWhere): its author; a job
//                                     draft: the job's assignee or reviewer; a client-level draft:
//                                     the client's primary handler; managers, partners and admins
//
// Inactive (deactivated) people find nothing. Who may search at all is src/lib/rbac/policy.ts
// canSearch (re-exported here, so the module's public API is unchanged).
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { jobScopeWhere, runScopeWhere } from "@/lib/agents/access";
import { canViewClients } from "@/lib/clients/core";
import { canOnboard, canSearch, commsDraftScopeWhere } from "@/lib/rbac/policy";
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

/** Upper bounds on the jobs and handled clients loaded for the draft filter below (as the drafts list). */
const MAX_VISIBLE_JOBS = 5000;
const MAX_HANDLED_CLIENTS = 5000;

/**
 * Prisma filter for the CommsDrafts a person may see: exactly the draft page's rule
 * (src/lib/rbac/policy.ts canViewCommsDraft / commsDraftScopeWhere, as /comms lists them) — the
 * author; a draft about a job: the job's assignee or reviewer; a client-level draft (no job): the
 * client's primary handler; managers, partners and admins: all. CommsDraft has no relation to
 * JobTask or Client, so the ids of the jobs the person may see and of the clients they handle are
 * loaded first (only for people who do not see every draft).
 */
export async function draftScopeWhere(db: SearchDb, user: SessionUser): Promise<Prisma.CommsDraftWhereInput> {
  if (!user || !canFindDrafts(user)) return { id: "__none__" };
  const base = commsDraftScopeWhere(user);
  if (!("OR" in base)) return base; // everyone's drafts ({}), or nobody's
  const [jobs, handled] = await Promise.all([
    db.jobTask.findMany({ where: jobScopeWhere(user), select: { id: true }, take: MAX_VISIBLE_JOBS }),
    db.firmClient.findMany({ where: { client: { primaryHandlerId: user.id } }, select: { id: true }, take: MAX_HANDLED_CLIENTS }),
  ]);
  return commsDraftScopeWhere(user, jobs.map((j) => j.id), handled.map((c) => c.id));
}
