import { prisma } from "@/lib/prisma";
import { SEED_SERVICES } from "./core";

// Idempotent seed. One INSERT … ON CONFLICT DO NOTHING per call; cheap enough to run
// on every page that needs the list, so no separate seed step at deploy.
export async function ensureServiceTypes(): Promise<void> {
  const data = SEED_SERVICES.flatMap(([department, names]) => names.map((name, order) => ({ department, name, order })));
  await prisma.serviceType.createMany({ data, skipDuplicates: true });
}

export async function listServiceTypes(includeInactive = false) {
  await ensureServiceTypes();
  return prisma.serviceType.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ department: "asc" }, { order: "asc" }, { name: "asc" }],
  });
}

export type Handler = { id: string; name: string };

// Real, active people only — shared mailboxes are excludedFromScoring.
export async function listHandlers(): Promise<Handler[]> {
  const users = await prisma.user.findMany({
    where: { active: true, excludedFromScoring: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  });
  return users.map((u) => ({ id: u.id, name: u.name ?? u.email }));
}
