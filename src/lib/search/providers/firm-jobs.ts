// Firm OS jobs (JobTask), scoped by jobScopeWhere exactly as /agents and /clients/[id] are: staff
// find jobs they prepare or review, managers, partners and admins find all. Matches the title,
// client code and name, service, period, FY, the job id and its acknowledgement number.
import type { Prisma } from "@prisma/client";
import { canFindFirmWork, jobScopeWhere } from "../access";
import { JOB_STATE_LABELS, SERVICE_LABELS, day, line, servicesMatching, titled } from "../format";
import { jobLink } from "../links";
import { maskText } from "../mask";
import { defineProvider, exactOnlyFilter, fetchCap, isSingleToken, type SearchProvider } from "../provider";
import { finalise, rankMatch } from "../rank";

const select = {
  id: true,
  title: true,
  service: true,
  period: true,
  fy: true,
  state: true,
  ackRef: true,
  internalDueOn: true,
  updatedAt: true,
  firmClient: { select: { clientCode: true, lmsClientId: true, client: { select: { name: true } } } },
  agentRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { id: true, agent: true } },
} satisfies Prisma.JobTaskSelect;
type Row = Prisma.JobTaskGetPayload<{ select: typeof select }>;

function termWhere(t: string): Prisma.JobTaskWhereInput {
  const services = servicesMatching(t);
  return {
    OR: [
      { title: { contains: t, mode: "insensitive" } },
      { period: { contains: t, mode: "insensitive" } },
      { fy: { contains: t } },
      { firmClient: { clientCode: { contains: t.toUpperCase() } } },
      { firmClient: { client: { name: { contains: t, mode: "insensitive" } } } },
      ...(services.length ? [{ service: { in: services } }] : []),
    ],
  };
}

export const firmJobsProvider: SearchProvider = defineProvider({
  type: "job",
  canUse: canFindFirmWork,

  async search({ db, user, q, terms, limit, exactOnly, clPaths }) {
    const scope = jobScopeWhere(user);
    const exactWhere: Prisma.JobTaskWhereInput = { OR: [{ id: q }, { ackRef: { equals: q, mode: "insensitive" } }] };
    const [exact, some] = await Promise.all([
      isSingleToken(q) || exactOnly ? db.jobTask.findMany({ where: { AND: [scope, exactWhere] }, select, take: 5 }) : Promise.resolve([] as Row[]),
      exactOnly ? Promise.resolve([] as Row[]) : db.jobTask.findMany({ where: { AND: [scope, ...terms.map(termWhere)] }, select, orderBy: { updatedAt: "desc" }, take: fetchCap(limit) }),
    ]);
    const hits = [...exact, ...some].map((j) => {
      const clientName = j.firmClient.client?.name ?? "";
      const rank = rankMatch(q, { ids: [j.id], codes: [j.firmClient.clientCode, j.ackRef], text: [j.title, clientName, j.period, j.fy, SERVICE_LABELS[j.service]] });
      if (rank === null) return null;
      return {
        type: "job" as const,
        id: j.id,
        label: titled(j.title, maskText(clientName)),
        context: line(j.firmClient.clientCode, SERVICE_LABELS[j.service], j.period, `FY ${j.fy}`, JOB_STATE_LABELS[j.state], j.internalDueOn && `internal due ${day(j.internalDueOn)}`),
        ...jobLink({ lmsClientId: j.firmClient.lmsClientId, latestRun: j.agentRuns[0] ?? null }, clPaths),
        rank,
        at: j.updatedAt.toISOString(),
      };
    });
    return finalise(exactOnlyFilter(hits, exactOnly), limit);
  },
});
