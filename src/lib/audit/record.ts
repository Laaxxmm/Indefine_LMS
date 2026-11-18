// Route-handler helper: logAudit through the app's Prisma client, for routes whose service layer
// takes no injected client (e.g. /api/firm-os/onboard/*, whose service lives in
// src/lib/agents/onboarding). Prisma is imported lazily so importing a route stays cheap and
// route tests can mock "@/lib/prisma".
import { logAudit, type AuditInput } from "./log";

export async function recordAudit(e: AuditInput): Promise<{ id: string }> {
  const { prisma } = await import("@/lib/prisma");
  return logAudit(prisma, e);
}
