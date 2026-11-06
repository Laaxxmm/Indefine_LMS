// What the Turia pull should do for one mirrored task: create a job, update its people and due
// date, record Turia's completion, flag it, or wait for a mapping. Pure: the sync applies the plan
// (mode "on") or only lists it (mode "dry-run"). Running the same plan twice changes nothing the
// second time, because every change is "make this field equal Turia's value".
//
// Rules this module keeps (ADR-003 amendment):
//   - a job never moves through the state machine here: a new job starts ASSIGNED (as onboarding's
//     do), and an existing job's state is never touched, so nothing can go backwards;
//   - only the assignee, reviewer and internal due date follow Turia, and only to a mapped person or
//     a real date (an unmapped person or a blank date never clears what the job has);
//   - a DONE job is left alone;
//   - a task Turia already shows completed or cancelled when first seen makes no job (history is
//     not imported); a linked task that completes is recorded for the close gate;
//   - a task that disappears from Turia, or is cancelled, flags the job (turiaMissingAt), never
//     removes it; the flag clears if the task comes back.
import type { FirmService, JobTaskState } from "@prisma/client";
import { isCancelled, isCompleted, type MirrorFields } from "./normalise";
import { monthPeriodOf, parsePeriod, type Frequency, type PeriodResult } from "./period";
import { AGENT_SERVICES, guessService, matchRule, type RuleRow } from "./rules";

export type ClientState =
  | { status: "ready"; firmClientId: string; clientCode: string }
  | { status: "new"; lmsClientId: string; clientCode: string }
  | { status: "unmatched" }
  | { status: "ignored" };

export type LinkedJob = {
  id: string;
  state: JobTaskState;
  assigneeId: string | null;
  reviewerId: string | null;
  internalDueOn: Date | null;
  turiaMissingAt: Date | null;
  turiaNote: string | null;
  /** A close recorded from Turia already exists (TuriaSync closeTask, mode PULL). */
  hasPullClose: boolean;
};

export type StatutoryDueFn = (calendarRuleId: string, fy: string, period: string, frequency: Frequency) => Date | null;

export interface PlanContext {
  mirror: MirrorFields & { missingSince: Date | null };
  client: ClientState;
  /** Turia user id -> LMS user id, or null when the person is not mapped. */
  personOf: (turiaUserId: string) => string | null;
  rules: readonly RuleRow[];
  job: LinkedJob | null;
  statutoryDue?: StatutoryDueFn;
}

export interface JobDraft {
  service: FirmService;
  title: string;
  fy: string;
  period: string;
  agentless: boolean;
  frequency: Frequency | null;
  ruleId: string | null;
  ruleLabel: string | null;
  periodFrom: PeriodResult["from"];
  assigneeId: string;
  reviewerId: string | null;
  internalDueOn: Date | null;
  statutoryDueOn: Date | null;
  /** Why the task has no agent, when it has none. */
  agentlessWhy: "no rule" | "no period" | "rule without agent" | "no agent for service" | null;
}

export type JobChange =
  | { field: "assigneeId" | "reviewerId"; to: string }
  | { field: "internalDueOn"; to: Date }
  | { field: "flag"; to: { at: Date; note: string } }
  | { field: "unflag" };

export type WaitReason = "client-unmatched" | "client-ignored" | "no-assignee" | "assignee-unmatched" | "closed-in-turia";

export type Plan =
  | { kind: "create"; draft: JobDraft; reviewerUnmatched: boolean }
  | { kind: "update"; jobId: string; changes: JobChange[]; complete: boolean }
  | { kind: "nothing"; jobId: string | null }
  | { kind: "wait"; reason: WaitReason };

export const MISSING_NOTE = "This task is no longer in Turia's task list. Check it in Turia; the job is kept.";
export const CANCELLED_NOTE = "This task is cancelled in Turia. Check it in Turia; the job is kept.";

const TITLE_MAX = 120;

/** The first mapped person of a Turia list, and whether anyone on it is unmapped. */
function firstMapped(list: MirrorFields["assignees"], personOf: PlanContext["personOf"]): { userId: string | null; unmatched: boolean } {
  let userId: string | null = null;
  let unmatched = false;
  for (const p of list) {
    const u = personOf(p.id);
    if (u && !userId) userId = u;
    if (!u) unmatched = true;
  }
  return { userId, unmatched };
}

