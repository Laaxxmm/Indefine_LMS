import { withCloseLoopHook } from "@/lib/close-loop/defaults";
import { parseJson, requireAgentUser, toJson } from "@/lib/agents/http";
import { requestChangesZ } from "@/lib/agents/schemas";
import { defaultAgentDeps, requestChanges } from "@/lib/agents/service";

// "Request changes": IN_REVIEW → IN_PREP with the reviewer's note, then the agent re-runs with it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const body = await parseJson(requestChangesZ, req);
  if (body.res) return body.res;
  const { id } = await params;
  return toJson(await requestChanges(g.user, id, body.data.note, withCloseLoopHook(await defaultAgentDeps())));
}
