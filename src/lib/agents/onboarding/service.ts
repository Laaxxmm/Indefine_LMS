// Onboarding service: the one lib call behind each /api/firm-os/onboard route.
//
//   start(prompt)            create a DRAFT run, extract a partial spec, return questions
//   answer(runId, answers)   merge the short form (and/or a follow-up sentence), re-validate
//   plan(runId)              build the plan preview (auto-creates when FIRM_OS_ONBOARD_CONFIRM=false)
//   create(runId)            partner/manager clicked "Create": confirm and run the saga
//   resume(runId)            continue the saga from the first step that is not done
//   turiaConfirm(...)        "Done in Turia" for one ManualBridge checklist
//
// Every function returns the same RunView so the panel renders one shape. All I/O is injected.
import type { TuriaMode } from "@/lib/integrations/turia/adapter";
import type { TuriaChecklist } from "@/lib/integrations/turia/adapter";
import type { ManualBridge, TuriaSyncRecord } from "@/lib/integrations/turia/manual-bridge";
import { applyAnswers, clarify, type Answers, type Question } from "./clarify";
import { extractSpec, type ExtractRouter } from "./extract";
import { resolvePeople, type Person } from "./people";
import { buildPlan, type OnboardingPlan } from "./plan";
import type { JobPlanner } from "./planner";
import { initialSteps, normalizeSteps, type RunRecord, type RunStatus, type Saga, type SagaStep } from "./saga";
import { OnboardingSpec, partialSpecZ, type PartialSpec } from "./spec";
import { gstStateCode, issuesByField, validateSpec, type Issue, type ValidationPorts } from "./validators";

export class OnboardingError extends Error {
  constructor(public readonly code: "not-found" | "conflict" | "invalid", message: string) {
    super(message);
    this.name = "OnboardingError";
  }
}

export interface RunStore {
  create(input: { createdById: string; prompt: string; spec: PartialSpec }): Promise<RunRecord>;
  get(id: string): Promise<RunRecord | null>;
  update(id: string, patch: { spec?: PartialSpec; plan?: OnboardingPlan | null; status?: RunStatus; steps?: SagaStep[] }): Promise<RunRecord>;
}

export interface OnboardingDeps {
  runs: RunStore;
  router: ExtractRouter;
  people: () => Promise<Person[]>;
  ports: ValidationPorts;
  planner: JobPlanner;
  saga: Saga;
  turiaMode: TuriaMode;
  confirmRequired: boolean;
  /** ManualBridge over the TuriaSync repo: confirmations work whatever bridge is active. */
  manual: ManualBridge;
  listTuriaSyncs: (firmClientId: string) => Promise<TuriaSyncRecord[]>;
  getTuriaSync: (id: string) => Promise<TuriaSyncRecord | null>;
  setTuriaClientRef: (firmClientId: string, ref: string) => Promise<void>;
  audit: (event: { actorId: string; action: string; entity: string; entityId: string | null; meta?: Record<string, unknown> }) => Promise<void>;
  now?: () => Date;
}

export interface TuriaItem {
  syncId: string;
  operation: TuriaSyncRecord["operation"];
  status: TuriaSyncRecord["status"];
  turiaRef: string | null;
  minutesLogged: number | null;
  checklist: TuriaChecklist | null;
}

export interface RunView {
  id: string;
  status: RunStatus;
  spec: PartialSpec;
  questions: Question[];
  /** Problems that are not one of this turn's questions (e.g. a CIN given for a proprietorship). */
  errors: Issue[];
  checks: string[];
  notes: string[];
  needsReview: boolean;
  /** No questions and no errors: a plan can be built. */
  complete: boolean;
  plan: OnboardingPlan | null;
  steps: SagaStep[] | null;
  turia: TuriaItem[];
  confirmRequired: boolean;
}

