import { parseJson, requireAgentUser, toJson } from "@/lib/agents/http";
import { mistakeZ } from "@/lib/agents/schemas";
import { defaultAgentDeps, logMistake } from "@/lib/agents/service";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// Log a finding the agent missed or got wrong → MistakeLog PROPOSED (a partner/manager decides).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const body = await parseJson(mistakeZ, req);
  if (body.res) return body.res;
  const { id } = await params;
  return toJson(await logMistake(g.user, id, body.data, await defaultAgentDeps()), 201);
}
