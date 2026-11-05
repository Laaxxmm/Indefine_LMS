// Onboarding saga: an idempotent, resumable executor over one OnboardingRun row.
//
//   (a) lmsClient   LMS Client record (src/lib/clients/service.ts) + FirmClient link
//   (b) turia       Turia client + one service per engagement via the active TuriaAdapter
//   (c) sharepoint  ensureClientSite + ensureFyTree (Path A)
//   (d) jobs        Engagement rows + JobTasks (ASSIGNED, with a JobTaskEvent null → ASSIGNED)
//   (e) assignment  assignee/reviewer check + Turia task for the first period of each job series
//   (f) summary     links and what is left for a person to do
//
// Every step's status, times and error are written to OnboardingRun.steps as it happens.
// A failure stops the saga at that step (run FAILED); resume() continues from the first step
// that is not done. A BlockedError (a human must act first: PnP certificate, Turia API …) marks
// the step BLOCKED with the exact action and the saga carries on with steps that do not depend
// on it; the run ends BLOCKED until resumed. Nothing is ever rolled back by deletion: every
// write is create-if-missing, so re-running a step finds what the last attempt made.
// All side effects are injected (SagaDeps) so the whole saga runs in unit tests.
import type { FirmService } from "@prisma/client";
import type { TuriaAdapter, TuriaOpResult } from "@/lib/integrations/turia/adapter";
import { BlockedError } from "@/lib/integrations/sharepoint/errors";
import type { FyTreeOptions } from "@/lib/integrations/sharepoint/clfolders";
import { auditDbFromSink, logAudit } from "@/lib/audit/log";
import type { OnboardingPlan, PlanJob } from "./plan";
import type { OnboardingSpec, ServiceLine } from "./spec";

export const STEP_KEYS = ["lmsClient", "turia", "sharepoint", "jobs", "assignment", "summary"] as const;
export type StepKey = (typeof STEP_KEYS)[number];
export type StepStatus = "pending" | "running" | "done" | "waiting" | "blocked" | "failed";
export type RunStatus = "DRAFT" | "CONFIRMED" | "RUNNING" | "BLOCKED" | "FAILED" | "DONE";

export const STEP_LABELS: Record<StepKey, string> = {
  lmsClient: "LMS client record",
  turia: "Turia client and services",
  sharepoint: "SharePoint site and FY folders",
  jobs: "Engagements and jobs",
  assignment: "Assignment, deadlines and Turia tasks",
  summary: "Summary",
};

const DEPENDS_ON: Record<StepKey, StepKey[]> = {
  lmsClient: [],
  turia: ["lmsClient"],
  sharepoint: ["lmsClient"],
  jobs: ["lmsClient"],
  assignment: ["jobs"],
  summary: [],
};

export interface SagaStep {
  key: StepKey;
  label: string;
  status: StepStatus;
  startedAt?: string;
  finishedAt?: string;
  /** Failed: what went wrong. */
  error?: string;
  /** Blocked or waiting: the exact thing a person must do. */
  action?: string;
  result?: Record<string, unknown>;
  attempts?: number;
}

export interface RunRecord {
  id: string;
  createdById: string;
  status: RunStatus;
  spec: OnboardingSpec;
  plan: OnboardingPlan | null;
  steps: SagaStep[] | null;
  firmClientId: string | null;
  error: string | null;
  updatedAt: Date;
}

export interface RunPatch {
  status?: RunStatus;
  steps?: SagaStep[];
  error?: string | null;
  firmClientId?: string;
}

export interface JobTaskRef {
  id: string;
  service: FirmService;
  title: string;
  fy: string;
  period: string;
  internalDueOn: Date | null;
  statutoryDueOn: Date | null;
}

export interface People {
  assignee: { id: string; name: string };
  reviewer: { id: string; name: string };
}

