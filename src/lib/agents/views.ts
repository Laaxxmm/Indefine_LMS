// Read models for the /agents pages and /admin/firm-os/mistakes. Server-side only; every query is
// scoped by access.ts so staff never load a run they may not see. Display formatting (₹ Indian
// grouping, DD MMM YYYY, IST) happens here so pages stay declarative.
import type { JobTaskState } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { canDecideMistakes, canUseAgents, canViewJob, jobScopeWhere, reviewActions, runScopeWhere, type ReviewActions } from "@/lib/agents/access";
import { ChecklistPackSchema, withPromotedRule, type ChecklistPack } from "@/lib/agents/core/checklist";
import { formatDate, formatDateTimeIst, formatInr } from "@/lib/agents/core/format";
import { openQuestions, type OpenQuestion } from "@/lib/agents/core/guardrails/review";
import { INJECTION_FLAG } from "@/lib/agents/core/guardrails/untrusted";
import { diffPacks, type PackDiff } from "@/lib/agents/core/mistakes";
import { latestPackQuery, type AnyAgent, type FirmDb } from "@/lib/agents/core/runner";
import { agentForJob, getAgent } from "@/lib/agents/registry";
import { httpsLink } from "@/lib/hardening/net";
import { auditRead } from "@/lib/audit/reads";
import { runFailureMessage } from "@/lib/errors";

export type RunRow = {
  id: string;
  agent: string;
  agentTitle: string;
  attempt: number;
  status: string;
  jobState: JobTaskState;
  jobTitle: string;
  period: string;
  fy: string;
  clientCode: string;
  startedAt: string;
  blockFails: number;
  warnFails: number;
};

const istTime = (d: Date | null | undefined) => (d ? `${formatDateTimeIst(d)} IST` : "—");

export async function listRuns(db: FirmDb, user: SessionUser, opts: { agent?: string; take?: number } = {}): Promise<RunRow[]> {
  const runs = await db.agentRun.findMany({
    where: { AND: [runScopeWhere(user), opts.agent ? { agent: opts.agent } : {}] },
    orderBy: { startedAt: "desc" },
    take: opts.take ?? 100,
    select: {
      id: true,
      agent: true,
      attempt: true,
      status: true,
      startedAt: true,
      jobTask: { select: { title: true, state: true, period: true, fy: true, firmClient: { select: { clientCode: true } } } },
      checklist: { where: { status: "fail" }, select: { severity: true } },
    },
  });
  return runs.map((r) => ({
    id: r.id,
    agent: r.agent,
    agentTitle: getAgent(r.agent)?.title ?? r.agent,
    attempt: r.attempt,
    status: r.status,
    jobState: r.jobTask.state,
    jobTitle: r.jobTask.title,
    period: r.jobTask.period,
    fy: r.jobTask.fy,
    clientCode: r.jobTask.firmClient.clientCode,
    startedAt: istTime(r.startedAt),
    blockFails: r.checklist.filter((c) => c.severity === "block").length,
    warnFails: r.checklist.filter((c) => c.severity === "warn").length,
  }));
}

export type RunnableJob = { id: string; title: string; period: string; fy: string; clientCode: string; state: JobTaskState; internalDue: string };

/** Jobs of the agent's service that the person may start a run on now. */
export async function listRunnableJobs(db: FirmDb, user: SessionUser, def: AnyAgent, now: Date): Promise<RunnableJob[]> {
  const jobs = await db.jobTask.findMany({
    where: { AND: [jobScopeWhere(user), { service: def.service, state: { in: ["ASSIGNED", "IN_PREP"] } }] },
    orderBy: [{ internalDueOn: "asc" }, { createdAt: "asc" }],
    take: 50,
    select: { id: true, title: true, period: true, fy: true, state: true, service: true, assigneeId: true, reviewerId: true, internalDueOn: true, agentless: true, firmClient: { select: { clientCode: true } } },
  });
  return jobs
    .filter((j) => !j.agentless && reviewActions(user, j, 0, now).run) // an agentless job (unmapped Turia task) is prepared by hand
    .map((j) => ({ id: j.id, title: j.title, period: j.period, fy: j.fy, clientCode: j.firmClient.clientCode, state: j.state, internalDue: j.internalDueOn ? formatDate(j.internalDueOn) : "—" }));
}

