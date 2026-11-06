// Read model for the guided workspace (/workspace/[jobId]): the job, its SOP steps with the current
// one marked, the "before you move on" checklist, open questions, the one action this person can
// take now, and what the viewer tabs show — the latest run's deliverables (previewed through the
// existing deliverable preview route), the client's documents (SharePoint links) and the SOP pack
// text. Same visibility as /agents (canViewJob). Server-side only; reads, never writes.
import type { ClientDocType, FirmService, JobTaskState, PrismaClient } from "@prisma/client";
import type { SessionUser } from "@/lib/access";
import { canViewJob } from "@/lib/agents/access";
import { ChecklistPackSchema, type RuleDefinition } from "@/lib/agents/core/checklist";
import { formatDate, formatDateTimeIst } from "@/lib/agents/core/format";
import { jobFolder, latestPackQuery, type AnyAgent, type FirmDb } from "@/lib/agents/core/runner";
import { agentForJob, visibleAgents } from "@/lib/agents/registry";
import type { DeliverableView } from "@/lib/agents/views";
import { ackRefFor } from "@/lib/close-loop/review";
import { istDayStart } from "@/lib/ist";
import type { NextTask, NextTaskAction } from "./contract";
import { actionFor, runOpenQuestions, type LatestRun } from "./next-task";
import { portalNoteFor, sopSteps, stepChecklist } from "./sop-steps";

export type WorkspaceViewDb = FirmDb & { clientDocument: Pick<PrismaClient["clientDocument"], "findMany"> };

export type ClientDocRow = { id: string; name: string; docType: ClientDocType; webUrl: string; uploaded: string; forThisJob: boolean };
export type SopRule = Pick<RuleDefinition, "id" | "title" | "severity" | "kind" | "evidence">;

export type WorkspaceView = {
  job: {
    id: string;
    title: string;
    service: FirmService;
    period: string;
    fy: string;
    state: JobTaskState;
    clientCode: string;
    clientName: string;
    internalDue: string | null;
    statutoryDue: string | null;
    overdue: boolean;
    /** A Turia task no rule maps (ADR-003 amendment): no agent, prepared by hand. Present only when true. */
    agentless?: true;
    /** The Turia task disappeared or was cancelled: the job is flagged, never removed. Present only when set. */
    turiaNote?: string;
  };
  /** The one action this person can take now, or null with `waitingOn` saying who acts next. */
  action: NextTaskAction | null;
  waitingOn: string | null;
  sopSteps: NextTask["sopSteps"];
  checklist: string[];
  openQuestions: NextTask["openQuestions"];
  portalNote: string | null;
  latestRun: { id: string; agent: string; attempt: number; status: string; started: string } | null;
  deliverables: DeliverableView[];
  clientDocs: { folderUrl: string | null; files: ClientDocRow[] };
  sopPack: { title: string; version: string | null; source: "published" | "built-in"; rules: SopRule[] } | null;
};

/** Who acts next, when this person has nothing to do on the job now. */
const WAITING_ON: Readonly<Record<JobTaskState, string>> = {
  DRAFT: "This job is not assigned yet. A manager assigns it before work starts.",
  ASSIGNED: "The preparer runs the agent next.",
  IN_PREP: "The preparer is preparing the pack.",
  AGENT_DONE: "The preparer checks the findings and submits the pack for review.",
  IN_REVIEW: "The reviewer is checking the pack.",
  APPROVED: "The preparer files it and marks it filed.",
  FILED_BY_HUMAN: "The preparer records the Turia close.",
  CLOSING: "The preparer records the Turia close.",
  DONE: "This job is DONE. Nothing more is needed.",
};

const SEV_ORDER = { block: 0, warn: 1, info: 2 } as const;
const sizeLabel = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ist = (d: Date) => `${formatDateTimeIst(d)} IST`;

