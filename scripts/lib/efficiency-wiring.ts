// What the efficiency harness plugs into the real ModelRouter, mirroring production wiring
// (src/lib/ai/router.ts default router: a process-wide response cache; src/lib/ai/db.ts: the
// cache scope is the AgentRun's JobTask). Kept in one place so a before / after comparison changes
// only this file (the "before" baseline ran with no extras and no repo additions).
import { createResponseCache } from "@/lib/ai/cache";
import type { ModelCallRepo } from "@/lib/ai/router";
import type { MemoryDb } from "@/lib/agents/core/memory-db";

/** Extra createRouter dependencies for one fixture (one process, both runs). */
export const routerExtras = (): Record<string, unknown> => ({ cache: createResponseCache() });

/** Extra ModelCallRepo methods backed by the fixture's memory database (counted as its Prisma calls). */
export const harnessRepo: ((db: MemoryDb) => Partial<ModelCallRepo> & Record<string, unknown>) | undefined = (db) => ({
  async cacheScopeOf(runId: string) {
    const run = (await db.agentRun.findUnique({ where: { id: runId }, select: { jobTaskId: true } })) as { jobTaskId: string } | null;
    return run?.jobTaskId ? `job:${run.jobTaskId}` : null;
  },
});
