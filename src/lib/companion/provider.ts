// The companion's "current task": which job comes first for a person, and what the side panel
// shows for it (steps, checklist, copy values, link). Read-only: every query here is a find; the
// companion never changes a job.
//
// Two stages, so the selection can be swapped without touching the rest:
//
//   1. NextTaskSource.rank(user, now) → RankedJob[]   which jobs, best first (the seam)
//   2. createCompanionProvider().nextTask()           details for the first job + the response
//
// fromNextTaskView is the production source: the shared next-task queue
// (src/lib/workspace/next-task.ts rankedNextTasks, the same list getNextTask and /focus take the
// first job from, ranked by the Daily Coach ranking), so the side panel and /focus always agree,
// "why" text included. dbNextTaskSource is this module's own earlier selection, kept for tests
// and as a fallback. Its rules:
//   - jobs the person prepares (assignee) or reviews (reviewer) — a personal queue for every role;
//     managers and partners see their own jobs here, not the whole firm's;
//   - only jobs they can act on now: ASSIGNED / IN_PREP / AGENT_DONE / IN_REVIEW by the same
//     reviewActions() test as "Waiting for you" on /agents (agents/views.ts listMyJobs), plus the
//     human-only close-loop steps for the assignee: APPROVED (file it on the portal yourself, then
//     Mark filed) and FILED_BY_HUMAN / CLOSING until the Turia close is recorded;
//   - order: overdue first (internal or statutory due day before today, IST), then internal due,
//     then statutory due (earliest first, missing dates last), then oldest job.
//
// Mapping next task → RankedJob (fromNextTaskView below):
//   jobId, title, service, period, fy, state, clientName, clientCode → same-named fields
//   the person's part on the job (assignee / reviewer / both)        → part
//   internal / statutory due dates                                   → internalDueOn / statutoryDueOn (Date)
//   overdue flag                                                     → overdue
//   what the person can do now                                       → action (collect · prepare · check ·
//                                                                       review · file · close; actionFor() below
//                                                                       derives it from state + role if absent)
// Its "why" text replaces whyFor() (RankedJob.why). Everything after rank() stays as is.
import type { FirmService, JobTaskState, PrismaClient } from "@prisma/client";
import { reviewActions } from "@/lib/agents/access";
import { rankedNextTasks, whyText, type NextTaskCandidate, type NextTaskDeps as SharedNextTaskDeps } from "@/lib/workspace/next-task";
import { formatDate } from "@/lib/agents/core/format";
import { getAgent, visibleAgents } from "@/lib/agents/registry";
import { istDayKey } from "@/lib/ist";
import type { CompanionUser } from "./access";
import { COMPANION_QUEUE_MAX } from "./config";
import { last4, maskIdentifiersInText } from "./mask";
import { MSG } from "./messages";
import { SERVICE_SOP, checklistFor, nextActionFor, stepsFor, type Action } from "./steps";
import type { CompanionNextTaskResponse, CompanionQueueItem, JobPart } from "./types";
import { valuesFor } from "./values";

export type CompanionDb = Pick<PrismaClient, "jobTask">;

/** One job in the person's ranked queue — everything the selection stage has to supply. */
export type RankedJob = {
  jobId: string;
  title: string;
  service: FirmService;
  period: string;
  fy: string;
  state: JobTaskState;
  clientName: string;
  clientCode: string;
  part: JobPart;
  action: Action;
  internalDueOn: Date | null;
  statutoryDueOn: Date | null;
  overdue: boolean;
  /** Why it is next, when the source says (the shared queue does); otherwise whyFor() writes it. */
  why?: string;
};

/** Which jobs, best first. fromNextTaskView in production; dbNextTaskSource in older tests. */
export interface NextTaskSource {
  rank(user: CompanionUser, now: Date): Promise<RankedJob[]>;
}

export interface CompanionProvider {
  nextTask(user: CompanionUser, now: Date): Promise<CompanionNextTaskResponse>;
}

