// "What should I do now?" — the single most important job for a person, from the same data as the
// "Waiting for you" list on /agents: jobs they prepare or review on which the state machine (and
// the close-loop rule) lets them act now. Ranked by the Daily Coach ranking (coach-rank.ts over
// src/lib/agents/coach/rank.ts: statutory overdue, internal overdue, then the coach's score), so
// /focus, the companion and "My day" agree. The ranking is injectable (deps.rank); defaultRank
// (overdue first, then internal and statutory due dates) remains for callers that want it.
//
// Actions link to the existing screens (agent page, pack review screen); nothing here runs an
// agent, submits, approves, files or closes. Close-loop steps (Mark filed, Record Turia close)
// go to the job's assignee — the person who files — or to the reviewer when there is no assignee.
import type { FirmService, JobTaskState } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { canUseAgents, reviewActions } from "@/lib/agents/access";
import { ChecklistPackSchema } from "@/lib/agents/core/checklist";
import { formatDate } from "@/lib/agents/core/format";
import { openQuestions as toOpenQuestions } from "@/lib/agents/core/guardrails/review";
import { latestPackQuery, type AnyAgent, type FirmDb } from "@/lib/agents/core/runner";
import { agentForJob, visibleAgents } from "@/lib/agents/registry";
import { canActOnJob } from "@/lib/close-loop/actions";
import { ackRefFor } from "@/lib/close-loop/review";
import { DAY_MS, istDayStart } from "@/lib/ist";
import { coachRank } from "./coach-rank";
import { NEXT_TASK_CONTRACT_VERSION, type NextTask, type NextTaskAction, type NextTaskView } from "./contract";
import { portalNoteFor, sopSteps, stepChecklist, type SopContext } from "./sop-steps";

/** States in which a job can be waiting for someone. */
export const QUEUE_STATES: readonly JobTaskState[] = ["ASSIGNED", "IN_PREP", "AGENT_DONE", "IN_REVIEW", "APPROVED", "FILED_BY_HUMAN", "CLOSING"];

export type LatestRun = { id: string; agent: string; reviewNotes: string | null; blockFails: number; warnFails: number };

export type JobForAction = {
  id: string;
  state: JobTaskState;
  service: FirmService;
  assigneeId: string | null;
  reviewerId: string | null;
  /** No agent for this job (a Turia task no rule maps, ADR-003 amendment): prepared by hand. */
  agentless?: boolean;
};

export type NextTaskCandidate = JobForAction & {
  title: string;
  period: string;
  fy: string;
  internalDueOn: Date | null;
  statutoryDueOn: Date | null;
  createdAt: Date;
  clientCode: string;
  clientName: string;
  latestRun: LatestRun | null;
  action: NextTaskAction;
  part: NextTask["job"]["part"];
};

/** A ranking: candidates in the order to show them, each with an optional "why first" sentence. */
export type RankFn = (candidates: readonly NextTaskCandidate[], now: Date) => readonly (NextTaskCandidate | { candidate: NextTaskCandidate; reason?: string | null })[];

export type NextTaskDeps = {
  db: FirmDb;
  now?: () => Date;
  /** Agents shown in the UI (default: visibleAgents()). */
  agents?: readonly AnyAgent[];
  /** Ranking seam (default: coachRank, the Daily Coach ranking). */
  rank?: RankFn;
};

const reviewHref = (agent: string, runId: string) => `/agents/${agent}/runs/${runId}`;
export const workspaceHref = (jobId: string) => `/workspace/${jobId}`;

/**
 * The one action this person can take on the job now, or null. `queue` = deciding for the
 * person's own next-task queue (close-loop steps only for the person who files); the guided
 * workspace passes false so anyone the close-loop rule admits sees the step.
 */
