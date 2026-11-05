// Agent runner (Phase 4 task 1). One call prepares one JobTask's draft pack:
//
//   load JobTask + FirmClient + active SopPack (latest version of the agent's key) + APPROVED
//   MistakeLog rules → gather inputs (InputSource) → validate (agent.inputSchema) → extract
//   (agent.extract, model calls only through the injected ModelRouter) → compute (agent.compute:
//   deterministic TypeScript; the model never does totals) → checklist (core engine) → build
//   deliverables (core templates) → upload create-only to {Period}/Working → persist AgentRun +
//   ChecklistResult + Deliverable rows → JobTask IN_PREP → AGENT_DONE (transitionJobTask).
//
// A JobTask in ASSIGNED is first moved to IN_PREP by the agent. On any failure after the run row
// exists, the AgentRun is FAILED with the error and the JobTask stays IN_PREP. Every dependency
// (database, router, SharePoint store, input source, clock, ids) is injected; production wiring
// lives in src/lib/agents/service.ts. Nothing here deletes anything: files from a failed run stay
// in Working and the next run takes the next free `_v{n}`.
import type { FirmService, JobTaskState, PrismaClient } from "@prisma/client";
import { z, type ZodType, type ZodTypeDef } from "zod";
import type { AgentName, AgentTask, ModelRequest, RouterResult } from "@/lib/ai/router";
import type { DeliverableStore, StoredFile } from "@/lib/integrations/sharepoint/deliverable-store";
import { deliverablePath, parsePeriod, type DeliverableKind, type DeliverablePath } from "@/lib/integrations/sharepoint/paths";
import {
  loadRuleSet,
  rulesFromMistakeLogs,
  runChecklist,
  summarizeChecklist,
  toChecklistResultRows,
  type ChecklistPack,
  type ChecklistResultItem,
  type ChecklistSummary,
  type LlmCheck,
  type LlmContextFn,
  type RuleRegistry,
} from "./checklist";
import { transitionJobTask } from "./state-db";
import { buildDocx, buildWorkbook, type BuiltDeliverable, type DocBlock, type SheetSpec } from "./templates";

// ------------------------------------------------------------------ dependencies

/** The Prisma models the agent framework reads and writes. PrismaClient satisfies it. */
export type FirmDb = Pick<
  PrismaClient,
  "$transaction" | "jobTask" | "jobTaskEvent" | "agentRun" | "checklistResult" | "deliverable" | "mistakeLog" | "sopPack" | "auditEvent"
>;

/** The ModelRouter's `run` (src/lib/ai/router.ts) or a recorded fake. */
export interface ModelRouterLike {
  run<T>(req: ModelRequest<T>): Promise<RouterResult<T>>;
}

export type InputSourceKind = "client-docs" | "upload" | "books-export" | "fixture";
export type InputFile = { name: string; source: InputSourceKind; bytes: Buffer; contentType?: string; path?: string };

export type InputRequest = {
  agent: string;
  jobTaskId: string;
  clientCode: string;
  fy: string;
  service: FirmService;
  period: string;
  /** Library-relative ClientDocs folder of the job (deliverablePath(..., "ClientDocs").path). */
  clientDocsFolder: string;
};

/** Where an agent's inputs come from: SharePoint ClientDocs, uploaded files, books exports, fixtures. */
export interface InputSource {
  gather(req: InputRequest): Promise<InputFile[]>;
}

export type RunnerDeps = {
  db: FirmDb;
  router: ModelRouterLike;
  store: DeliverableStore;
  inputs: InputSource;
  now: () => Date;
  /** Id for each new AgentRun (deliverable headers carry it, so tests pin it). */
  ids: () => string;
};

// ------------------------------------------------------------------ agent definition

/** Computed figures: integers only; amounts in paise. Compared exactly by the accuracy harness. */
export type Figures = Record<string, number>;

export type JobContext = {
  jobTaskId: string;
  title: string;
  service: FirmService;
  fy: string;
  period: string;
  clientCode: string;
  clientName: string;
  assigneeId: string | null;
  reviewerId: string | null;
};

/** Model call bound to the current run. Returns the schema-valid output or throws. */
export type ModelCaller = <T>(req: Omit<ModelRequest<T>, "runId">) => Promise<T>;

export type ExtractContext<I> = {
  input: I;
  files: InputFile[];
  job: JobContext;
  runId: string;
  /** Reviewer notes when this run was requested with "Request changes" / re-run. */
  notes: string | null;
  model: ModelCaller;
};