// ------------------------------------------------------------------ pure selection rules

const ACTIONABLE: JobTaskState[] = ["ASSIGNED", "IN_PREP", "AGENT_DONE", "IN_REVIEW", "APPROVED", "FILED_BY_HUMAN", "CLOSING"];

type ActionJob = { id: string; state: JobTaskState; service: FirmService; assigneeId: string | null; reviewerId: string | null };

/** What the person can do on the job now, or null when nothing (the job is left out of their queue). */
export function actionFor(user: CompanionUser, job: ActionJob, blockFails: number, turiaClosed: boolean, now: Date): Action | null {
  const can = reviewActions(user, job, blockFails, now);
  const assignee = !!user && job.assigneeId === user.id;
  switch (job.state) {
    case "ASSIGNED":
      return can.run ? "collect" : null;
    case "IN_PREP":
      return can.run ? "prepare" : null;
    case "AGENT_DONE":
      return can.submit ? "check" : null;
    case "IN_REVIEW":
      return can.approve || can.requestChanges ? "review" : null;
    case "APPROVED":
      return assignee ? "file" : null;
    case "FILED_BY_HUMAN":
    case "CLOSING":
      return assignee && !turiaClosed ? "close" : null;
    default:
      return null;
  }
}

export function partOf(userId: string, job: { assigneeId: string | null; reviewerId: string | null }): JobPart {
  const prepares = job.assigneeId === userId;
  const reviews = job.reviewerId === userId;
  return prepares && reviews ? "Preparer and reviewer" : prepares ? "Preparer" : "Reviewer";
}

/** A due day before today (IST calendar days) on either date. */
export function isOverdue(job: { internalDueOn: Date | null; statutoryDueOn: Date | null }, now: Date): boolean {
  const today = istDayKey(now);
  return [job.internalDueOn, job.statutoryDueOn].some((d) => !!d && istDayKey(d) < today);
}

const time = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);

export type SortKey = { overdue: boolean; internalDueOn: Date | null; statutoryDueOn: Date | null; createdAt: Date; id: string };

