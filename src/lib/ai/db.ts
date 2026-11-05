// Prisma side of the ModelRouter: the ModelCall log (append-only — no update, no removal) and
// the read used by /admin/firm-os/models. The client is injectable so tests need no database.
import { prisma } from "@/lib/prisma";
import type { ModelCallRepo, ModelCallRow } from "./router";
import type { UsageCall } from "./usage";

type Db = Pick<typeof prisma, "modelCall">;

export function prismaModelCallRepo(db: Db = prisma): ModelCallRepo {
  return {
    async record(row: ModelCallRow) {
      await db.modelCall.create({ data: { ...row } });
    },
    async costInrSince(since: Date) {
      const agg = await db.modelCall.aggregate({ _sum: { costInr: true }, where: { createdAt: { gte: since } } });
      return Number(agg._sum.costInr ?? 0);
    },
    async costInrForRun(runId: string) {
      const agg = await db.modelCall.aggregate({ _sum: { costInr: true }, where: { runId } });
      return Number(agg._sum.costInr ?? 0);
    },
  };
}

/** ModelCall rows in [from, to), the fields the usage page aggregates. */
export async function loadModelCalls(from: Date, to: Date, db: Db = prisma): Promise<UsageCall[]> {
  const rows = await db.modelCall.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: { createdAt: true, agent: true, provider: true, status: true, escalated: true, costInr: true, tokensIn: true, tokensOut: true, task: true, error: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ ...r, costInr: Number(r.costInr) }));
}
