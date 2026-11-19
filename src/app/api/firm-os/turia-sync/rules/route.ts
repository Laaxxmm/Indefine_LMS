import { prisma } from "@/lib/prisma";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";
import { ruleZ, saveRule } from "@/lib/integrations/turia/pull/admin";
import { readTuriaSyncBody, turiaSyncJson, turiaSyncManager } from "@/lib/integrations/turia/pull/http";

// Add or change a Turia task -> job rule (switch it off with active: false; rules are never removed).
// Admins and partners; recorded as an AuditEvent.
export async function POST(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await turiaSyncManager();
  if (g.res) return g.res;
  const body = await readTuriaSyncBody(ruleZ, req);
  if (body.res) return body.res;
  return turiaSyncJson(await saveRule(prisma, g.user, body.data));
}
