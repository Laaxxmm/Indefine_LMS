// In-memory onboarding database for saga/service tests. Enforces the same unique keys Prisma
// does (Client name/PAN, FirmClient code + lmsClientId, Engagement (client, service), JobTask
// (client, service, fy, period, title)) so a duplicate on re-run fails loudly. Never removes rows.
import type { FirmService, JobTaskState } from "@prisma/client";
import type { OnboardingPlan } from "@/lib/agents/onboarding/plan";
import type { JobTaskRef, RunPatch, RunRecord, RunStatus, SagaStep, SagaStore } from "@/lib/agents/onboarding/saga";
import type { RunStore } from "@/lib/agents/onboarding/service";
import type { PartialSpec, OnboardingSpec } from "@/lib/agents/onboarding/spec";
import type { Person } from "@/lib/agents/onboarding/people";

type Method = keyof SagaStore;

export interface MemClient { id: string; name: string; pan: string | null; createdById: string }
export interface MemFirmClient { id: string; lmsClientId: string; clientCode: string; clSiteUrl: string | null; turiaClientRef: string | null }
export interface MemEngagement { id: string; firmClientId: string; service: FirmService; frequency: string; assigneeId: string; reviewerId: string }
export interface MemJobTask extends JobTaskRef { firmClientId: string; engagementId: string | null; state: JobTaskState; assigneeId: string; reviewerId: string }
export interface MemEvent { jobTaskId: string; fromState: JobTaskState | null; toState: JobTaskState; actorId: string }

export class MemoryOnboardingStore implements SagaStore, RunStore {
  runs = new Map<string, RunRecord & { prompt: string }>();
  clients: MemClient[] = [];
  firmClients: MemFirmClient[] = [];
  engagements: MemEngagement[] = [];
  jobTasks: MemJobTask[] = [];
  events: MemEvent[] = [];
  audits: Array<{ action: string; entityId: string | null }> = [];
  people: Person[];
  private seq = 0;
  private failures = new Map<Method, { error: Error; skip: number }>();
  /** ensureJobTasks creates this many tasks, then throws (partial failure). */
  failJobTasksAfter: number | null = null;
  clock = new Date("2026-11-05T10:00:00Z");

  constructor(people: Person[]) {
    this.people = people;
  }

  private id(p: string) {
    return `${p}-${++this.seq}`;
  }

  /** Make `method` throw once, after `skip` successful calls. */
  failOnce(method: Method, error: Error, skip = 0) {
    this.failures.set(method, { error, skip });
  }

  private check(method: Method) {
    const f = this.failures.get(method);
    if (!f) return;
    if (f.skip > 0) {
      f.skip--;
      return;
    }
    this.failures.delete(method); // test bookkeeping only (tests/ is outside the no-delete scope)
    throw f.error;
  }

  private tick() {
    this.clock = new Date(this.clock.getTime() + 1000);
    return this.clock;
  }

  // ---------------- RunStore
  async create(input: { createdById: string; prompt: string; spec: PartialSpec }): Promise<RunRecord> {
    const run = { id: this.id("run"), createdById: input.createdById, prompt: input.prompt, status: "DRAFT" as RunStatus, spec: input.spec as OnboardingSpec, plan: null, steps: null, firmClientId: null, error: null, updatedAt: this.tick() };
    this.runs.set(run.id, run);
    return structuredClone(run);
  }
  async get(id: string) {
    const r = this.runs.get(id);
    return r ? structuredClone(r) : null;
  }
  async update(id: string, patch: { spec?: PartialSpec; plan?: OnboardingPlan | null; status?: RunStatus; steps?: SagaStep[] }) {
    const r = this.runs.get(id)!;
    if (patch.spec !== undefined) r.spec = structuredClone(patch.spec) as OnboardingSpec;
    if (patch.plan !== undefined) r.plan = structuredClone(patch.plan);
    if (patch.status !== undefined) r.status = patch.status;
    if (patch.steps !== undefined) r.steps = structuredClone(patch.steps);
    r.updatedAt = this.tick();
    return structuredClone(r);
  }

