import { withCloseLoopHook } from "@/lib/close-loop/defaults";
import { requireAgentUser, toJson } from "@/lib/agents/http";
import { defaultAgentDeps, submitForReview } from "@/lib/agents/service";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// "Submit for review": AGENT_DONE → IN_REVIEW.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const { id } = await params;
  return toJson(await submitForReview(g.user, id, withCloseLoopHook(await defaultAgentDeps())));
}