/** Database side of the saga. Production: ./db.ts (Prisma). Tests: an in-memory store. */
export interface SagaStore {
  getRun(id: string): Promise<RunRecord | null>;
  /** Atomically mark the run RUNNING; false if another execution holds it (and is not stale). */
  claimRun(id: string, staleBefore: Date): Promise<boolean>;
  saveRun(id: string, patch: RunPatch): Promise<void>;
  createOrLinkClient(input: { spec: OnboardingSpec; plan: OnboardingPlan; actorId: string }): Promise<{ lmsClientId: string; firmClientId: string; linked: boolean }>;
  setClientSite(firmClientId: string, siteUrl: string): Promise<void>;
  ensureEngagements(input: { firmClientId: string; lines: ServiceLine[]; people: People; firstPeriod: string | null }): Promise<Partial<Record<FirmService, string>>>;
  ensureJobTasks(input: { firmClientId: string; engagementIds: Partial<Record<FirmService, string>>; jobs: PlanJob[]; people: People; actorId: string }): Promise<{ created: number; existing: number }>;
  listJobTasks(firmClientId: string): Promise<JobTaskRef[]>;
  activeUser(id: string): Promise<{ id: string; name: string } | null>;
  audit(event: { actorId: string; action: string; entity: string; entityId: string | null; meta?: Record<string, unknown> }): Promise<void>;
}

export interface SagaSharePoint {
  ensureClientSite(code: string): Promise<{ siteUrl: string; created: string[] }>;
  ensureFyTree(code: string, fy: string, opts?: FyTreeOptions): Promise<{ siteUrl: string; folders: number; created: string[] }>;
}

export interface SagaDeps {
  store: SagaStore;
  turia: TuriaAdapter;
  sharepoint: SagaSharePoint;
  now?: () => Date;
  /** A RUNNING claim older than this is treated as a crashed execution (default 10 min). */
  staleAfterMs?: number;
}

export class SagaError extends Error {
  constructor(public readonly code: "not-found" | "not-confirmed" | "busy", message: string) {
    super(message);
    this.name = "SagaError";
  }
}

export function initialSteps(): SagaStep[] {
  return STEP_KEYS.map((key) => ({ key, label: STEP_LABELS[key], status: "pending" }));
}