export function actionFor(
  user: SessionUser,
  job: JobForAction,
  latest: LatestRun | null,
  agents: readonly AnyAgent[],
  now: Date,
  opts: { queue: boolean } = { queue: true },
): NextTaskAction | null {
  if (!user) return null;
  const can = reviewActions(user, job, latest?.blockFails ?? 0, now);
  const agent = (latest && agents.find((a) => a.key === latest.agent)) ?? agentForJob(job, agents);
  if (can.run) {
    return agent
      ? { kind: "run-agent", label: "Run agent", href: `/agents/${agent.key}`, agent: agent.key, runId: null }
      : { kind: "prepare-by-hand", label: "Open the job", href: workspaceHref(job.id), agent: null, runId: null };
  }
  if (!latest) return null;
  const open = (kind: NextTaskAction["kind"], label: string): NextTaskAction => ({ kind, label, href: reviewHref(latest.agent, latest.id), agent: latest.agent, runId: latest.id });
  if (can.submit) return open("submit", "Open pack to submit");
  if (can.approve || can.requestChanges) return open("review", "Review pack");
  const closes = !opts.queue || (job.assigneeId ? job.assigneeId === user.id : job.reviewerId === user.id);
  if (closes && canActOnJob(user, job)) {
    if (job.state === "APPROVED") return open("mark-filed", "Mark filed");
    if (job.state === "FILED_BY_HUMAN" || job.state === "CLOSING") return open("turia-close", "Record Turia close");
  }
  return null;
}

export function partOf(userId: string, job: Pick<JobForAction, "assigneeId" | "reviewerId">): NextTask["job"]["part"] {
  const prepares = job.assigneeId === userId;
  const reviews = job.reviewerId === userId;
  return prepares && reviews ? "Preparer and reviewer" : prepares ? "Preparer" : "Reviewer";
}

// ------------------------------------------------------------------ ranking

const isOverdue = (c: Pick<NextTaskCandidate, "internalDueOn" | "statutoryDueOn">, today: Date) =>
  (!!c.internalDueOn && c.internalDueOn < today) || (!!c.statutoryDueOn && c.statutoryDueOn < today);
const byDate = (a: Date | null, b: Date | null) => (a && b ? a.getTime() - b.getTime() : a ? -1 : b ? 1 : 0);

/** Overdue first; then internal due, then statutory due (missing dates last); then oldest job. */
export function defaultRank(candidates: readonly NextTaskCandidate[], now: Date): { candidate: NextTaskCandidate; reason: string | null }[] {
  const today = istDayStart(now);
  const sorted = [...candidates].sort(
    (a, b) =>
      Number(isOverdue(b, today)) - Number(isOverdue(a, today)) ||
      byDate(a.internalDueOn, b.internalDueOn) ||
      byDate(a.statutoryDueOn, b.statutoryDueOn) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  return sorted.map((c, i) => {
    let reason: string | null = null;
    if (i === 0 && sorted.length > 1) reason = isOverdue(c, today) ? "It comes first because it is overdue." : "It comes first because it is due soonest of your open jobs.";
    return { candidate: c, reason };
  });
}

// ------------------------------------------------------------------ reading

/** Every job waiting for this person, with the action they can take (unranked). */
export async function listNextTaskCandidates(user: SessionUser, deps: NextTaskDeps): Promise<NextTaskCandidate[]> {
  if (!user || !canUseAgents(user)) return [];
  const now = deps.now?.() ?? new Date();
  const agents = deps.agents ?? visibleAgents();
  const jobs = await deps.db.jobTask.findMany({
    where: { AND: [{ OR: [{ assigneeId: user.id }, { reviewerId: user.id }] }, { state: { in: [...QUEUE_STATES] } }] },
    orderBy: [{ internalDueOn: "asc" }, { createdAt: "asc" }],
    take: 200,
    select: {
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
      agentless: true,
      firmClient: { select: { clientCode: true, client: { select: { name: true } } } },
      agentRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { id: true, agent: true, reviewNotes: true, checklist: { where: { status: "fail" }, select: { severity: true } } } },
    },
  });
  const out: NextTaskCandidate[] = [];
  for (const j of jobs) {
    const r = j.agentRuns[0];
    const latest: LatestRun | null = r
      ? { id: r.id, agent: r.agent, reviewNotes: r.reviewNotes, blockFails: r.checklist.filter((c) => c.severity === "block").length, warnFails: r.checklist.filter((c) => c.severity === "warn").length }
      : null;
    const action = actionFor(user, j, latest, agents, now, { queue: true });
    if (!action) continue;
    out.push({
      id: j.id,
      title: j.title,
      service: j.service,
      period: j.period,
      fy: j.fy,
      state: j.state,
      assigneeId: j.assigneeId,
      reviewerId: j.reviewerId,
      internalDueOn: j.internalDueOn,
      statutoryDueOn: j.statutoryDueOn,
      createdAt: j.createdAt,
      ...(j.agentless ? { agentless: true } : {}),
      clientCode: j.firmClient.clientCode,
      clientName: j.firmClient.client?.name ?? "",
      latestRun: latest,
      action,
      part: partOf(user.id, j),
    });
  }
  return out;
}

