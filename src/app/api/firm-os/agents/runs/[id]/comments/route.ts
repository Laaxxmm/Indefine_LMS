import { parseJson, requireAgentUser, toJson } from "@/lib/agents/http";
import { commentZ } from "@/lib/agents/schemas";
import { addComment, defaultAgentDeps } from "@/lib/agents/service";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// A reviewer note on a run (append-only AuditEvent).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const body = await parseJson(commentZ, req);
  if (body.res) return body.res;
  const { id } = await params;
  return toJson(await addComment(g.user, id, body.data.text, await defaultAgentDeps()), 201);
}
