// Jobs of the client database (/clients, the per-FY Job rows). Visible to everyone who may open
// /clients/[id] (canViewClients). Matches the service, the client name and code, the FY and the
// job id. Notes are not searched (free text).
import type { Prisma } from "@prisma/client";
import { JOB_STATUSES } from "@/lib/clients/core";
import { canFindClients } from "../access";
import { day, line } from "../format";
import { clientLink } from "../links";
import { maskText } from "../mask";
import { defineProvider, exactOnlyFilter, fetchCap, isSingleToken, type SearchProvider } from "../provider";
import { finalise, rankMatch } from "../rank";

const select = {
  id: true,
  fy: true,
  status: true,
  dueOn: true,
  updatedAt: true,
  clientId: true,
  serviceType: { select: { name: true } },
  client: { select: { name: true, firmClient: { select: { clientCode: true } } } },
} satisfies Prisma.JobSelect;
type Row = Prisma.JobGetPayload<{ select: typeof select }>;

const termWhere = (t: string): Prisma.JobWhereInput => ({
  OR: [
    { serviceType: { name: { contains: t, mode: "insensitive" } } },
    { client: { name: { contains: t, mode: "insensitive" } } },
    { client: { firmClient: { clientCode: { contains: t.toUpperCase() } } } },
    { fy: { contains: t } },
  ],
});

export const clientJobsProvider: SearchProvider = defineProvider({
  type: "client-job",
  canUse: canFindClients,

  async search({ db, q, terms, limit, exactOnly }) {
    const [exact, some] = await Promise.all([
      isSingleToken(q) || exactOnly ? db.job.findMany({ where: { id: q }, select, take: 1 }) : Promise.resolve([] as Row[]),
      exactOnly ? Promise.resolve([] as Row[]) : db.job.findMany({ where: { AND: terms.map(termWhere) }, select, orderBy: { updatedAt: "desc" }, take: fetchCap(limit) }),
    ]);
    const hits = [...exact, ...some].map((j) => {
      const code = j.client.firmClient?.clientCode ?? null;
      const rank = rankMatch(q, { ids: [j.id], codes: [code], text: [j.serviceType.name, j.client.name, j.fy] });
      if (rank === null) return null;
      return {
        type: "client-job" as const,
        id: j.id,
        label: `${j.serviceType.name} · FY ${j.fy}`,
        context: line(maskText(j.client.name), code, JOB_STATUSES[j.status], j.dueOn && `due ${day(j.dueOn)}`),
        ...clientLink(j.clientId),
        rank,
        at: j.updatedAt.toISOString(),
      };
    });
    return finalise(exactOnlyFilter(hits, exactOnly), limit);
  },
});