const WHY: Readonly<Record<NextTaskAction["kind"], string>> = {
  "run-agent": "You prepare this job and it is ready for the agent.",
  "prepare-by-hand": "You prepare this job. There is no agent for this service yet, so prepare it by hand.",
  submit: "The agent has finished the draft pack. Check its findings and submit it for review.",
  review: "The pack is waiting for your review.",
  "mark-filed": "The pack is approved. File it yourself, then record the filing here.",
  "turia-close": "The filing is recorded. Close the Turia task with the time spent so the job can close.",
};

function dueSentence(c: Pick<NextTaskCandidate, "internalDueOn" | "statutoryDueOn">, now: Date): string {
  const today = istDayStart(now).getTime();
  if (c.internalDueOn) {
    const days = Math.round((today - istDayStart(c.internalDueOn).getTime()) / DAY_MS);
    const date = formatDate(c.internalDueOn);
    const stat = c.statutoryDueOn ? ` The statutory due date is ${formatDate(c.statutoryDueOn)}.` : "";
    if (days > 0) return `Its internal due date was ${date}, ${days} day${days === 1 ? "" : "s"} ago.${stat}`;
    if (days === 0) return `Its internal due date is today, ${date}.${stat}`;
    return `Internal due ${date}.${stat}`;
  }
  if (c.statutoryDueOn) return `It has no internal due date; the statutory due date is ${formatDate(c.statutoryDueOn)}.`;
  return "It has no due date yet.";
}

/** Plain sentences: what it is, when it is due, why it comes first. */
export function whyText(c: NextTaskCandidate, now: Date, rankReason: string | null): string {
  return [WHY[c.action.kind], dueSentence(c, now), rankReason].filter(Boolean).join(" ");
}

export type SopFacts = Pick<SopContext, "agentTitle" | "requiredInputs" | "packVersion" | "ruleCount">;

/** Rule count per published pack version ("key@version"). Versions are immutable, so this never goes stale. */
const RULE_COUNTS = new Map<string, number | null>();

/** The agent for the service and its active SOP pack (version, rule count; built-in pack when none is published). */
export async function sopFacts(db: FirmDb, service: FirmService, agentKey: string | null, agents: readonly AnyAgent[], agentless = false): Promise<SopFacts & { agent: AnyAgent | null }> {
  const agent = (agentKey && agents.find((a) => a.key === agentKey)) || agentForJob({ service, agentless }, agents);
  if (!agent) return { agent: null, agentTitle: null, requiredInputs: [], packVersion: null, ruleCount: null };
  // The version alone first: the pack's checklist JSON is read once per version per process, not on every render.
  const pack = await db.sopPack.findFirst({ ...latestPackQuery(agent.sopPackKey), select: { version: true } });
  const key = pack ? `${agent.sopPackKey}@${pack.version}` : null;
  if (key && !RULE_COUNTS.has(key)) {
    const full = await db.sopPack.findFirst({ where: { key: agent.sopPackKey, version: pack!.version }, select: { checklist: true } });
    const parsed = ChecklistPackSchema.safeParse(full?.checklist);
    RULE_COUNTS.set(key, parsed.success ? parsed.data.rules.length : null);
  }
  return {
    agent,
    agentTitle: agent.title,
    requiredInputs: agent.requiredInputs ?? [],
    packVersion: pack?.version ?? null,
    ruleCount: key ? (RULE_COUNTS.get(key) ?? null) : agent.defaultChecklist.rules.length,
  };
}