/** Title of a job no rule maps: Turia's task name with its number, so two such tasks never share a job. */
export function agentlessTitle(m: Pick<MirrorFields, "taskName" | "identity" | "id">): string {
  const tag = ` (${m.identity ?? m.id})`;
  return m.taskName.slice(0, TITLE_MAX - tag.length) + tag;
}

/** Service, title, period and agent for a task (rules first; unmapped tasks keep Turia's dates). */
export function jobShape(m: MirrorFields, rules: readonly RuleRow[], now: Date, statutoryDue?: StatutoryDueFn): Omit<JobDraft, "assigneeId" | "reviewerId" | "internalDueOn"> {
  const rule = matchRule(m, rules);
  const period = rule ? parsePeriod(m.taskName, rule.frequency, m.dueOn) : null;
  if (rule && period) {
    const hasAgent = AGENT_SERVICES.includes(rule.service);
    const agentless = !rule.useAgent || !hasAgent;
    return {
      service: rule.service,
      title: rule.title,
      fy: period.fy,
      period: period.period,
      agentless,
      frequency: rule.frequency,
      ruleId: rule.id,
      ruleLabel: rule.label,
      periodFrom: period.from,
      statutoryDueOn: rule.calendarRuleId && statutoryDue ? statutoryDue(rule.calendarRuleId, period.fy, period.period, rule.frequency) : null,
      agentlessWhy: !rule.useAgent ? "rule without agent" : !hasAgent ? "no agent for service" : null,
    };
  }
  const p = monthPeriodOf(m.dueOn ?? m.turiaCreatedOn ?? now);
  return {
    service: guessService(m),
    title: agentlessTitle(m),
    fy: p.fy,
    period: p.period,
    agentless: true,
    frequency: null,
    ruleId: rule?.id ?? null,
    ruleLabel: rule?.label ?? null,
    periodFrom: p.from,
    statutoryDueOn: null,
    agentlessWhy: rule ? "no period" : "no rule",
  };
}

const sameDay = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Changes that make a linked job match Turia (people, due date, flag). Empty when it already does. */
export function jobChanges(job: LinkedJob, ctx: PlanContext, now: Date): JobChange[] {
  if (job.state === "DONE") return [];
  const m = ctx.mirror;
  const out: JobChange[] = [];
  const a = firstMapped(m.assignees, ctx.personOf).userId;
  const r = firstMapped(m.reviewers, ctx.personOf).userId;
  if (a && a !== job.assigneeId) out.push({ field: "assigneeId", to: a });
  if (r && r !== job.reviewerId) out.push({ field: "reviewerId", to: r });
  if (m.dueOn && !sameDay(m.dueOn, job.internalDueOn)) out.push({ field: "internalDueOn", to: m.dueOn });
  const note = m.missingSince ? MISSING_NOTE : isCancelled(m) ? CANCELLED_NOTE : null;
  if (note && (!job.turiaMissingAt || job.turiaNote !== note)) out.push({ field: "flag", to: { at: job.turiaMissingAt ?? m.missingSince ?? now, note } });
  if (!note && job.turiaMissingAt) out.push({ field: "unflag" });
  return out;
}

export function planTask(ctx: PlanContext, now: Date): Plan {
  const m = ctx.mirror;
  if (ctx.job) {
    const changes = jobChanges(ctx.job, ctx, now);
    const complete = isCompleted(m) && !ctx.job.hasPullClose && ctx.job.state !== "DONE";
    return changes.length || complete ? { kind: "update", jobId: ctx.job.id, changes, complete } : { kind: "nothing", jobId: ctx.job.id };
  }
  if (isCompleted(m) || isCancelled(m) || m.missingSince) return { kind: "wait", reason: "closed-in-turia" };
  if (ctx.client.status === "unmatched") return { kind: "wait", reason: "client-unmatched" };
  if (ctx.client.status === "ignored") return { kind: "wait", reason: "client-ignored" };
  if (!m.assignees.length) return { kind: "wait", reason: "no-assignee" };
  const assignee = firstMapped(m.assignees, ctx.personOf);
  if (!assignee.userId) return { kind: "wait", reason: "assignee-unmatched" };
  const reviewer = firstMapped(m.reviewers, ctx.personOf);
  return {
    kind: "create",
    draft: { ...jobShape(m, ctx.rules, now, ctx.statutoryDue), assigneeId: assignee.userId, reviewerId: reviewer.userId, internalDueOn: m.dueOn },
    reviewerUnmatched: reviewer.unmatched && !reviewer.userId,
  };
}