export function createOnboardingService(deps: OnboardingDeps) {
  const now = deps.now ?? (() => new Date());

  async function load(runId: string): Promise<RunRecord> {
    const run = await deps.runs.get(runId);
    if (!run) throw new OnboardingError("not-found", "Onboarding run not found");
    return run;
  }

  async function view(run: RunRecord, extra: { notes?: string[]; needsReview?: boolean; answerErrors?: Issue[] } = {}): Promise<RunView> {
    const people = await deps.people();
    const { spec, candidates } = resolvePeople(partialSpecZ.parse(run.spec ?? {}), people);
    const v = await validateSpec(spec, deps.ports);
    const errors = [...(extra.answerErrors ?? []), ...v.errors];
    const questions = run.status === "DRAFT" ? clarify(spec, { people, candidates, invalid: issuesByField(errors), now: now() }) : [];
    const asked = new Set(questions.map((q) => q.field));
    const turia = run.firmClientId
      ? (await deps.listTuriaSyncs(run.firmClientId)).map((s) => ({
          syncId: s.id, operation: s.operation, status: s.status, turiaRef: s.turiaRef, minutesLogged: s.minutesLogged, checklist: s.evidence?.checklist ?? null,
        }))
      : [];
    return {
      id: run.id,
      status: run.status,
      spec,
      questions,
      errors: errors.filter((e) => !asked.has(e.field)),
      checks: v.checks,
      notes: extra.notes ?? [],
      needsReview: extra.needsReview ?? false,
      complete: questions.length === 0 && errors.length === 0,
      plan: run.plan,
      steps: run.steps ? normalizeSteps(run.steps) : null,
      turia,
      confirmRequired: deps.confirmRequired,
    };
  }

  function requireDraft(run: RunRecord) {
    if (run.status !== "DRAFT") throw new OnboardingError("conflict", "This onboarding has already been confirmed; it can only be resumed");
  }

  async function start(prompt: string, actorId: string): Promise<RunView> {
    const run = await deps.runs.create({ createdById: actorId, prompt, spec: {} });
    const people = await deps.people();
    const x = await extractSpec(prompt, { router: deps.router, runId: run.id, people });
    const saved = await deps.runs.update(run.id, { spec: x.spec });
    return view(saved, { notes: x.notes, needsReview: x.needsReview });
  }

  async function answer(runId: string, input: { answers?: Answers; message?: string }): Promise<RunView> {
    const run = await load(runId);
    requireDraft(run);
    let spec = partialSpecZ.parse(run.spec ?? {});
    const notes: string[] = [];
    let needsReview = false;
    if (input.message?.trim()) {
      const x = await extractSpec(input.message, { router: deps.router, runId, people: await deps.people(), base: spec });
      spec = x.spec;
      notes.push(...x.notes);
      needsReview = x.needsReview;
    }
    const applied = applyAnswers(spec, input.answers ?? {});
    const saved = await deps.runs.update(runId, { spec: applied.spec, plan: null }); // answers change the spec: any earlier plan is stale
    const answerErrors = Object.entries(applied.errors).map(([field, message]) => ({ field, message }) as Issue);
    return view(saved, { notes, needsReview, answerErrors });
  }

  async function plan(runId: string, actorId: string): Promise<RunView> {
    const run = await load(runId);
    requireDraft(run);
    const current = await view(run);
    if (!current.complete) throw new OnboardingError("invalid", "Answer the remaining questions before planning");
    const spec = OnboardingSpec.parse(current.spec);
    const people = await deps.people();
    const name = (id: string) => people.find((p) => p.id === id)?.name ?? id;
    const v = await validateSpec(spec, deps.ports);
    const jobs = await deps.planner.planJobs({
      entityType: spec.entityType,
      services: spec.services,
      fy: spec.fy,
      firstPeriod: spec.firstPeriod ?? null,
      gstStateCode: spec.gstins.length ? gstStateCode(spec.gstins[0]) : null,
      qrmp: spec.services.some((l) => l.service === "GST" && l.frequency === "QUARTERLY"),
    });
    const built = buildPlan(spec, {
      jobs,
      existingLmsClient: v.existingLmsClient,
      turiaMode: deps.turiaMode,
      checks: v.checks,
      confirmRequired: deps.confirmRequired,
      plannerSource: deps.planner.source,
      people: { assignee: { id: spec.assigneeId, name: name(spec.assigneeId) }, reviewer: { id: spec.reviewerId, name: name(spec.reviewerId) } },
      now: now(),
    });
    const saved = await deps.runs.update(runId, { spec, plan: built });
    if (!deps.confirmRequired) return create(runId, actorId);
    return view(saved);
  }

  async function create(runId: string, actorId: string): Promise<RunView> {
    const run = await load(runId);
    if (!run.plan) throw new OnboardingError("invalid", "Build the plan first");
    if (run.status === "DRAFT") {
      await deps.runs.update(runId, { status: "CONFIRMED", steps: initialSteps() });
      await deps.audit({ actorId, action: "onboarding.confirm", entity: "OnboardingRun", entityId: runId, meta: { clientCode: run.plan.clientCode } });
    }
    return view(await deps.saga.execute(runId, actorId));
  }

  async function resume(runId: string, actorId: string): Promise<RunView> {
    const run = await load(runId);
    if (run.status === "DRAFT") throw new OnboardingError("conflict", "This plan has not been confirmed yet");
    return view(await deps.saga.resume(runId, actorId));
  }

  async function turiaConfirm(runId: string, input: { syncId: string; turiaRef: string; minutes?: number | null }, actorId: string): Promise<RunView> {
    const run = await load(runId);
    const sync = await deps.getTuriaSync(input.syncId);
    if (!sync || !run.firmClientId || sync.firmClientId !== run.firmClientId) throw new OnboardingError("not-found", "That Turia checklist is not part of this onboarding");
    const rec = await deps.manual.confirm(input.syncId, { turiaRef: input.turiaRef, minutes: input.minutes ?? null, confirmedBy: actorId });
    if (rec.operation === "createClient") await deps.setTuriaClientRef(run.firmClientId, rec.turiaRef as string);
    await deps.audit({ actorId, action: "turia.confirm", entity: "TuriaSync", entityId: rec.id, meta: { operation: rec.operation, runId } });
    const settled = await deps.saga.settleWaiting(runId, async (id) => {
      const s = await deps.getTuriaSync(id);
      return s?.status === "CONFIRMED" || s?.status === "CLOSED";
    });
    return view(settled);
  }

  async function get(runId: string): Promise<RunView> {
    return view(await load(runId));
  }

  return { start, answer, plan, create, resume, turiaConfirm, get };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;
