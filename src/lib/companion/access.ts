// Who may pair the Firm OS Companion. Composes src/lib/access.ts; never compares role or level
// strings here.
//
//   active and WorkspaceSetting.companionEnabled  admins turn it on per person (workspace settings)
//   active admin or partner                       allowed until the settings page lands
//
// The same rule gates the /companion page, the pairing routes and every next-task call, so turning
// the setting off (or deactivating the person) stops a paired browser on its next refresh.
import type { PrismaClient } from "@prisma/client";
import type { Session } from "next-auth";
import { isActive, isAdmin, isPartner, type SessionUser } from "@/lib/access";

export type CompanionUser = Session["user"];
export type CompanionAccessDb = Pick<PrismaClient, "workspaceSetting">;

/** Pure rule: `companionEnabled` is the person's WorkspaceSetting flag (false when no row). */
export function canUseCompanion(user: SessionUser, companionEnabled: boolean): boolean {
  if (!user || !isActive(user)) return false;
  return companionEnabled || isAdmin(user) || isPartner(user);
}

/** The rule with the setting read from the database (no query for admins, partners or inactive people). */
export async function hasCompanionAccess(db: CompanionAccessDb, user: SessionUser): Promise<boolean> {
  if (!user || !isActive(user)) return false;
  if (canUseCompanion(user, false)) return true;
  const row = await db.workspaceSetting.findUnique({ where: { userId: user.id }, select: { companionEnabled: true } });
  return canUseCompanion(user, row?.companionEnabled === true);
}