/** `preparedAt`: when this run prepares the pack (deps.now()); absent in mistake replays — rules that need "today" fall back conservatively. */
export type CheckInput<I, E> = { input: I; extracted: E; figures: Figures; job: JobContext; preparedAt?: Date };
export type DeliverableContext<I, E> = CheckInput<I, E> & { results: ChecklistResultItem[] };

export type DeliverableDraft =
  | { type: "xlsx"; title: string; fileBase?: string; sheets: SheetSpec[] }
  | { type: "docx"; title: string; fileBase?: string; blocks: DocBlock[] };

export interface AgentDefinition<I = unknown, E = unknown> {
  /** Route segment and AgentRun.agent: "gst", "roc", ..., "echo". */
  key: string;
  title: string;
  service: FirmService;
  /** SopPack.key holding this agent's checklist. */
  sopPackKey: string;
  /** Prefix for ModelRouter tasks (ModelCall.agent). */
  modelAgent: AgentName;
  /** Validates (and may transform) the gathered input files into the agent's input. */
  inputSchema: ZodType<I, ZodTypeDef, InputFile[]>;
  extract(ctx: ExtractContext<I>): Promise<E>;
  /** Deterministic arithmetic only. Integer figures (paise for amounts). */
  compute(extracted: E, input: I): Figures;
  checklistRegistry: RuleRegistry<CheckInput<I, E>>;
  /** Text shown to the model for LLM rules. Default: the extracted data as JSON. */
  llmContext?(input: CheckInput<I, E>): string;
  deliverables(ctx: DeliverableContext<I, E>): DeliverableDraft[];
  /** Seed checklist (SopPack v1.0.0) for a fresh database or the accuracy harness. */
  defaultChecklist: ChecklistPack;
  /** Framework test agents (echo): hidden unless FIRM_OS_ECHO_AGENT is on. */
  internal?: boolean;
  /**
   * Accuracy-harness input-sensitivity probe: return a copy of the gathered files with ONE
   * material input value changed (e.g. one amount + ₹1). The harness re-runs every fixture on the
   * mutated files with the same recorded model responses and requires at least one computed
   * figure or raised flag to differ — proof the pipeline reads its input rather than the
   * recordings. Must not modify `files`. Optional in the type; the harness fails any agent that
   * is not `internal` and does not declare it.
   */
  probeMutation?(files: InputFile[]): InputFile[];
}

/** Erases the generic parameters for registries and the service layer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgent = AgentDefinition<any, any>;

// ------------------------------------------------------------------ outcome

export type PreconditionCode = "NOT_FOUND" | "WRONG_SERVICE" | "NOT_READY" | "NO_SOP_PACK";

export type RunOutcome =
  | {
      ok: true;
      runId: string;
      attempt: number;
      summary: ChecklistSummary;
      figures: Figures;
      deliverables: { name: string; version: number; sha256: string; sizeBytes: number; driveItemId: string }[];
      needsPartnerReview: boolean;
    }
  | { ok: false; code: PreconditionCode; reason: string }
  | { ok: false; code: "FAILED"; runId: string; reason: string };

export type RunOptions = { startedById?: string | null; notes?: string | null };

export class AgentRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRunError";
  }
}

/** Inputs cached on the AgentRun are purged after this many days (ADR-006). */
export const INPUTS_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
const RUNNABLE: JobTaskState[] = ["ASSIGNED", "IN_PREP"];

export const LLM_CHECK_SYSTEM = [
  "You check one point in a draft compliance pack prepared for a chartered accountant's review.",
  "Answer only from the documents given. status = fail when the documents show the problem, pass when they show it is absent, na when the question does not apply.",
  "Always give evidence.quote copied verbatim from the documents and evidence.location naming the file and row or line.",
  "Do not add up, total or recompute any amount.",
].join(" ");

/** Model answer for an LLM rule; the checklist engine validates it again (location given, quote found in the documents shown). */
export const LlmVerdictOutputSchema = z.object({
  status: z.enum(["pass", "fail", "na"]),
  message: z.string().max(1000).optional(),
  evidence: z.object({ quote: z.string(), location: z.string() }),
});

const JOB_SELECT = {
  id: true,
  title: true,
  service: true,
  fy: true,
  period: true,
  state: true,
  assigneeId: true,
  reviewerId: true,
  firmClient: { select: { clientCode: true, client: { select: { name: true } } } },
} as const;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 2000);

/** Path A folder of a job: CL-{Code}/Compliance/FY…/{Service}/{Period}/{Kind}. Throws PathError on bad parts. */
export function jobFolder(job: { clientCode: string; fy: string; service: FirmService; period: string }, kind: DeliverableKind): DeliverablePath {
  return deliverablePath(job.clientCode, job.fy, job.service, parsePeriod(job.period), kind);
}

