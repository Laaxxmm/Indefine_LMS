// Production wiring for the close loop: Prisma, the Path A graph-client (GET only) for the live
// Final-file check, the active Turia bridge for issuing steps, the manual bridge for confirmations,
// and the agents service finalize path for Working → Final copies. Routes and the cron call
// closeLoopDeps(); tests build the deps from fakes instead.
import type { SessionUser } from "@/lib/access";
import { defaultAgentDeps, finalizeRun, type AgentServiceDeps } from "@/lib/agents/service";
import { prisma } from "@/lib/prisma";
import { defaultSharePointClient } from "@/lib/integrations/sharepoint/factory";
import type { SharePointClient } from "@/lib/integrations/sharepoint/graph-client";
import { prismaTuriaSyncRepo } from "@/lib/integrations/turia/db";
import { createTuriaAdapter, manualBridge } from "@/lib/integrations/turia/factory";
import type { CloseLoopDeps } from "./actions";
import type { CopyToFinal } from "./hooks";
import { graphDeliverableVerifier } from "./verifier";

type Finalize = (user: SessionUser, runId: string, deps: AgentServiceDeps) => ReturnType<typeof finalizeRun>;

/**
 * copyToFinal through the agents service: the job's latest agent run is finalised as the approving
 * person (create-only copies at the next free _v{n}, Final Deliverable rows). Idempotent.
 */
export function agentServiceCopyToFinal(load: () => Promise<AgentServiceDeps> = defaultAgentDeps, finalize: Finalize = finalizeRun): CopyToFinal {
  return async (jobTaskId, user) => {
    const deps = await load();
    const run = await deps.db.agentRun.findFirst({ where: { jobTaskId }, orderBy: { startedAt: "desc" }, select: { id: true } });
    if (!run) throw new Error("This job has no agent run: put the final file in the Final folder and record it as a Final deliverable");
    const r = await finalize(user, run.id, deps);
    if (!r.ok) throw new Error(r.error);
    return { copied: r.data.final.length };
  };
}

export function closeLoopDeps(): CloseLoopDeps {
  const repo = prismaTuriaSyncRepo(prisma);
  let client: SharePointClient | null = null;
  return {
    db: prisma,
    verifier: graphDeliverableVerifier(() => (client ??= defaultSharePointClient())),
    turia: createTuriaAdapter({ repo }),
    manual: manualBridge(repo),
    copyToFinal: agentServiceCopyToFinal(),
    now: () => new Date(),
  };
}
