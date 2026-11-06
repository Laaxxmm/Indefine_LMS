import { requireAgentUser, toJson } from "@/lib/agents/http";
import { defaultAgentDeps, finalizeRun } from "@/lib/agents/service";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// "Copy to Final" retry after an approval whose SharePoint copy failed. Idempotent.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const { id } = await params;
  return toJson(await finalizeRun(g.user, id, await defaultAgentDeps()));
}