  // ---------------- SagaStore
  async getRun(id: string) {
    this.check("getRun");
    return this.get(id);
  }
  async claimRun(id: string, staleBefore: Date) {
    const r = this.runs.get(id);
    if (!r) return false;
    const ok = ["CONFIRMED", "FAILED", "BLOCKED", "DONE"].includes(r.status) || (r.status === "RUNNING" && r.updatedAt < staleBefore);
    if (ok) {
      r.status = "RUNNING";
      r.updatedAt = this.tick();
    }
    return ok;
  }
  async saveRun(id: string, patch: RunPatch) {
    this.check("saveRun");
    const r = this.runs.get(id)!;
    if (patch.status !== undefined) r.status = patch.status;
    if (patch.steps !== undefined) r.steps = JSON.parse(JSON.stringify(patch.steps));
    if (patch.error !== undefined) r.error = patch.error;
    if (patch.firmClientId !== undefined) r.firmClientId = patch.firmClientId;
    r.updatedAt = this.tick();
  }
  async createOrLinkClient({ spec, plan, actorId }: { spec: OnboardingSpec; plan: OnboardingPlan; actorId: string }) {
    this.check("createOrLinkClient");
    const existing = this.firmClients.find((f) => f.clientCode === spec.clientCode);
    if (existing) return { lmsClientId: existing.lmsClientId, firmClientId: existing.id, linked: true };
    let lmsClientId = plan.lmsClient.action === "link" ? plan.lmsClient.existingId : null;
    if (!lmsClientId) {
      if (this.clients.some((c) => c.name.toLowerCase() === spec.legalName.toLowerCase() || (c.pan && c.pan === spec.pan))) throw new Error("unique violation: Client");
      lmsClientId = this.id("client");
      this.clients.push({ id: lmsClientId, name: spec.legalName, pan: spec.pan, createdById: actorId });
    }
    if (this.firmClients.some((f) => f.lmsClientId === lmsClientId)) throw new Error("unique violation: FirmClient.lmsClientId");
    const fc = { id: this.id("fc"), lmsClientId, clientCode: spec.clientCode, clSiteUrl: null, turiaClientRef: null };
    this.firmClients.push(fc);
    return { lmsClientId, firmClientId: fc.id, linked: plan.lmsClient.action === "link" };
  }
  async setClientSite(firmClientId: string, siteUrl: string) {
    this.check("setClientSite");
    this.firmClients.find((f) => f.id === firmClientId)!.clSiteUrl = siteUrl;
  }
  async ensureEngagements({ firmClientId, lines, people }: Parameters<SagaStore["ensureEngagements"]>[0]) {
    this.check("ensureEngagements");
    const ids: Partial<Record<FirmService, string>> = {};
    for (const l of lines) {
      let e = this.engagements.find((x) => x.firmClientId === firmClientId && x.service === l.service);
      if (!e) {
        e = { id: this.id("eng"), firmClientId, service: l.service, frequency: l.frequency, assigneeId: people.assignee.id, reviewerId: people.reviewer.id };
        this.engagements.push(e);
      }
      ids[l.service] = e.id;
    }
    return ids;
  }
  async ensureJobTasks({ firmClientId, engagementIds, jobs, people, actorId }: Parameters<SagaStore["ensureJobTasks"]>[0]) {
    this.check("ensureJobTasks");
    let created = 0;
    let existing = 0;
    for (const j of jobs) {
      if (this.jobTasks.some((t) => t.firmClientId === firmClientId && t.service === j.service && t.fy === j.fy && t.period === j.period && t.title === j.title)) {
        existing++;
        continue;
      }
      if (this.failJobTasksAfter !== null && created >= this.failJobTasksAfter) {
        this.failJobTasksAfter = null;
        throw new Error("connection reset while creating JobTasks");
      }
      const t: MemJobTask = {
        id: this.id("jt"), firmClientId, engagementId: engagementIds[j.service] ?? null, service: j.service, title: j.title, fy: j.fy, period: j.period,
        state: "ASSIGNED", assigneeId: people.assignee.id, reviewerId: people.reviewer.id,
        statutoryDueOn: j.statutoryDueOn ? new Date(j.statutoryDueOn) : null, internalDueOn: j.internalDueOn ? new Date(j.internalDueOn) : null,
      };
      this.jobTasks.push(t);
      this.events.push({ jobTaskId: t.id, fromState: null, toState: "ASSIGNED", actorId });
      created++;
    }
    return { created, existing };
  }
  async listJobTasks(firmClientId: string) {
    this.check("listJobTasks");
    return this.jobTasks.filter((t) => t.firmClientId === firmClientId).map(({ id, service, title, fy, period, internalDueOn, statutoryDueOn }) => ({ id, service, title, fy, period, internalDueOn, statutoryDueOn }));
  }
  async activeUser(id: string) {
    this.check("activeUser");
    return this.people.find((p) => p.id === id) ?? null;
  }
  async audit(event: { actorId: string; action: string; entity: string; entityId: string | null }) {
    this.check("audit");
    this.audits.push({ action: event.action, entityId: event.entityId });
  }
}
