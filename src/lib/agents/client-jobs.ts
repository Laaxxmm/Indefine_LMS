// Read model for the "Firm OS jobs" section of /clients/[id] (shown only under FIRM_OS_CL_PATHS when
// a FirmClient exists). Server-side only. Scoped exactly as /agents is (access.ts jobScopeWhere:
// staff see jobs they prepare or review; managers, partners and admins see all). Kept apart from
// views.ts so the LMS client page does not load the agent registry.
import type { JobTaskState, PrismaClient } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { canUseAgents, jobScopeWhere } from "@/lib/agents/access";
import { formatDate } from "@/lib/agents/core/format";

/** A Firm OS job on the /clients/[id] page (read-only). */
export type ClientJobRow = {
  id: string;
  service: string;
  period: string;
  fy: string;
  title: string;
  state: JobTaskState;
  /** "DD MMM YYYY" (IST day), or "—". */
  internalDue: string;
  assignee: string;
  /** The job's latest agent run, or null when no agent has run on it yet. */
  run: { href: string; attempt: number } | null;
};

/** The reads listClientJobs makes. PrismaClient satisfies it (the page casts, as it does for FirmDb). */
export type ClientJobsDb = Pick<PrismaClient, "jobTask" | "user">;

/**
 * The JobTasks of the LMS client `lmsClientId` that the person may see. Open jobs first, soonest
 * internal due first; then DONE jobs, most recent due first.
 */
export async function listClientJobs(db: ClientJobsDb, user: SessionUser, lmsClientId: string): Promise<ClientJobRow[]> {
  if (!user || !canUseAgents(user)) return [];
  const jobs = await db.jobTask.findMany({
    where: { AND: [jobScopeWhere(user), { firmClient: { lmsClientId } }] },
    orderBy: [{ internalDueOn: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: {
      id: true,
      service: true,
      period: true,
      fy: true,
      title: true,
      state: true,
      assigneeId: true,
      internalDueOn: true,
      agentRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { id: true, agent: true, attempt: true } },
    },
  });
  const ids = [...new Set(jobs.map((j) => j.assigneeId).filter((x): x is string => !!x))];
  const people = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(people.map((p) => [p.id, p.name ?? p.email ?? p.id]));
  // Sorted here, not only by the query, so a job with no internal due date is last either way (Postgres
  // puts NULLs last for ASC; other stores may not).
  const due = (j: (typeof jobs)[number]) => j.internalDueOn?.getTime() ?? Number.POSITIVE_INFINITY;
  const open = jobs.filter((j) => j.state !== "DONE").sort((a, b) => due(a) - due(b));
  const done = jobs.filter((j) => j.state === "DONE").sort((a, b) => due(b) - due(a));
  return [...open, ...done].map((j) => {
    const latest = j.agentRuns[0] ?? null;
    return {
      id: j.id,
      service: j.service,
      period: j.period,
      fy: j.fy,
      title: j.title,
      state: j.state,
      internalDue: j.internalDueOn ? formatDate(j.internalDueOn) : "—",
      assignee: j.assigneeId ? (nameOf.get(j.assigneeId) ?? "—") : "Not assigned",
      run: latest ? { href: `/agents/${latest.agent}/runs/${latest.id}`, attempt: latest.attempt } : null,
    };
  });
}
