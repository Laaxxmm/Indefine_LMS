import type { SessionUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import type { FirmDb } from "@/lib/agents/core/runner";
import { listMistakes } from "@/lib/agents/views";

/** Mistake rows plus display names of the people who logged them. */
export async function loadMistakesPage(user: SessionUser) {
  const data = await listMistakes(prisma as unknown as FirmDb, user);
  const ids = [...new Set([...data.proposed, ...data.decided].map((r) => r.createdBy))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  return { data, names: new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id])) };
}