/** What the person can do on a job from the /agents list: start the agent, or open the latest pack. */
export type MyJobAction =
  | { kind: "run"; agent: string }
  | { kind: "no-agent" }
  | { kind: "open"; agent: string; runId: string; label: "Open pack to submit" | "Review pack" };

export type MyJobRow = {
  id: string;
  title: string;
  service: string;
  period: string;
  fy: string;
  clientCode: string;
  clientName: string;
  state: JobTaskState;
  internalDue: string;
  part: "Preparer" | "Reviewer" | "Preparer and reviewer";
  action: MyJobAction;
};

const OPEN_STATES: JobTaskState[] = ["ASSIGNED", "IN_PREP", "AGENT_DONE", "IN_REVIEW"];

/**
 * The person's own queue for /agents ("Waiting for you"): jobs they prepare or review on which the
 * state machine lets them act now, soonest internal due first. A job with nothing for them to do
 * (e.g. the preparer while it is IN_REVIEW) is left out. `agents` = the agents shown in the UI.
 */
export async function listMyJobs(db: FirmDb, user: SessionUser, agents: AnyAgent[], now: Date): Promise<MyJobRow[]> {
  if (!user || !canUseAgents(user)) return [];
  const jobs = await db.jobTask.findMany({
    where: { AND: [{ OR: [{ assigneeId: user.id }, { reviewerId: user.id }] }, { state: { in: OPEN_STATES } }] },
    orderBy: [{ internalDueOn: "asc" }, { createdAt: "asc" }],
    take: 50,
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
      agentless: true,
      firmClient: { select: { clientCode: true, client: { select: { name: true } } } },
      agentRuns: { orderBy: { startedAt: "desc" }, take: 1, select: { id: true, agent: true, checklist: { where: { status: "fail", severity: "block" }, select: { id: true } } } },
    },
  });
  const rows: MyJobRow[] = [];
  for (const j of jobs) {
    const latest = j.agentRuns[0] ?? null;
    const can = reviewActions(user, j, latest?.checklist.length ?? 0, now);
    const agent = (latest && agents.find((a) => a.key === latest.agent)) ?? agentForJob(j, agents);
    let action: MyJobAction | null = null;
    if (can.run) action = agent ? { kind: "run", agent: agent.key } : { kind: "no-agent" };
    else if (latest && can.submit) action = { kind: "open", agent: latest.agent, runId: latest.id, label: "Open pack to submit" };
    else if (latest && (can.approve || can.requestChanges)) action = { kind: "open", agent: latest.agent, runId: latest.id, label: "Review pack" };
    if (!action) continue;
    const prepares = j.assigneeId === user.id;
    const reviews = j.reviewerId === user.id;
    rows.push({
      id: j.id,
      title: j.title,
      service: j.service,
      period: j.period,
      fy: j.fy,
      clientCode: j.firmClient.clientCode,
      clientName: j.firmClient.client?.name ?? "",
      state: j.state,
      internalDue: j.internalDueOn ? formatDate(j.internalDueOn) : "—",
      part: prepares && reviews ? "Preparer and reviewer" : prepares ? "Preparer" : "Reviewer",
      action,
    });
  }
  return rows;
}

export type ChecklistView = {
  id: string;
  ruleId: string;
  severity: "block" | "warn" | "info";
  status: "pass" | "fail" | "na";
  message: string;
  source: string;
  quote: string | null;
  location: string | null;
  link: string | null;
  flags: string[];
};

/**
 * Deterministic rules through which an agent reports its own extraction abstentions (a model task
 * answered insufficient_evidence, ADR-008 §3): their failing rows are abstention questions too, like
 * the flagged LLM rows core/guardrails/review.ts picks up. `heldBack` names the run figure with the
 * amount the draft keeps out until the question is answered (owner-approved 2026-11-05: GST holds
 * back ITC on a bill the model abstained on).
 */
