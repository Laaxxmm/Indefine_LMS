import { withCloseLoopHook } from "@/lib/close-loop/defaults";
import { parseJson, requireAgentUser, toJson } from "@/lib/agents/http";
import { approveZ } from "@/lib/agents/schemas";
import { approvePack, defaultAgentDeps } from "@/lib/agents/service";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// "Approve pack": IN_REVIEW → APPROVED, then Working → Final (version suffix, never overwritten).
// Approval prepares the pack for a person to file; nothing is sent or submitted anywhere.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const body = await parseJson(approveZ, req);
  if (body.res) return body.res;
  const { id } = await params;
  return toJson(await approvePack(g.user, id, body.data.note?.trim() || null, withCloseLoopHook(await defaultAgentDeps())));
}
