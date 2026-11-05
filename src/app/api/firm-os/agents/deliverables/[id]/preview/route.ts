import { requireAgentUser, toJson } from "@/lib/agents/http";
import { defaultAgentDeps, previewDeliverable } from "@/lib/agents/service";

// Read-only preview of an XLSX deliverable: each sheet as rows of display text.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const { id } = await params;
  return toJson(await previewDeliverable(g.user, id, await defaultAgentDeps()));
}
