// Sync users from Microsoft Entra (M365 tenant) into our local User table
// so admins can assign work to anyone in the org — even people who haven't
// signed in to the LMS yet. Uses app-only Graph token + User.Read.All.
//
// Activity policy:
//   - Users still enabled in M365 → active = true
//   - Users we previously had but are now disabled / deleted → active = false
//   - We never hard-delete; that preserves their assignment + progress history.

import { prisma } from "@/lib/prisma";
import { getAppOnlyToken, getUserGraphToken, listOrgUsers } from "@/lib/graph";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function syncOrgUsers(opts: { fallbackUserId?: string } = {}) {
  let token = await getAppOnlyToken();
  if (!token && opts.fallbackUserId) {
    token = await getUserGraphToken(opts.fallbackUserId);
  }
  if (!token) throw new Error("No Graph token available");

  const orgUsers = await listOrgUsers(token);
  let added = 0;
  let updated = 0;
  let deactivated = 0;
  let reactivated = 0;

  const seenEmails = new Set<string>();

  for (const u of orgUsers) {
    const email = (u.mail || u.userPrincipalName || "").toLowerCase().trim();
    if (!email) continue;
    seenEmails.add(email);

    const existing = await prisma.user.findUnique({ where: { email } });
    const isAdmin = adminEmails.includes(email);

    if (existing) {
      const wasInactive = !existing.active;
      const data: Record<string, unknown> = {};
      if (existing.name !== (u.displayName ?? existing.name)) {
        data.name = u.displayName ?? existing.name;
      }
      if (isAdmin && existing.role !== "ADMIN") data.role = "ADMIN";
      if (wasInactive) {
        data.active = true;
        data.deactivatedAt = null;
        reactivated++;
      }
      if (Object.keys(data).length > 0) {
        await prisma.user.update({ where: { id: existing.id }, data });
        if (!wasInactive) updated++;
      }
    } else {
      await prisma.user.create({
        data: {
          email,
          name: u.displayName,
          role: isAdmin ? "ADMIN" : "EMPLOYEE",
          active: true,
        },
      });
      added++;
    }
  }

  // Anyone in our DB whose email no longer shows up in the Graph response
  // (or who's there but disabled — we filtered those out in listOrgUsers)
  // gets marked inactive. We never delete.
  const stale = await prisma.user.findMany({
    where: { active: true, email: { notIn: Array.from(seenEmails) } },
    select: { id: true },
  });
  if (stale.length > 0) {
    const staleIds = stale.map((s) => s.id);
    await prisma.user.updateMany({
      where: { id: { in: staleIds } },
      data: { active: false, deactivatedAt: new Date() },
    });
    // A database session would otherwise outlive the M365 account until it expires.
    // Ending it here means "deactivated" takes effect on the next request.
    await prisma.session.deleteMany({ where: { userId: { in: staleIds } } });
    deactivated = stale.length;
  }

  return {
    added,
    updated,
    deactivated,
    reactivated,
    total: orgUsers.length,
  };
}