/** Latest active SopPack row for a key (highest major.minor.patch). */
export function latestPackQuery(key: string) {
  return {
    where: { key, active: true },
    orderBy: [{ major: "desc" as const }, { minor: "desc" as const }, { patch: "desc" as const }],
  };
}

// ------------------------------------------------------------------ runner

export async function runAgent<I, E>(def: AgentDefinition<I, E>, jobTaskId: string, deps: RunnerDeps, opts: RunOptions = {}): Promise<RunOutcome> {
  const { db } = deps;
  const row = await db.jobTask.findUnique({ where: { id: jobTaskId }, select: JOB_SELECT });
  if (!row) return { ok: false, code: "NOT_FOUND", reason: `JobTask ${jobTaskId} not found` };
  if (row.service !== def.service) return { ok: false, code: "WRONG_SERVICE", reason: `${def.title} prepares ${def.service} jobs; this job is ${row.service}` };
  if (!RUNNABLE.includes(row.state)) return { ok: false, code: "NOT_READY", reason: `The agent runs on ASSIGNED or IN_PREP jobs; this job is ${row.state}` };
  const pack = await db.sopPack.findFirst({ ...latestPackQuery(def.sopPackKey), select: { version: true, checklist: true } });
  if (!pack) return { ok: false, code: "NO_SOP_PACK", reason: `No active SOP pack "${def.sopPackKey}"; publish one in /admin/firm-os first` };

  const job: JobContext = {
    jobTaskId,
    title: row.title,
    service: row.service,
    fy: row.fy,
    period: row.period,
    clientCode: row.firmClient.clientCode,
    clientName: row.firmClient.client.name,
    assigneeId: row.assigneeId,
    reviewerId: row.reviewerId,
  };

  const attempt = (await db.agentRun.count({ where: { jobTaskId } })) + 1;
  const runId = deps.ids();
  const notes = opts.notes?.trim() || null;
  await db.agentRun.create({
    data: {
      id: runId,
      jobTaskId,
      agent: def.key,
      sopPackVersion: pack.version,
      status: "RUNNING",
      attempt,
      reviewNotes: notes,
      startedById: opts.startedById ?? null,
      startedAt: deps.now(),
    },
  });
  const agentActor = { kind: "agent", runId } as const;

  const fail = async (reason: string): Promise<RunOutcome> => {
    await db.agentRun.update({ where: { id: runId }, data: { status: "FAILED", error: reason, finishedAt: deps.now() } });
    return { ok: false, code: "FAILED", runId, reason };
  };

  if (row.state === "ASSIGNED") {
    const t = await transitionJobTask(db, jobTaskId, "IN_PREP", agentActor, { expectedState: "ASSIGNED", now: deps.now() });
    if (!t.ok) return fail(`Could not start preparation: ${t.reason}`);
  }

  try {
    let needsPartnerReview = false;
    const model: ModelCaller = async <T>(req: Omit<ModelRequest<T>, "runId">): Promise<T> => {
      const res = await deps.router.run<T>({ ...req, runId } as ModelRequest<T>);
      if (res.status === "ok") {
        if (res.needsPartnerReview) needsPartnerReview = true;
        return res.output;
      }
      if (res.status === "needs-review" && res.output !== null) {
        needsPartnerReview = true;
        return res.output;
      }
      throw new AgentRunError(res.status === "queued" ? `Model call queued for a human: ${res.reason}` : `Model output not usable: ${res.issues.join("; ")}`);
    };

    // Rules: the pack, plus approved mistake rules the pack does not already carry.
    const mistakes = await db.mistakeLog.findMany({
      where: { agent: def.key, status: "APPROVED" },
      orderBy: { createdAt: "asc" },
      select: { id: true, status: true, ruleProposal: true, promotedToVersion: true },
    });
    const fromMistakes = rulesFromMistakeLogs(mistakes).rules;
    const packRuleIds = new Set(((pack.checklist as { rules?: { id: string }[] } | null)?.rules ?? []).map((r) => r.id));
    const loaded = loadRuleSet(pack.checklist, def.checklistRegistry, fromMistakes.filter((r) => !packRuleIds.has(r.id)));
    if (!loaded.ok) throw new AgentRunError(`SOP pack ${def.sopPackKey} ${pack.version} cannot be used: ${loaded.errors.join("; ")}`);

    // Inputs.
    const files = await deps.inputs.gather({
      agent: def.key,
      jobTaskId,
      clientCode: job.clientCode,
      fy: job.fy,
      service: job.service,
      period: job.period,
      clientDocsFolder: jobFolder(job, "ClientDocs").path,
    });
    const parsed = def.inputSchema.safeParse(files);
    if (!parsed.success) throw new AgentRunError(`Inputs incomplete: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const input = parsed.data;

    // Extract (model), compute (code), check (engine).
    const extracted = await def.extract({ input, files, job, runId, notes, model });
    const figures = def.compute(extracted, input);
    for (const [k, v] of Object.entries(figures)) {
      if (!Number.isSafeInteger(v)) throw new AgentRunError(`compute returned a non-integer figure ${k}=${String(v)} (amounts must be integer paise)`);
    }
    const checkInput: CheckInput<I, E> = { input, extracted, figures, job, preparedAt: deps.now() };
    // The documents text an LLM rule sees is also what its quote is verified against (engine).
    const llmContext: LlmContextFn<CheckInput<I, E>> = (_rule, ci) => (def.llmContext ? def.llmContext(ci) : JSON.stringify(ci.extracted, null, 2));
    const llmCheck: LlmCheck<CheckInput<I, E>> = (rule, _ci, documents) =>
      model({
        task: `${def.modelAgent}.check:${rule.id}` as AgentTask,
        privacy: "anonymize-then-cloud",
        difficulty: "judgement",
        schema: LlmVerdictOutputSchema,
        messages: [
          { role: "system", content: LLM_CHECK_SYSTEM },
          {
            role: "user",
            content: `Question: ${rule.check}\nEvidence to cite: ${rule.evidence}\n\nDocuments:\n${documents}`,
          },
        ],
      });
    const results = await runChecklist(loaded.ruleSet, checkInput, { registry: def.checklistRegistry, llmCheck, llmContext });

    // Deliverables → Working/.
    const generatedAt = deps.now();
    const built: BuiltDeliverable[] = [];
    for (const d of def.deliverables({ ...checkInput, results })) {
      const header = {
        title: d.title,
        clientName: job.clientName,
        clientCode: job.clientCode,
        period: job.period,
        fy: job.fy,
        agentRunId: runId,
        reviewedBy: null,
        version: attempt,
        generatedAt,
      };
      built.push(d.type === "xlsx" ? await buildWorkbook({ header, sheets: d.sheets, fileBase: d.fileBase }) : await buildDocx({ header, blocks: d.blocks, fileBase: d.fileBase }));
    }
    const working = jobFolder(job, "Working");
    const driveId = built.length ? await deps.store.complianceDrive(job.clientCode) : null;
    const stored: StoredFile[] = [];
    for (const b of built) stored.push(await deps.store.putNew(driveId as string, working.path, b.fileName, b.buffer));

    // Persist results (one transaction), then move the job.
    const finishedAt = deps.now();
    await db.$transaction(async (tx) => {
      await tx.agentRun.update({
        where: { id: runId },
        data: {
          figures,
          needsPartnerReview,
          inputs: {
            files: files.map((f) => ({ name: f.name, source: f.source, sizeBytes: f.bytes.length })),
            extracted: JSON.parse(JSON.stringify(extracted ?? null)),
          },
          inputsPurgeAt: new Date(finishedAt.getTime() + INPUTS_RETENTION_DAYS * DAY_MS),
        },
      });
      if (results.length) await tx.checklistResult.createMany({ data: toChecklistResultRows(runId, results) });
      for (const s of stored) {
        await tx.deliverable.create({
          data: {
            jobTaskId,
            agentRunId: runId,
            kind: "Working",
            name: s.fileName,
            spPath: working.serverRelativeUrl,
            driveId: s.driveId,
            driveItemId: s.item.id,
            sha256: s.sha256,
            sizeBytes: s.sizeBytes,
            version: s.version,
          },
        });
      }
    });

    const moved = await transitionJobTask(db, jobTaskId, "AGENT_DONE", agentActor, { expectedState: "IN_PREP", now: deps.now() });
    if (!moved.ok) return fail(`Pack prepared but the job could not move to AGENT_DONE: ${moved.reason}`);
    await db.agentRun.update({ where: { id: runId }, data: { status: "AGENT_DONE", finishedAt: deps.now() } });

    return {
      ok: true,
      runId,
      attempt,
      summary: summarizeChecklist(results),
      figures,
      deliverables: stored.map((s) => ({ name: s.fileName, version: s.version, sha256: s.sha256, sizeBytes: s.sizeBytes, driveItemId: s.item.id })),
      needsPartnerReview,
    };
  } catch (e) {
    return fail(errText(e));
  }
}
