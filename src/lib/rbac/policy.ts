// Firm OS roles (orchestrator ARCHITECTURE "Roles"). Derived from the existing LMS session
// fields through src/lib/access.ts — never from role/level string literals here.
//
//   admin    role = ADMIN
//   partner  level = PARTNER
//   manager  level = MANAGER or SENIOR_MANAGER
//   staff    everyone else (and anyone not signed in)
//
// Entra group mapping (Partners / Staff security groups) is Blocked: the session does not
// carry group ids today (docs/inventory.md G-4). ENTRA_GROUP_ROLES and roleFromEntraGroups()
// are the hook: once the Entra app emits a `groups` claim and auth.ts copies it onto
// session.user.groups, firmRole() should prefer roleFromEntraGroups(user.groups) and fall back
// to the level-based mapping below. Nothing reads groups until then.
import { isActive, isAdmin, isManager, isPartner, type SessionUser } from "@/lib/access";

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

/** Plain-English onboarding (/onboard): partners, managers and admins, and only while active. */
export function canOnboard(user: SessionUser): boolean {
  return isActive(user) && firmRole(user) !== "staff";
}

/** Labels for chips and messages. */
export const FIRM_ROLE_LABELS: Record<FirmRole, string> = {
  admin: "Admin",
  partner: "Partner",
  manager: "Manager",
  staff: "Staff",
};