/** Overdue first, then internal due, then statutory due (missing dates last), then oldest, then id. */
export function compareJobs(a: SortKey, b: SortKey): number {
  return (
    Number(b.overdue) - Number(a.overdue) ||
    time(a.internalDueOn) - time(b.internalDueOn) ||
    time(a.statutoryDueOn) - time(b.statutoryDueOn) ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Why this job is first, in one or two plain sentences. */
export function whyFor(job: Pick<RankedJob, "internalDueOn" | "statutoryDueOn" | "overdue">, openCount: number, now: Date): string {
  const today = istDayKey(now);
  const passed = (d: Date | null) => !!d && istDayKey(d) < today;
  let due: string;
  if (passed(job.statutoryDueOn)) due = `Overdue: the statutory due date was ${formatDate(job.statutoryDueOn!)}.`;
  else if (passed(job.internalDueOn)) due = `Overdue: the internal due date was ${formatDate(job.internalDueOn!)}.`;
  else if (job.internalDueOn) due = `Internal due ${formatDate(job.internalDueOn)}${job.statutoryDueOn ? `, statutory due ${formatDate(job.statutoryDueOn)}` : ""}.`;
  else if (job.statutoryDueOn) due = `Statutory due ${formatDate(job.statutoryDueOn)}.`;
  else due = "No due date is set.";
  let rank: string;
  if (openCount <= 1) rank = "It is the only job waiting for you.";
  else if (job.overdue) rank = `It is the most overdue of your ${openCount} open jobs.`;
  else if (job.internalDueOn || job.statutoryDueOn) rank = `It is due soonest of your ${openCount} open jobs.`;
  else rank = `It has waited longest of your ${openCount} open jobs.`;
  return `${due} ${rank}`;
}

// ------------------------------------------------------------------ stage 1: this module's own selection

const RANK_SELECT = {
  id: true,
  title: true,
  service: true,
  period: true,
  fy: true,
  state: true,
  assigneeId: true,
  reviewerId: true,
  internalDueOn: true,
  statutoryDueOn: true,
  createdAt: true,
  firmClient: { select: { clientCode: true, client: { select: { name: true } } } },
  agentRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { checklist: { where: { status: "fail", severity: "block" }, select: { id: true } } } },
  turiaSyncs: { where: { operation: "closeTask", status: "CLOSED" }, take: 1, select: { id: true } },
} as const;

/** Most jobs considered per person (a personal queue is far smaller). */
const RANK_TAKE = 200;

export function dbNextTaskSource(db: CompanionDb): NextTaskSource {
  return {
    async rank(user, now) {
      if (!user) return [];
      const jobs = await db.jobTask.findMany({
        where: { AND: [{ OR: [{ assigneeId: user.id }, { reviewerId: user.id }] }, { state: { in: ACTIONABLE } }] },
        orderBy: [{ internalDueOn: "asc" }, { createdAt: "asc" }],
        take: RANK_TAKE,
        select: RANK_SELECT,
      });
      const rows: Array<{ key: SortKey; job: RankedJob }> = [];
      for (const j of jobs) {
        const action = actionFor(user, j, j.agentRuns[0]?.checklist.length ?? 0, j.turiaSyncs.length > 0, now);
        if (!action) continue;
        const overdue = isOverdue(j, now);
        rows.push({
          key: { overdue, internalDueOn: j.internalDueOn, statutoryDueOn: j.statutoryDueOn, createdAt: j.createdAt, id: j.id },
          job: {
            jobId: j.id,
            title: j.title,
            service: j.service,
            period: j.period,
            fy: j.fy,
            state: j.state,
            clientName: j.firmClient.client?.name ?? "",
            clientCode: j.firmClient.clientCode,
            part: partOf(user.id, j),
            action,
            internalDueOn: j.internalDueOn,
            statutoryDueOn: j.statutoryDueOn,
            overdue,
          },
        });
      }
      return rows.sort((a, b) => compareJobs(a.key, b.key)).map((r) => r.job);
    },
  };
}

// ------------------------------------------------------------------ stage 1: the shared next-task queue

/** The panel's verb for a next-task action. */
export function companionActionFor(c: Pick<NextTaskCandidate, "state" | "action">): Action {
  switch (c.action.kind) {
    case "submit":
      return "check";
    case "review":
      return "review";
    case "mark-filed":
      return "file";
    case "turia-close":
      return "close";
    default:
      return c.state === "ASSIGNED" ? "collect" : "prepare"; // run-agent or prepare-by-hand
  }
}

/**
 * The companion's queue from the shared next-task queue: the first job is getNextTask's choice and
 * its why is the text /focus shows. Read-only, like everything here.
 */
export function fromNextTaskView(deps: Omit<SharedNextTaskDeps, "now">): NextTaskSource {
  return {
    async rank(user, now) {
      if (!user) return [];
      const ranked = await rankedNextTasks(user, { ...deps, now: () => now });
      return ranked.map(({ candidate: c, reason }) => ({
        jobId: c.id,
        title: c.title,
        service: c.service,
        period: c.period,
        fy: c.fy,
        state: c.state,
        clientName: c.clientName,
        clientCode: c.clientCode,
        part: c.part,
        action: companionActionFor(c),
        internalDueOn: c.internalDueOn,
        statutoryDueOn: c.statutoryDueOn,
        overdue: isOverdue(c, now),
        why: whyText(c, now, reason),
      }));
    },
  };
}

// ------------------------------------------------------------------ stage 2: details + response

const DETAIL_SELECT = {
  id: true,
  firmClient: { select: { client: { select: { name: true, gstin: true, pan: true, cin: true } } } },
  agentRuns: {
    orderBy: { startedAt: "desc" },
    take: 10,
    select: { id: true, agent: true, status: true, figures: true, checklist: { where: { status: "fail" }, select: { severity: true } } },
  },
} as const;

const dayOrNull = (d: Date | null) => (d ? formatDate(d) : null);

export type CompanionProviderDeps = { db: CompanionDb; source?: NextTaskSource };

export function createCompanionProvider(deps: CompanionProviderDeps): CompanionProvider {
  const source = deps.source ?? dbNextTaskSource(deps.db);
  return {
    async nextTask(user, now) {
      const generatedAt = now.toISOString();
      const ranked = user ? await source.rank(user, now) : [];
      for (const [i, job] of ranked.entries()) {
        // The details are read with the person's own scope again, so a swapped-in source can never
        // widen what a token sees.
        const detail = await deps.db.jobTask.findFirst({ where: { id: job.jobId, OR: [{ assigneeId: user.id }, { reviewerId: user.id }] }, select: DETAIL_SELECT });
        if (!detail) continue;
        const rest = ranked.filter((_, k) => k !== i);
        const latest = detail.agentRuns[0] ?? null;
        const approved = detail.agentRuns.find((r) => r.status === "APPROVED") ?? null;
        const agentTitle = (latest && getAgent(latest.agent)?.title) || visibleAgents().find((a) => a.service === job.service)?.title || null;
        const client = detail.firmClient.client;
        const ctx = { service: job.service, period: job.period, fy: job.fy, agentTitle };
        const steps = stepsFor(ctx, job.action);
        const filingStage = job.action === "file" || job.action === "close";
        const later: CompanionQueueItem[] = rest.slice(0, COMPANION_QUEUE_MAX).map((r) => ({
          jobId: r.jobId,
          title: maskIdentifiersInText(r.title),
          clientName: r.clientName,
          period: r.period,
          due: dayOrNull(r.internalDueOn ?? r.statutoryDueOn),
          overdue: r.overdue,
        }));
        return {
          status: "task",
          generatedAt,
          task: {
            jobId: job.jobId,
            job: {
              title: maskIdentifiersInText(job.title),
              service: job.service,
              serviceLabel: SERVICE_SOP[job.service].label,
              period: job.period,
              fy: job.fy,
              state: job.state,
              clientName: client?.name ?? job.clientName,
              clientCode: job.clientCode,
            },
            part: job.part,
            why: job.why ?? whyFor(job, ranked.length, now),
            nextAction: nextActionFor(ctx, job.action),
            due: { internal: dayOrNull(job.internalDueOn), statutory: dayOrNull(job.statutoryDueOn), overdue: job.overdue },
            steps,
            currentStep: steps.find((s) => s.current)?.n ?? 1,
            checklist: checklistFor(
              {
                ...ctx,
                gstinLast4: job.service === "GST" ? last4(client?.gstin) : null,
                blockFails: latest?.checklist.filter((c) => c.severity === "block").length ?? 0,
                warnFails: latest?.checklist.filter((c) => c.severity === "warn").length ?? 0,
              },
              job.action,
            ),
            values: valuesFor({
              service: job.service,
              clientName: client?.name ?? job.clientName,
              clientCode: job.clientCode,
              period: job.period,
              fy: job.fy,
              gstin: client?.gstin ?? null,
              pan: client?.pan ?? null,
              cin: client?.cin ?? null,
              approvedFigures: filingStage ? (approved?.figures ?? null) : null,
            }),
            link: { path: latest ? `/agents/${encodeURIComponent(latest.agent)}/runs/${encodeURIComponent(latest.id)}` : "/agents", label: "Open in Firm OS" },
          },
          later,
          counts: { open: ranked.length, overdue: ranked.filter((r) => r.overdue).length },
        };
      }
      return { status: "none", generatedAt, message: MSG.caughtUp, counts: { open: 0, overdue: 0 } };
    },
  };
}
