// Sync users from Microsoft Entra (M365 tenant) into our local User table
// so admins can assign work to anyone in the org — even people who haven't
// signed in to the LMS yet. Uses app-only Graph token + User.Read.All.

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

  for (const u of orgUsers) {
    const email = (u.mail || u.userPrincipalName || "").toLowerCase().trim();
    if (!email) continue;

    const existing = await prisma.user.findUnique({ where: { email } });
    const isAdmin = adminEmails.includes(email);

    if (existing) {
      const newName = u.displayName ?? existing.name;
      if (
        existing.name !== newName ||
        (isAdmin && existing.role !== "ADMIN")
      ) {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: newName,
            ...(isAdmin && existing.role !== "ADMIN" ? { role: "ADMIN" } : {}),
          },
        });
        updated++;
      }
    } else {
      await prisma.user.create({
        data: {
          email,
          name: u.displayName,
          role: isAdmin ? "ADMIN" : "EMPLOYEE",
        },
      });
      added++;
    }
  }

  return { added, updated, total: orgUsers.length };
}
