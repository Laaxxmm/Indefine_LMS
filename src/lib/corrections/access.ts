// Who may correct what. The rules live in src/lib/rbac/policy.ts (canCorrect,
// canViewCorrectionHistory); this module keeps its public API and delegates.
//
//   management   canManageClients (src/lib/clients/core.ts): active admins and partners — the same
//                people who may edit a client on /clients
//   job-manager  an active partner (isPartner), or the line manager of the record's current
//                assignee (User.managerId, set in /admin/team)
//   creator      the active person who created the record (CommsDraft.createdById)
//
// Viewing a record's correction history follows who may see the record: any active person for
// clients (canViewClients), the job's people plus managers / partners / admins for jobs and
// engagements (canSeeAllRuns from src/lib/agents/access.ts), and the creator or management for drafts.
import type { SessionUser } from "@/lib/access";
import { canCorrect, canViewCorrectionHistory } from "@/lib/rbac/policy";
import type { CorrectionEntity, Who } from "./allowlist";

export interface PermissionContext {
  /** CommsDraft.createdById. */
  createdById?: string | null;
  /** managerId of the record's current assignee (JobTask / Engagement). */
  assigneeManagerId?: string | null;
}

export function mayCorrect(user: SessionUser, who: Who, ctx: PermissionContext): boolean {
  return canCorrect(user, who, ctx);
}

export const NOT_ALLOWED_MESSAGE: Record<Who, string> = {
  management: "Only admins and partners can correct client master details. Ask one of them to make this change.",
  "job-manager": "Only a partner or the assignee's manager can correct this. Ask one of them to make this change.",
  creator: "Only the person who wrote this draft can correct it. Ask them to make the change.",
};

export interface ViewContext {
  assigneeId?: string | null;
  reviewerId?: string | null;
  createdById?: string | null;
}

export function mayViewHistory(user: SessionUser, entity: CorrectionEntity, ctx: ViewContext): boolean {
  return canViewCorrectionHistory(user, entity, ctx);
}
