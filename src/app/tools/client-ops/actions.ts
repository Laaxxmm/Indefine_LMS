"use server";

// Every write goes through here. Each action re-checks the session: a server action is a
// public endpoint, and the page's redirect does not protect it.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { BillingCycle, SubscriptionKind } from "@prisma/client";
import { canUseClientOps, draftReminder } from "@/lib/client-ops/core";
import { runChecks } from "@/lib/client-ops/refresh";

const KINDS: SubscriptionKind[] = ["DOMAIN", "HOSTING", "VERCEL", "RAILWAY", "EMAIL", "OTHER"];
const CYCLES: BillingCycle[] = ["MONTHLY", "YEARLY"];

async function actor() {
  const session = await auth();
  return canUseClientOps(session?.user) ? session!.user : null;
}

const text = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
const optional = (fd: FormData, key: string) => text(fd, key) || null;
function money(fd: FormData, key: string): number | null {
  const raw = text(fd, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function day(fd: FormData, key: string): Date | null {
  const raw = text(fd, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function refreshPaths(id?: string) {
  revalidatePath("/tools/client-ops");
  if (id) revalidatePath(`/tools/client-ops/${id}`);
}

export async function refreshNow() {
  if (!(await actor())) return;
  await runChecks();
  refreshPaths();
}

export async function addClient(formData: FormData) {
  const user = await actor();
  if (!user) return;
  const name = text(formData, "name");
  const email = text(formData, "email");
  if (!name || !email) return;
  await prisma.opsClient.create({
    data: { name, email, contact: optional(formData, "contact"), createdById: user.id },
  });
  refreshPaths();
}

export async function updateClient(formData: FormData) {
  const user = await actor();
  if (!user) return;
  const id = text(formData, "id");
  const name = text(formData, "name");
  const email = text(formData, "email");
  if (!id || !name || !email) return;
  await prisma.opsClient.update({
    where: { id },
    data: { name, email, contact: optional(formData, "contact") },
  });
  refreshPaths();
}

/** Stopping a client hides its services from the dashboard; nothing is deleted. */
export async function setClientActive(formData: FormData) {
  const user = await actor();
  if (!user) return;
  const id = text(formData, "id");
  if (!id) return;
  await prisma.opsClient.update({ where: { id }, data: { active: text(formData, "active") === "true" } });
  refreshPaths();
}

export async function addSubscription(formData: FormData) {
  const user = await actor();
  if (!user) return;
  const clientId = text(formData, "clientId");
  const provider = text(formData, "provider");
  const expiresOn = day(formData, "expiresOn");
  const chargeAmount = money(formData, "chargeAmount");
  const kind = text(formData, "kind") as SubscriptionKind;
  const cycle = text(formData, "cycle") as BillingCycle;
  if (!clientId || !provider || !expiresOn || chargeAmount === null) return;
  if (!KINDS.includes(kind) || !CYCLES.includes(cycle)) return;

  await prisma.opsSubscription.create({
    data: {
      clientId,
      kind,
      cycle,
      provider,
      expiresOn,
      chargeAmount,
      costPaid: money(formData, "costPaid"),
      renewalLink: optional(formData, "renewalLink"),
      domain: optional(formData, "domain"),
      sslHost: optional(formData, "sslHost"),
      createdById: user.id,
    },
  });
  refreshPaths();
}

export async function updateSubscription(formData: FormData) {
  const user = await actor();
  if (!user) return;
  const id = text(formData, "id");
  const expiresOn = day(formData, "expiresOn");
  const chargeAmount = money(formData, "chargeAmount");
  if (!id || !expiresOn || chargeAmount === null) return;

  await prisma.opsSubscription.update({
    where: { id },
    data: {
      expiresOn,
      chargeAmount,
      costPaid: money(formData, "costPaid"),
      provider: text(formData, "provider") || undefined,
      renewalLink: optional(formData, "renewalLink"),
      domain: optional(formData, "domain"),
      sslHost: optional(formData, "sslHost"),
      notes: optional(formData, "notes"),
    },
  });
  refreshPaths(id);
}

export async function setSubscriptionActive(formData: FormData) {
  const user = await actor();
  if (!user) return;
  const id = text(formData, "id");
  if (!id) return;
  await prisma.opsSubscription.update({ where: { id }, data: { active: text(formData, "active") === "true" } });
  refreshPaths(id);
}

/** Logs that a reminder went out. The app sends no mail itself — see docs/client-ops.md. */
export async function markReminderSent(formData: FormData) {
  const user = await actor();
  if (!user) return;
  const id = text(formData, "id");
  const subscription = await prisma.opsSubscription.findUnique({
    where: { id },
    include: { client: { select: { id: true, name: true, email: true } } },
  });
  if (!subscription) return;
  const { subject, body } = draftReminder(subscription);
  await prisma.opsReminder.create({
    data: { subscriptionId: subscription.id, sentById: user.id, subject, body },
  });
  refreshPaths(id);
}
