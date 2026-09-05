"use server";

// Approval actions shared by /admin/approvals and /team/approvals.
//
// Routing rule: an item is actioned by the employee's DIRECT MANAGER.
// Admins can always act (they're the fallback for employees with no manager).

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/access";

async function actorFor(employeeUserId: string): Promise<string | null> {
  const session = await auth();
  if (!session?.user) return null;
  if (isAdmin(session.user)) return session.user.id;
  const emp = await prisma.user.findUnique({
    where: { id: employeeUserId },
    select: { managerId: true },
  });
  return emp?.managerId === session.user.id ? session.user.id : null;
}

function refresh() {
  revalidatePath("/admin/approvals");
  revalidatePath("/team/approvals");
  revalidatePath("/dashboard");
}

export async function approveQuest(formData: FormData) {
  const id = String(formData.get("id"));
  const quest = await prisma.quest.findUnique({ where: { id }, select: { userId: true } });
  if (!quest) return;
  const actorId = await actorFor(quest.userId);
  if (!actorId) return;
  await prisma.quest.update({
    where: { id },
    data: { status: "APPROVED", approvedById: actorId, approvedAt: new Date() },
  });
  refresh();
}

export async function rejectQuest(formData: FormData) {
  const id = String(formData.get("id"));
  const quest = await prisma.quest.findUnique({ where: { id }, select: { userId: true } });
  if (!quest) return;
  if (!(await actorFor(quest.userId))) return;
  await prisma.quest.update({ where: { id }, data: { status: "DRAFT" } });
  refresh();
}

export async function fundInitiative(formData: FormData) {
  const id = String(formData.get("id"));
  const initiative = await prisma.initiative.findUnique({ where: { id }, select: { userId: true } });
  if (!initiative) return;
  const actorId = await actorFor(initiative.userId);
  if (!actorId) return;
  await prisma.initiative.update({
    where: { id },
    data: { status: "FUNDED", fundedById: actorId, fundedAt: new Date() },
  });
  refresh();
}

export async function archiveInitiative(formData: FormData) {
  const id = String(formData.get("id"));
  const initiative = await prisma.initiative.findUnique({ where: { id }, select: { userId: true } });
  if (!initiative) return;
  if (!(await actorFor(initiative.userId))) return;
  await prisma.initiative.update({ where: { id }, data: { status: "ARCHIVED" } });
  refresh();
}
