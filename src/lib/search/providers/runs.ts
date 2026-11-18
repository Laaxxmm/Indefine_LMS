// Agent runs, scoped by runScopeWhere (the /agents run review page): staff find runs of jobs they
// prepare or review; managers, partners and admins find all. Matches the run id, the agent, and
// the job's title, client code, client name and service.
import type { Prisma } from "@prisma/client";
import { canFindFirmWork, runScopeWhere } from "../access";
import { RUN_STATUS_LABELS, SERVICE_LABELS, day, line, servicesMatching, titled } from "../format";
import { runLink } from "../links";
import { maskText } from "../mask";
import { defineProvider, exactOnlyFilter, fetchCap, isSingleToken, type SearchProvider } from "../provider";
import { finalise, rankMatch } from "../rank";

const select = {
  id: true,
  agent: true,
  attempt: true,
  status: true,
  startedAt: true,
  jobTask: { select: { title: true, service: true, period: true, fy: true, firmClient: { select: { clientCode: true, client: { select: { name: true } } } } } },
} satisfies Prisma.AgentRunSelect;
type Row = Prisma.AgentRunGetPayload<{ select: typeof select }>;

function termWhere(t: string): Prisma.AgentRunWhereInput {
  const services = servicesMatching(t);
  return {
    OR: [
      { agent: t.toLowerCase() },
      { jobTask: { title: { contains: t, mode: "insensitive" } } },
      { jobTask: { firmClient: { clientCode: { contains: t.toUpperCase() } } } },
      { jobTask: { firmClient: { client: { name: { contains: t, mode: "insensitive" } } } } },
      ...(services.length ? [{ jobTask: { service: { in: services } } }] : []),
    ],
  };
}

export const runsProvider: SearchProvider = defineProvider({
  type: "run",
  canUse: canFindFirmWork,

  async search({ db, user, q, terms, limit, exactOnly }) {
    const scope = runScopeWhere(user);
    const [exact, some] = await Promise.all([
      isSingleToken(q) || exactOnly ? db.agentRun.findMany({ where: { AND: [scope, { id: q }] }, select, take: 1 }) : Promise.resolve([] as Row[]),
      exactOnly ? Promise.resolve([] as Row[]) : db.agentRun.findMany({ where: { AND: [scope, ...terms.map(termWhere)] }, select, orderBy: { startedAt: "desc" }, take: fetchCap(limit) }),
    ]);
    const hits = [...exact, ...some].map((r) => {
      const job = r.jobTask;
      const clientName = job.firmClient.client?.name ?? "";
      const rank = rankMatch(q, { ids: [r.id], codes: [job.firmClient.clientCode, r.agent], text: [job.title, clientName, job.period, SERVICE_LABELS[job.service]] });
      if (rank === null) return null;
      return {
        type: "run" as const,
        id: r.id,
        label: titled(job.title, maskText(clientName)),
        context: line(`${SERVICE_LABELS[job.service]} agent`, `attempt ${r.attempt}`, RUN_STATUS_LABELS[r.status] ?? "Status not recorded", job.firmClient.clientCode, job.period, `started ${day(r.startedAt)}`),
        ...runLink(r.agent, r.id),
        rank,
        at: r.startedAt.toISOString(),
      };
    });
    return finalise(exactOnlyFilter(hits, exactOnly), limit);
  },
});