/** ADR-008 open questions on a run (abstentions first). */
export async function runOpenQuestions(db: FirmDb, runId: string | null): Promise<NextTask["openQuestions"]> {
  if (!runId) return [];
  const rows = await db.checklistResult.findMany({ where: { agentRunId: runId, status: "na" }, orderBy: { createdAt: "asc" }, select: { ruleId: true, message: true, evidence: true } });
  return toOpenQuestions(
    rows.map((r) => {
      const ev = (r.evidence ?? {}) as { location?: string; flags?: unknown };
      return { ruleId: r.ruleId, message: r.message, flags: Array.isArray(ev.flags) ? ev.flags.map(String) : [], location: ev.location ?? null };
    }),
  );
}

/** Ranked queue (ranker output normalised). */
export function rankCandidates(candidates: readonly NextTaskCandidate[], now: Date, rank: RankFn = coachRank): { candidate: NextTaskCandidate; reason: string | null }[] {
  return rank(candidates, now).map((x) => ("candidate" in x ? { candidate: x.candidate, reason: x.reason ?? null } : { candidate: x, reason: null }));
}

/**
 * Every job waiting for this person, in next-task order: the first one is getNextTask's choice.
 * The companion side panel reads its queue from here (src/lib/companion/provider.ts
 * fromNextTaskView), so the panel and /focus always agree.
 */
export async function rankedNextTasks(user: SessionUser, deps: NextTaskDeps): Promise<{ candidate: NextTaskCandidate; reason: string | null }[]> {
  const now = deps.now?.() ?? new Date();
  return rankCandidates(await listNextTaskCandidates(user, { ...deps, now: () => now }), now, deps.rank);
}

async function buildTask(c: NextTaskCandidate, reason: string | null, deps: NextTaskDeps, now: Date): Promise<NextTask> {
  const agents = deps.agents ?? visibleAgents();
  const [facts, questions] = await Promise.all([sopFacts(deps.db, c.service, c.latestRun?.agent ?? c.action.agent, agents, c.agentless), runOpenQuestions(deps.db, c.latestRun?.id ?? null)]);
  const ctx: SopContext = {
    service: c.service,
    agentTitle: facts.agentTitle,
    requiredInputs: facts.requiredInputs,
    packVersion: facts.packVersion,
    ruleCount: facts.ruleCount,
    blockFails: c.latestRun?.blockFails ?? 0,
    warnFails: c.latestRun?.warnFails ?? 0,
    openQuestions: questions.length,
    ack: ackRefFor(c.service),
    reviewNotes: c.state === "IN_PREP" ? c.latestRun?.reviewNotes ?? null : null,
  };
  const today = istDayStart(now);
  return {
    job: {
      id: c.id,
      title: c.title,
      service: c.service,
      period: c.period,
      fy: c.fy,
      clientCode: c.clientCode,
      clientName: c.clientName,
      internalDue: c.internalDueOn ? formatDate(c.internalDueOn) : null,
      statutoryDue: c.statutoryDueOn ? formatDate(c.statutoryDueOn) : null,
      overdue: isOverdue(c, today),
      part: c.part,
    },
    state: c.state,
    action: c.action,
    why: whyText(c, now, reason),
    href: workspaceHref(c.id),
    sopSteps: sopSteps(c.state, ctx),
    checklist: stepChecklist(c.state, ctx),
    openQuestions: questions,
    portalNote: portalNoteFor(c.service),
  };
}

/** The full view: the next task (or "clear") and how many more are waiting. */
export async function getNextTaskView(user: SessionUser, deps: NextTaskDeps): Promise<NextTaskView> {
  const now = deps.now?.() ?? new Date();
  const ranked = await rankedNextTasks(user, { ...deps, now: () => now });
  const top = ranked[0];
  return {
    version: NEXT_TASK_CONTRACT_VERSION,
    status: top ? "task" : "clear",
    generatedAt: now.toISOString(),
    remaining: Math.max(0, ranked.length - 1),
    task: top ? await buildTask(top.candidate, top.reason, deps, now) : null,
  };
}

/** The single most important thing this person should do now, or null when nothing is waiting. */
export async function getNextTask(user: SessionUser, deps: NextTaskDeps): Promise<NextTask | null> {
  return (await getNextTaskView(user, deps)).task;
}