export async function loadWorkspaceView(db: WorkspaceViewDb, user: SessionUser, jobId: string, now: Date, agents: readonly AnyAgent[] = visibleAgents()): Promise<WorkspaceView | null> {
  const job = await db.jobTask.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      title: true,
      service: true,
      period: true,
      fy: true,
      state: true,
      assigneeId: true,
      reviewerId: true,
      lmsJobId: true,
      internalDueOn: true,
      statutoryDueOn: true,
      agentless: true,
      turiaNote: true,
      firmClient: { select: { clientCode: true, lmsClientId: true, client: { select: { name: true } } } },
      agentRuns: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: {
          id: true,
          agent: true,
          attempt: true,
          status: true,
          startedAt: true,
          reviewNotes: true,
          checklist: { where: { status: "fail" }, select: { severity: true } },
          deliverables: { orderBy: { createdAt: "asc" }, select: { id: true, kind: true, name: true, version: true, sizeBytes: true, sha256: true } },
        },
      },
    },
  });
  if (!job || !canViewJob(user, job)) return null;

  const run = job.agentRuns[0] ?? null;
  const latest: LatestRun | null = run
    ? { id: run.id, agent: run.agent, reviewNotes: run.reviewNotes, blockFails: run.checklist.filter((c) => c.severity === "block").length, warnFails: run.checklist.filter((c) => c.severity === "warn").length }
    : null;
  const agent = (run && agents.find((a) => a.key === run.agent)) || agentForJob(job, agents);

  const [pack, questions, docs] = await Promise.all([
    agent ? db.sopPack.findFirst({ ...latestPackQuery(agent.sopPackKey), select: { version: true, title: true, checklist: true } }) : Promise.resolve(null),
    runOpenQuestions(db, run?.id ?? null),
    db.clientDocument.findMany({
      where: { clientId: job.firmClient.lmsClientId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, name: true, docType: true, webUrl: true, createdAt: true, jobId: true },
    }),
  ]);

  const parsed = ChecklistPackSchema.safeParse(pack?.checklist);
  const rules = parsed.success ? parsed.data.rules : agent ? agent.defaultChecklist.rules : [];
  const sopPack = agent
    ? {
        title: pack?.title ?? agent.title,
        version: parsed.success ? (pack?.version ?? null) : agent.defaultChecklist.version,
        source: parsed.success ? ("published" as const) : ("built-in" as const),
        rules: [...rules].sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]).map(({ id, title, severity, kind, evidence }) => ({ id, title, severity, kind, evidence })),
      }
    : null;

  const ctx = {
    service: job.service,
    agentTitle: agent?.title ?? null,
    requiredInputs: agent?.requiredInputs ?? [],
    packVersion: sopPack?.version ?? null,
    ruleCount: sopPack ? sopPack.rules.length : null,
    blockFails: latest?.blockFails ?? 0,
    warnFails: latest?.warnFails ?? 0,
    openQuestions: questions.length,
    ack: ackRefFor(job.service),
    reviewNotes: job.state === "IN_PREP" ? (latest?.reviewNotes ?? null) : null,
  };

  let folderUrl: string | null = null;
  try {
    folderUrl = jobFolder({ clientCode: job.firmClient.clientCode, fy: job.fy, service: job.service, period: job.period }, "ClientDocs").webUrl;
  } catch {
    folderUrl = null; // a job whose code or period does not fit the folder contract has no folder link
  }

  const action = actionFor(user, job, latest, agents, now, { queue: false });
  const today = istDayStart(now);
  return {
    job: {
      id: job.id,
      title: job.title,
      service: job.service,
      period: job.period,
      fy: job.fy,
      state: job.state,
      clientCode: job.firmClient.clientCode,
      clientName: job.firmClient.client?.name ?? "",
      internalDue: job.internalDueOn ? formatDate(job.internalDueOn) : null,
      statutoryDue: job.statutoryDueOn ? formatDate(job.statutoryDueOn) : null,
      overdue: job.state !== "DONE" && ((!!job.internalDueOn && job.internalDueOn < today) || (!!job.statutoryDueOn && job.statutoryDueOn < today)),
      ...(job.agentless ? { agentless: true as const } : {}),
      ...(job.turiaNote ? { turiaNote: job.turiaNote } : {}),
    },
    action,
    waitingOn: action ? null : WAITING_ON[job.state],
    sopSteps: sopSteps(job.state, ctx),
    checklist: stepChecklist(job.state, ctx),
    openQuestions: questions,
    portalNote: portalNoteFor(job.service),
    latestRun: run ? { id: run.id, agent: run.agent, attempt: run.attempt, status: run.status, started: ist(run.startedAt) } : null,
    deliverables: (run?.deliverables ?? []).map((d) => ({ id: d.id, kind: d.kind, name: d.name, version: d.version, size: sizeLabel(d.sizeBytes), sha256: d.sha256, isSheet: d.name.endsWith(".xlsx") })),
    clientDocs: {
      folderUrl,
      files: docs.map((d) => ({ id: d.id, name: d.name, docType: d.docType, webUrl: d.webUrl, uploaded: formatDate(d.createdAt), forThisJob: !!job.lmsJobId && d.jobId === job.lmsJobId })),
    },
    sopPack,
  };
}
