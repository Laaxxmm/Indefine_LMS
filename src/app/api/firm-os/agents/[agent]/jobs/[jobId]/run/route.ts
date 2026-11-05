import { requireAgentUser, toJson } from "@/lib/agents/http";
import { defaultAgentDeps, startAgentRun } from "@/lib/agents/service";
import { enforceRateLimit } from "@/lib/hardening/rate-limit";

// "Run agent": the assignee (or a manager / partner) prepares the draft pack for one job.
// Rate-limited per person (scope agent-run): each run is a model-backed draft.
export async function POST(_req: Request, { params }: { params: Promise<{ agent: string; jobId: string }> }) {
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const limited = await enforceRateLimit("agent-run", g.user.id);
  if (limited) return limited;
  const { agent, jobId } = await params;
  return toJson(await startAgentRun(g.user, agent, jobId, await defaultAgentDeps()), 201);
}
