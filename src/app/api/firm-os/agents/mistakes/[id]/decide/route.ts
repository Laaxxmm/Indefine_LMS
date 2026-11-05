import { parseJson, requireAgentUser, toJson } from "@/lib/agents/http";
import { decideZ } from "@/lib/agents/schemas";
import { decideMistakeFor, defaultAgentDeps } from "@/lib/agents/service";

// Partner / manager approves (→ new SopPack minor version) or rejects a proposed rule.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const body = await parseJson(decideZ, req);
  if (body.res) return body.res;
  const { id } = await params;
  return toJson(await decideMistakeFor(g.user, id, body.data.decision, await defaultAgentDeps()));
}