export const ABSTENTION_RULES: Readonly<Record<string, { heldBack?: { figure: string; label: string } }>> = {
  "gst.model-questions": { heldBack: { figure: "itcHeldBackPaise", label: "ITC held back until answered" } },
  "books.classification-questions": {},
};

/**
 * The review screen's question kinds: the guardrail questions (core/guardrails/review.ts) plus
 * ADR-009's framework row that withheld document text reading like an instruction to the AI —
 * the reviewer checks those items by hand (it is never a client document request).
 */
export type OpenQuestionKind = OpenQuestion["kind"] | typeof INJECTION_FLAG;

/** An open question as the review screen shows it: its checklist row's id and evidence, and any amount held back (₹ Indian grouping). */
export type OpenQuestionView = Omit<OpenQuestion, "kind"> & { kind: OpenQuestionKind; id: string; quote: string | null; link: string | null; heldBack: { label: string; amount: string } | null };

const isAbstentionRule = (ruleId: string) => Object.prototype.hasOwnProperty.call(ABSTENTION_RULES, ruleId);
const KIND_ORDER: Record<OpenQuestionKind, number> = { "insufficient-evidence": 0, "possible-prompt-injection": 1, "model-disagreement": 2, "out-of-scope": 3 };

/** Open questions for the review screen (abstentions first, then text withheld as a possible prompt injection (ADR-009), then disagreements, then out-of-scope rules; by rule id, checklist order within one). */
export function openQuestionViews(checklist: readonly ChecklistView[], figures: Readonly<Record<string, number>>): OpenQuestionView[] {
  const out: OpenQuestionView[] = [];
  for (const c of checklist) {
    if (c.flags.includes(INJECTION_FLAG)) {
      out.push({ ruleId: c.ruleId, kind: INJECTION_FLAG, question: c.message, location: c.location, clientRequest: false, id: c.id, quote: c.quote, link: c.link, heldBack: null });
      continue;
    }
    const row = c.status === "fail" && c.flags.length === 0 && isAbstentionRule(c.ruleId) ? { ...c, flags: ["insufficient-evidence"] } : c;
    // One row at a time, so each question keeps its own row's id and evidence.
    for (const q of openQuestions([row])) {
      const held = isAbstentionRule(q.ruleId) ? ABSTENTION_RULES[q.ruleId].heldBack : undefined;
      const paise = held ? figures[held.figure] : undefined;
      out.push({
        ...q,
        id: c.id,
        quote: c.quote,
        link: c.link,
        heldBack: held && typeof paise === "number" && paise > 0 ? { label: held.label, amount: `₹${formatInr(paise / 100)}` } : null,
      });
    }
  }
  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.ruleId.localeCompare(b.ruleId));
}

export type DeliverableView = { id: string; kind: string; name: string; version: number; size: string; sha256: string; isSheet: boolean };
export type CommentView = { id: string; author: string; at: string; text: string };
export type FigureView = { key: string; label: string; value: string };

export type RunReview = {
  run: { id: string; agent: string; agentTitle: string; attempt: number; status: string; sopPackVersion: string; startedAt: string; finishedAt: string; error: string | null; reviewNotes: string | null; needsPartnerReview: boolean };
  job: { id: string; title: string; state: JobTaskState; service: string; period: string; fy: string; clientCode: string; clientName: string };
  isLatest: boolean;
  checklist: ChecklistView[];
  counts: { block: number; warn: number; info: number; pass: number; na: number };
  figures: FigureView[];
  deliverables: DeliverableView[];
  comments: CommentView[];
  actions: ReviewActions & { finalize: boolean };
  /** Registered deterministic checks (for the "log a missed finding" form). */
  checks: string[];
  /**
   * ADR-008: rules the model could not answer / two reads disagreed on / not owned, plus the
   * agent-reported abstentions (ABSTENTION_RULES) — questions for the reviewer (abstentions are
   * client document requests), with any amount held back from the draft.
   */
  openQuestions: OpenQuestionView[];
};

const SEV_ORDER = { block: 0, warn: 1, info: 2 } as const;
const STATUS_ORDER = { fail: 0, na: 1, pass: 2 } as const;