/** Normalise stored steps (older or partial rows) to the full ordered list. */
export function normalizeSteps(stored: SagaStep[] | null | undefined): SagaStep[] {
  const byKey = new Map((stored ?? []).map((s) => [s.key, s]));
  return STEP_KEYS.map((key) => ({ key, label: STEP_LABELS[key], status: "pending" as StepStatus, ...byKey.get(key) }));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

type StepOutcome = { status: "done" | "waiting"; result: Record<string, unknown>; action?: string };

function turiaOutcome(results: TuriaOpResult[], what: string): StepOutcome {
  const open = results.filter((r) => r.status !== "CONFIRMED" && r.status !== "CLOSED");
  const result = { mode: results[0]?.mode ?? null, syncIds: results.map((r) => r.syncId), open: open.length };
  if (!open.length) return { status: "done", result };
  return {
    status: "waiting",
    result,
    action: `Complete ${open.length} Turia checklist${open.length === 1 ? "" : "s"} (${what}) and confirm each with "Done in Turia".`,
  };
}

export function createSaga(deps: SagaDeps) {
  const now = deps.now ?? (() => new Date());
  const staleAfterMs = deps.staleAfterMs ?? 10 * 60_000;
  const { store, turia, sharepoint } = deps;

  async function runStep(key: StepKey, run: RunRecord, steps: SagaStep[], actorId: string): Promise<StepOutcome> {
    const plan = run.plan as OnboardingPlan;
    const spec = run.spec;
    const ctx = (k: StepKey) => steps.find((s) => s.key === k)?.result ?? {};
    const firmClientId = () => String(ctx("lmsClient").firmClientId ?? run.firmClientId ?? "");

    switch (key) {
      case "lmsClient": {
        const r = await store.createOrLinkClient({ spec, plan, actorId });
        await store.saveRun(run.id, { firmClientId: r.firmClientId });
        return { status: "done", result: r };
      }
      case "turia": {
        const fc = firmClientId();
        const results = [
          await turia.createClient(
            {
              firmClientId: fc, clientCode: spec.clientCode, legalName: spec.legalName, entityType: spec.entityType, pan: spec.pan,
              gstins: spec.gstins, cin: spec.cin ?? null, contactName: spec.contactName, contactEmail: spec.contactEmail,
              contactPhone: spec.contactPhone, billing: spec.billing,
            },
            actorId,
          ),
        ];
        for (const line of plan.engagements) {
          results.push(
            await turia.addService(
              {
                firmClientId: fc, clientCode: spec.clientCode, legalName: spec.legalName, service: line.service, frequency: line.frequency,
                assigneeName: plan.people.assignee.name, reviewerName: plan.people.reviewer.name, firstPeriod: spec.firstPeriod ?? null,
              },
              actorId,
            ),
          );
        }
        return turiaOutcome(results, "client and services");
      }
      case "sharepoint": {
        const site = await sharepoint.ensureClientSite(spec.clientCode);
        await store.setClientSite(firmClientId(), site.siteUrl);
        const tree = await sharepoint.ensureFyTree(spec.clientCode, plan.sharepoint.fy, { services: plan.sharepoint.services });
        return { status: "done", result: { siteUrl: site.siteUrl, created: site.created.length + tree.created.length, folders: tree.folders } };
      }
      case "jobs": {
        const fc = firmClientId();
        const engagementIds = await store.ensureEngagements({ firmClientId: fc, lines: plan.engagements, people: plan.people, firstPeriod: spec.firstPeriod ?? null });
        const r = await store.ensureJobTasks({ firmClientId: fc, engagementIds, jobs: plan.jobs, people: plan.people, actorId });
        return { status: "done", result: { engagements: Object.keys(engagementIds).length, created: r.created, existing: r.existing, total: plan.jobs.length } };
      }
      case "assignment": {
        for (const who of ["assignee", "reviewer"] as const) {
          if (!(await store.activeUser(plan.people[who].id))) throw new Error(`The ${who} ${plan.people[who].name} is no longer an active LMS user; re-plan with someone else`);
        }
        const fc = firmClientId();
        const tasks = await store.listJobTasks(fc);
        const results: TuriaOpResult[] = [];
        for (const job of plan.jobs.filter((j) => j.turiaTaskNow)) {
          const task = tasks.find((t) => t.service === job.service && t.title === job.title && t.period === job.period && t.fy === job.fy);
          if (!task) throw new Error(`JobTask ${job.title} ${job.period} is missing; resume to re-run the jobs step`);
          results.push(
            await turia.createTask(
              {
                firmClientId: fc, jobTaskId: task.id, clientCode: spec.clientCode, legalName: spec.legalName, service: task.service,
                title: task.title, fy: task.fy, period: task.period, assigneeName: plan.people.assignee.name,
                reviewerName: plan.people.reviewer.name, dueOn: task.internalDueOn,
              },
              actorId,
            ),
          );
        }
        const withDates = tasks.filter((t) => t.statutoryDueOn).length;
        const out = results.length ? turiaOutcome(results, "first-period tasks") : { status: "done" as const, result: { open: 0, syncIds: [] } };
        return { ...out, result: { ...out.result, jobTasks: tasks.length, withDates, assigneeId: plan.people.assignee.id, reviewerId: plan.people.reviewer.id } };
      }
      case "summary": {
        const fc = firmClientId();
        const tasks = fc ? await store.listJobTasks(fc) : [];
        const next = tasks.filter((t) => t.internalDueOn).sort((a, b) => a.internalDueOn!.getTime() - b.internalDueOn!.getTime())[0];
        const lms = ctx("lmsClient");
        return {
          status: "done",
          result: {
            clientUrl: lms.lmsClientId ? `/clients/${String(lms.lmsClientId)}` : null,
            siteUrl: ctx("sharepoint").siteUrl ?? plan.sharepoint.siteUrl,
            jobTasks: tasks.length,
            nextInternalDue: next ? { title: next.title, period: next.period, on: next.internalDueOn!.toISOString() } : null,
            blocked: steps.filter((s) => s.status === "blocked").map((s) => s.key),
            waiting: steps.filter((s) => s.status === "waiting").map((s) => s.key),
          },
        };
      }
    }
  }

  /** Run (or resume) the saga. Returns the run as stored at the end. */
  async function execute(runId: string, actorId: string): Promise<RunRecord> {
    const run = await store.getRun(runId);
    if (!run) throw new SagaError("not-found", "Onboarding run not found");
    if (!run.plan || run.status === "DRAFT") throw new SagaError("not-confirmed", "This plan has not been confirmed yet");
    if (!(await store.claimRun(runId, new Date(now().getTime() - staleAfterMs)))) {
      throw new SagaError("busy", "This onboarding is already running. Wait for it to finish, then refresh.");
    }
    const steps = normalizeSteps(run.steps);
    const save = (patch: RunPatch = {}) => store.saveRun(runId, { steps: steps.map((s) => ({ ...s })), ...patch });
    await save({ status: "RUNNING", error: null });

    for (const step of steps) {
      if (step.status === "done") continue;
      const unmet = DEPENDS_ON[step.key].filter((d) => steps.find((s) => s.key === d)?.status !== "done" && steps.find((s) => s.key === d)?.status !== "waiting");
      if (unmet.length) {
        Object.assign(step, { status: "pending", action: `Waits for: ${unmet.map((u) => STEP_LABELS[u]).join(", ")}` });
        step.error = undefined;
        continue;
      }
      Object.assign(step, { status: "running", startedAt: now().toISOString(), attempts: (step.attempts ?? 0) + 1 });
      step.finishedAt = undefined;
      step.error = undefined;
      step.action = undefined;
      await save();
      try {
        const out = await runStep(step.key, run, steps, actorId);
        Object.assign(step, { status: out.status, result: out.result, action: out.action, finishedAt: now().toISOString() });
        if (step.key === "lmsClient") run.firmClientId = String(out.result.firmClientId);
        await save();
      } catch (e) {
        if (e instanceof BlockedError) {
          Object.assign(step, { status: "blocked", action: e.action, error: message(e), finishedAt: now().toISOString() });
          await save();
          continue;
        }
        Object.assign(step, { status: "failed", error: message(e), finishedAt: now().toISOString() });
        await save({ status: "FAILED", error: `${step.label} failed: ${message(e)}` });
        return (await store.getRun(runId)) as RunRecord;
      }
    }

    const blocked = steps.filter((s) => s.status === "blocked");
    const status: RunStatus = blocked.length ? "BLOCKED" : "DONE";
    await save({ status, error: blocked.length ? `Blocked: ${blocked.map((s) => s.label).join(", ")}` : null });
    // Through logAudit (validated row); the injected store persists it (production: Prisma).
    await logAudit(auditDbFromSink(store), {
      actorId,
      action: status === "DONE" ? "onboarding.done" : "onboarding.blocked",
      entity: "OnboardingRun",
      entityId: runId,
      meta: { clientCode: run.spec.clientCode, firmClientId: run.firmClientId, steps: steps.map((s) => [s.key, s.status]) },
    });
    return (await store.getRun(runId)) as RunRecord;
  }

  /**
   * After a Turia confirmation: a waiting step whose Turia syncs are all confirmed becomes done.
   * `isSettled(syncId)` tells whether one sync is CONFIRMED/CLOSED.
   */
  async function settleWaiting(runId: string, isSettled: (syncId: string) => Promise<boolean>): Promise<RunRecord> {
    const run = await store.getRun(runId);
    if (!run) throw new SagaError("not-found", "Onboarding run not found");
    const steps = normalizeSteps(run.steps);
    let changed = false;
    for (const step of steps) {
      if (step.status !== "waiting") continue;
      const ids = (step.result?.syncIds as string[] | undefined) ?? [];
      const open: string[] = [];
      for (const id of ids) if (!(await isSettled(id))) open.push(id);
      step.result = { ...step.result, open: open.length };
      if (!open.length) Object.assign(step, { status: "done", action: undefined, finishedAt: now().toISOString() });
      else step.action = `Complete ${open.length} Turia checklist${open.length === 1 ? "" : "s"} and confirm each with "Done in Turia".`;
      changed = true;
    }
    if (changed) await store.saveRun(runId, { steps });
    return (await store.getRun(runId)) as RunRecord;
  }

  return { execute, resume: execute, settleWaiting };
}

export type Saga = ReturnType<typeof createSaga>;
