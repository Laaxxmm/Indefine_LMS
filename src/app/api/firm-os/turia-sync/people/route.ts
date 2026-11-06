import { prisma } from "@/lib/prisma";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";
import { personPickZ, savePersonLink } from "@/lib/integrations/turia/pull/admin";
import { readTuriaSyncBody, turiaSyncJson, turiaSyncManager } from "@/lib/integrations/turia/pull/http";

// Pick the LMS user for a Turia person (kept over automatic matching), or go back to automatic.
// Admins and partners; recorded as an AuditEvent.
export async function POST(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await turiaSyncManager();
  if (g.res) return g.res;
  const body = await readTuriaSyncBody(personPickZ, req);
  if (body.res) return body.res;
  return turiaSyncJson(await savePersonLink(prisma, g.user, body.data));
}
