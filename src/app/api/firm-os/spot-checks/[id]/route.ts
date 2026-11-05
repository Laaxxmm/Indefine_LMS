import { z } from "zod";
import { parseJson, requireAgentUser, toJson } from "@/lib/agents/http";
import { SPOT_CHECK_NOTE_MAX, markSpotChecked } from "@/lib/audit/spot-checks";

const bodyZ = z.object({ note: z.string().trim().max(SPOT_CHECK_NOTE_MAX, `Keep the note under ${SPOT_CHECK_NOTE_MAX} characters`).nullable().optional() }).strict();

// "Checked in Turia": a partner records the spot check of one manual Turia close the close gate
// selected (sets TuriaSync.spotChecked…, AuditEvent `spot-check`). Partners only; 403 for anyone else.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const body = await parseJson(bodyZ, req);
  if (body.res) return body.res;
  const { id } = await params;
  const { prisma } = await import("@/lib/prisma");
  return toJson(await markSpotChecked(prisma, g.user, id, body.data.note ?? null));
}
