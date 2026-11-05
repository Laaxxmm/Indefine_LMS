import { requireAgentUser, toJson } from "@/lib/agents/http";
import { defaultAgentDeps, startAgentRun } from "@/lib/agents/service";

// "Run agent": the assignee (or a manager / partner) prepares the draft pack for one job.
export async function POST(_req: Request, { params }: { params: Promise<{ agent: string; jobId: string }> }) {
  const g = await requireAgentUser();
  if (g.res) return g.res;
  const { agent, jobId } = await params;
  return toJson(await startAgentRun(g.user, agent, jobId, await defaultAgentDeps()), 201);
}
