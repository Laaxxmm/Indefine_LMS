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
import { normalizeEmail } from "@/lib/auth-tenant";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map(normalizeEmail)
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
    const email = normalizeEmail(u.mail || u.userPrincipalName || "");
    if (!email) continue;
    seenEmails.add(email);

    // Case-insensitive: a row created by an older sign-in may carry Entra's capitalisation
    // ("John.Doe@Firm.in"); an exact match would miss it and create a duplicate. If several rows
    // differ only by case, the exact lower-case one (else the oldest) is the person's row.
    const matches = await prisma.user.findMany({ where: { email: { equals: email, mode: "insensitive" } }, orderBy: { createdAt: "asc" } });
    const existing = matches.find((m) => m.email === email) ?? matches[0] ?? null;
    if (matches.length > 1) console.warn(`[users-sync] ${matches.length} user rows differ only by e-mail case (${matches.map((m) => m.id).join(", ")}); using ${existing?.id}; the others need merging by hand.`);
    const isAdmin = adminEmails.includes(email);

    if (existing) {
      const wasInactive = !existing.active;
      const data: Record<string, unknown> = {};
      // Store the address in lower case from now on (only when no other row already has it).
      if (existing.email !== email && matches.length === 1) data.email = email;
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
  // Compared in lower case: `notIn` is case-sensitive, so a mixed-case row of someone still in
  // the tenant would otherwise be deactivated (and locked out).
  const stale = (
    await prisma.user.findMany({
      where: { active: true },
      select: { id: true, email: true },
    })
  ).filter((s) => !seenEmails.has(normalizeEmail(s.email)));
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

  // Tokens left over from the days when sign-in requested the full Graph scope set.
  // Non-admins who never connected at /connect have no reason to hold one.
  const purged = await prisma.account.updateMany({
    where: { provider: "microsoft-entra-id", elevatedAt: null, refresh_token: { not: null }, user: { role: { not: "ADMIN" } } },
    data: { refresh_token: null, access_token: null, expires_at: null },
  });

  return {
    added,
    updated,
    deactivated,
    reactivated,
    tokensPurged: purged.count,
    total: orgUsers.length,
  };
}