const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** "totalPaise" → "Total", amounts shown in ₹ with Indian grouping; other integers as counts. */
export function figureView(key: string, value: number): FigureView {
  const isPaise = /paise$/i.test(key);
  const base = key.replace(/Paise$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  const label = base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
  return { key, label, value: isPaise ? `₹${formatInr(value / 100)}` : value.toLocaleString("en-IN") };
}

export async function loadRunReview(db: FirmDb, user: SessionUser, runId: string, now: Date): Promise<RunReview | null> {
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      agent: true,
      attempt: true,
      status: true,
      sopPackVersion: true,
      startedAt: true,
      finishedAt: true,
      error: true,
      reviewNotes: true,
      needsPartnerReview: true,
      figures: true,
      jobTaskId: true,
      jobTask: {
        select: { id: true, title: true, state: true, service: true, period: true, fy: true, assigneeId: true, reviewerId: true, firmClient: { select: { clientCode: true, client: { select: { name: true } } } } },
      },
      checklist: { orderBy: { createdAt: "asc" } },
      deliverables: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!run || !canViewJob(user, run.jobTask)) return null;
  // Who opened which client's run (breach runbook §2): one "view" per person per run per hour.
  await auditRead(db, { actorId: user?.id, entity: "AgentRun", entityId: run.id, meta: { agent: run.agent, jobTaskId: run.jobTaskId, clientCode: run.jobTask.firmClient.clientCode }, now });
  const latest = await db.agentRun.findFirst({ where: { jobTaskId: run.jobTaskId }, orderBy: { startedAt: "desc" }, select: { id: true } });
  const isLatest = latest?.id === run.id;
  const comments = await db.auditEvent.findMany({ where: { entity: "AgentRun", entityId: run.id, action: "comment" }, orderBy: { createdAt: "asc" } });

  const checklist: ChecklistView[] = run.checklist
    .map((c) => {
      const ev = (c.evidence ?? {}) as { quote?: string; location?: string; link?: string; flags?: string[] };
      return {
        id: c.id,
        ruleId: c.ruleId,
        severity: c.severity as ChecklistView["severity"],
        status: c.status as ChecklistView["status"],
        message: c.message,
        source: c.source,
        quote: ev.quote ?? null,
        location: ev.location ?? null,
        // Evidence links are shown as <a href>: https only (no javascript:, data:, http:, relative) — audit #33.
        link: httpsLink(ev.link),
        flags: ev.flags ?? [],
      };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  const fails = (s: ChecklistView["severity"]) => checklist.filter((c) => c.status === "fail" && c.severity === s).length;
  const blockingFailures = fails("block");
  const base = isLatest ? reviewActions(user, run.jobTask, blockingFailures, now) : { run: false, submit: false, rerun: false, requestChanges: false, approve: false, approveNeedsNote: false, proposeMistake: true };
  const hasFinal = run.deliverables.some((d) => d.kind === "Final");
  const def = getAgent(run.agent);

  return {
    run: {
      id: run.id,
      agent: run.agent,
      agentTitle: def?.title ?? run.agent,
      attempt: run.attempt,
      status: run.status,
      sopPackVersion: run.sopPackVersion,
      startedAt: istTime(run.startedAt),
      finishedAt: istTime(run.finishedAt),
      error: run.error ? runFailureMessage(run.error) : null,
      reviewNotes: run.reviewNotes,
      needsPartnerReview: run.needsPartnerReview,
    },
    job: {
      id: run.jobTask.id,
      title: run.jobTask.title,
      state: run.jobTask.state,
      service: run.jobTask.service,
      period: run.jobTask.period,
      fy: run.jobTask.fy,
      clientCode: run.jobTask.firmClient.clientCode,
      clientName: run.jobTask.firmClient.client.name,
    },
    isLatest,
    checklist,
    counts: { block: blockingFailures, warn: fails("warn"), info: fails("info"), pass: checklist.filter((c) => c.status === "pass").length, na: checklist.filter((c) => c.status === "na").length },
    figures: Object.entries((run.figures ?? {}) as Record<string, number>).map(([k, v]) => figureView(k, v)),
    deliverables: run.deliverables.map((d) => ({ id: d.id, kind: d.kind, name: d.name, version: d.version, size: sizeLabel(d.sizeBytes), sha256: d.sha256, isSheet: d.name.endsWith(".xlsx") })),
    comments: comments.map((c) => ({ id: c.id, author: c.actorId ?? "—", at: istTime(c.createdAt), text: String((c.meta as { text?: unknown } | null)?.text ?? "") })),
    actions: { ...base, finalize: isLatest && run.jobTask.state === "APPROVED" && run.status === "APPROVED" && !hasFinal && run.deliverables.length > 0 && canViewJob(user, run.jobTask) },
    checks: def ? [...def.checklistRegistry.keys()] : [],
    openQuestions: openQuestionViews(checklist, (run.figures ?? {}) as Record<string, number>),
  };
}

// ------------------------------------------------------------------ mistakes admin

export type MistakeRow = {
  id: string;
  agent: string;
  /** The agent's display title (the key when the agent is no longer registered). */
  agentTitle: string;
  status: "PROPOSED" | "APPROVED" | "REJECTED";
  pattern: string;
  ruleId: string;
  ruleTitle: string;
  severity: string;
  createdBy: string;
  createdAt: string;
  decidedAt: string;
  promotedToVersion: string | null;
  runId: string | null;
  diff: PackDiff | null;
  problem: string | null;
};

async function packJson(db: FirmDb, key: string, version?: string): Promise<ChecklistPack | null> {
  const row = version ? await db.sopPack.findFirst({ where: { key, version } }) : await db.sopPack.findFirst({ ...latestPackQuery(key) });
  const p = ChecklistPackSchema.safeParse(row?.checklist);
  return p.success ? p.data : null;
}

/** PROPOSED (with the diff it would make to the active pack) and decided rows (with the diff they made). */
export async function listMistakes(db: FirmDb, user: SessionUser): Promise<{ canDecide: boolean; proposed: MistakeRow[]; decided: MistakeRow[] }> {
  const logs = await db.mistakeLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  // One read per pack version, not one per mistake row (packs are immutable per version).
  const packs = new Map<string, Promise<ChecklistPack | null>>();
  const pack = (key: string, version?: string) => {
    const k = `${key}@${version ?? "latest"}`;
    if (!packs.has(k)) packs.set(k, packJson(db, key, version));
    return packs.get(k)!;
  };
  const rows: MistakeRow[] = [];
  for (const m of logs) {
    const def = getAgent(m.agent);
    const proposal = (m.ruleProposal ?? {}) as { id?: string; title?: string; severity?: string };
    let diff: PackDiff | null = null;
    let problem: string | null = null;
    if (def) {
      if (m.status === "PROPOSED") {
        const current = await pack(def.sopPackKey);
        if (current) {
          try {
            diff = diffPacks(current, withPromotedRule(current, m.ruleProposal, m.id));
          } catch (e) {
            problem = (e as Error).message;
          }
        } else problem = `No active SOP pack "${def.sopPackKey}"`;
      } else if (m.status === "APPROVED" && m.promotedToVersion) {
        const after = await pack(def.sopPackKey, m.promotedToVersion);
        if (after) {
          const before = { ...after, rules: after.rules.filter((r) => r.origin?.mistakeLogId !== m.id) };
          diff = diffPacks(before, after);
          diff.from = "previous";
        }
      }
    } else problem = `Unknown agent ${m.agent}`;
    rows.push({
      id: m.id,
      agent: m.agent,
      agentTitle: def?.title ?? m.agent,
      status: m.status,
      pattern: m.pattern,
      ruleId: proposal.id ?? "—",
      ruleTitle: proposal.title ?? "—",
      severity: proposal.severity ?? "—",
      createdBy: m.createdById,
      createdAt: istTime(m.createdAt),
      decidedAt: istTime(m.decidedAt),
      promotedToVersion: m.promotedToVersion,
      runId: m.agentRunId,
      diff,
      problem,
    });
  }
  return { canDecide: canDecideMistakes(user), proposed: rows.filter((r) => r.status === "PROPOSED"), decided: rows.filter((r) => r.status !== "PROPOSED") };
}
