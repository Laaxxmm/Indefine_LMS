import { withCloseLoopHook } from "@/lib/close-loop/defaults";
import { parseJson, requireAgentUser, toJson } from "@/lib/agents/http";
import { rerunZ } from "@/lib/agents/schemas";
import { defaultAgentDeps, rerunAgent } from "@/lib/agents/service";
import { enforceRateLimit } from "@/lib/hardening/rate-limit";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// "Re-run with a note": AGENT_DONE → IN_PREP with the preparer's note, then the agent runs again with it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const body = await parseJson(rerunZ, req);
  if (body.res) return body.res;
  const limited = await enforceRateLimit("agent-run", g.user.id);
  if (limited) return limited;
  const { id } = await params;
  return toJson(await rerunAgent(g.user, id, body.data.note, withCloseLoopHook(await defaultAgentDeps())));
}
