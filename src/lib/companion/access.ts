// Who may pair the Firm OS Companion. The rule is src/lib/rbac/policy.ts canPairCompanion
// (pair and use) and canRevokePairing; this module keeps its public API, delegates, and adds the
// one database read the rule needs.
//
//   active and WorkspaceSetting.companionEnabled  admins turn it on per person (workspace settings)
//   active admin or partner                       allowed until the settings page lands
//
// The same rule gates the /companion page, the pairing routes and every next-task call, so turning
// the setting off (or deactivating the person) stops a paired browser on its next refresh.
import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { isActive, type SessionUser } from "@/lib/access";
import { canPairCompanion, canRevokePairing } from "@/lib/rbac/policy";

export type CompanionUser = Session["user"];
export type CompanionAccessDb = Pick<PrismaClient, "workspaceSetting">;

/** Pure rule: `companionEnabled` is the person's WorkspaceSetting flag (false when no row). */
export function canUseCompanion(user: SessionUser, companionEnabled: boolean): boolean {
  return canPairCompanion(user, companionEnabled);
}

/** Revoke one of the person's own pairings (allowed even after companion access was turned off). */
export function mayRevokePairing(user: SessionUser, pairing: { userId: string }): boolean {
  return canRevokePairing(user, pairing);
}

/** The rule with the setting read from the database (no query for admins, partners or inactive people). */
export async function hasCompanionAccess(db: CompanionAccessDb, user: SessionUser): Promise<boolean> {
  if (!user || !isActive(user)) return false;
  if (canUseCompanion(user, false)) return true;
  const row = await db.workspaceSetting.findUnique({ where: { userId: user.id }, select: { companionEnabled: true } });
  return canUseCompanion(user, row?.companionEnabled === true);
}
