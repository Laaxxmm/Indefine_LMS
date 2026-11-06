// Deliverables (agent working and final files), visible when their job is (jobScopeWhere — the
// same rule as the download route). Matches the file name and its SharePoint path. Opens the run
// that produced the file, else the job's latest run, else the client's page.
import type { Prisma } from "@prisma/client";
import { canFindFirmWork, deliverableScopeWhere } from "../access";
import { day, line, shortPath } from "../format";
import { jobLink, runLink } from "../links";
import { maskText } from "../mask";
import { defineProvider, exactOnlyFilter, fetchCap, isSingleToken, type SearchProvider } from "../provider";
import { finalise, rankMatch } from "../rank";

const select = {
  id: true,
  name: true,
  spPath: true,
  kind: true,
  version: true,
  createdAt: true,
  agentRun: { select: { id: true, agent: true } },
  jobTask: {
    select: {
      title: true,
      period: true,
      firmClient: { select: { clientCode: true, lmsClientId: true } },
      agentRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { id: true, agent: true } },
    },
  },
} satisfies Prisma.DeliverableSelect;
type Row = Prisma.DeliverableGetPayload<{ select: typeof select }>;

const termWhere = (t: string): Prisma.DeliverableWhereInput => ({
  OR: [{ name: { contains: t, mode: "insensitive" } }, { spPath: { contains: t, mode: "insensitive" } }],
});

export const deliverablesProvider: SearchProvider = defineProvider({
  type: "deliverable",
  canUse: canFindFirmWork,

  async search({ db, user, q, terms, limit, exactOnly, clPaths }) {
    const scope = deliverableScopeWhere(user);
    const [exact, some] = await Promise.all([
      isSingleToken(q) || exactOnly ? db.deliverable.findMany({ where: { AND: [scope, { id: q }] }, select, take: 1 }) : Promise.resolve([] as Row[]),
      exactOnly ? Promise.resolve([] as Row[]) : db.deliverable.findMany({ where: { AND: [scope, ...terms.map(termWhere)] }, select, orderBy: { createdAt: "desc" }, take: fetchCap(limit) }),
    ]);
    const hits = [...exact, ...some].map((d) => {
      const rank = rankMatch(q, { ids: [d.id], text: [d.name, d.spPath] });
      if (rank === null) return null;
      const job = d.jobTask;
      const link = d.agentRun ? runLink(d.agentRun.agent, d.agentRun.id) : jobLink({ lmsClientId: job.firmClient.lmsClientId, latestRun: job.agentRuns[0] ?? null }, clPaths);
      return {
        type: "deliverable" as const,
        id: d.id,
        label: maskText(d.name),
        context: line(d.kind === "Final" ? "Final file" : "Working file", `version ${d.version}`, `${job.title} for ${job.firmClient.clientCode}`, job.period, maskText(shortPath(d.spPath)), `saved ${day(d.createdAt)}`),
        ...link,
        rank,
        at: d.createdAt.toISOString(),
      };
    });
    return finalise(exactOnlyFilter(hits, exactOnly), limit);
  },
});
