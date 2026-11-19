import { prisma } from "@/lib/prisma";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";
import { clientPickZ, saveClientLink } from "@/lib/integrations/turia/pull/admin";
import { readTuriaSyncBody, turiaSyncJson, turiaSyncManager } from "@/lib/integrations/turia/pull/http";

// Link a Turia client to an LMS client, ignore it, or go back to automatic matching.
// Admins and partners; recorded as an AuditEvent.
export async function POST(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await turiaSyncManager();
  if (g.res) return g.res;
  const body = await readTuriaSyncBody(clientPickZ, req);
  if (body.res) return body.res;
  return turiaSyncJson(await saveClientLink(prisma, g.user, body.data));
}
