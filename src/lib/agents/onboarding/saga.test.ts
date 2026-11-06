// Saga integration: in-memory DB (unique keys enforced), the real ManualBridge over an in-memory
// TuriaSync repo, and the real Path A clfolders against the fake SharePoint/Graph transport.
import { describe, expect, it } from "vitest";
import { DEFAULT_CALENDAR } from "@/lib/agents/core";
import { createClFolders } from "@/lib/integrations/sharepoint/clfolders";
import { readSharePointConfig } from "@/lib/integrations/sharepoint/config";
import { createSharePointClient } from "@/lib/integrations/sharepoint/graph-client";
import type { TuriaAdapter } from "@/lib/integrations/turia/adapter";
import { TuriaBlockedError } from "@/lib/integrations/turia/errors";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { FakeSharePoint } from "../../../../tests/fakes/fake-sharepoint";
import { FakeTuriaRepo } from "../../../../tests/fakes/fake-turia-repo";
import { MemoryOnboardingStore } from "../../../../tests/fakes/fake-onboarding-store";
import { PEOPLE, completeSpec } from "./__fixtures__/synthetic";
import { buildPlan, type OnboardingPlan } from "./plan";
import { createCalendarPlanner } from "./planner";
import { STEP_KEYS, SagaError, createSaga, initialSteps, normalizeSteps, type SagaSharePoint, type StepKey } from "./saga";

const NOW = new Date("2026-11-05T10:00:00Z");
const CONFIGURED_ENV = { SP_PNP_CERT_KEY_PEM: "k", SP_PNP_CERT_THUMBPRINT: "8ED1DCE79AD893C70D19A48E77C202AE8FC574D3", SP_SITE_OWNER: "partner@srca.in" };

/** Wrap `obj` so `method` throws `error` once, on call number `onCall` (1-based). */
function flaky<T extends object>(obj: T, method: keyof T, error: Error, onCall = 1): T {
  let calls = 0;
  return new Proxy(obj, {
    get(target, key, recv) {
      const v = Reflect.get(target, key, recv);
      if (key !== method || typeof v !== "function") return typeof v === "function" ? v.bind(target) : v;
      return async (...args: unknown[]) => {
        calls++;
        if (calls === onCall) throw error;
        return v.apply(target, args);
      };
    },
  });
}

async function setup(o: { env?: Record<string, string>; hub?: boolean } = {}) {
  const store = new MemoryOnboardingStore(PEOPLE);
  const repo = new FakeTuriaRepo();
  const manual = new ManualBridge(repo, () => NOW);
  const fake = new FakeSharePoint();
  if (o.hub !== false) fake.addHub();
  const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "g", sharePointToken: async () => "s", sleep: async () => {} });
  const cl = createClFolders({ client, config: readSharePointConfig(o.env ?? CONFIGURED_ENV), sleep: async () => {}, pollMs: 1, maxPolls: 2 });
  const sharepoint: SagaSharePoint = { ensureClientSite: (c) => cl.ensureClientSite(c), ensureFyTree: (c, fy, opts) => cl.ensureFyTree(c, fy, opts) };
  const spec = completeSpec();
  const jobs = await createCalendarPlanner({ loadPack: async () => ({ pack: DEFAULT_CALENDAR, source: "defaults" }) }).planJobs({
    entityType: spec.entityType, services: spec.services, fy: spec.fy, firstPeriod: spec.firstPeriod, gstStateCode: "29", qrmp: false,
  });
  const plan: OnboardingPlan = buildPlan(spec, {
    jobs, existingLmsClient: null, turiaMode: "MANUAL", checks: [], confirmRequired: true, plannerSource: "defaults",
    people: { assignee: { id: "u-priya", name: "Priya Sharma" }, reviewer: { id: "u-ravi", name: "Ravi Kumar" } }, now: NOW,
  });
  const run = await store.create({ createdById: "u-partner", prompt: "Onboard Acme", spec });
  await store.update(run.id, { plan, status: "CONFIRMED", steps: initialSteps() });
  const saga = (turia: TuriaAdapter = manual, sp: SagaSharePoint = sharepoint) => createSaga({ store, turia, sharepoint: sp, now: () => NOW });
  return { store, repo, manual, fake, sharepoint, plan, runId: run.id, saga };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const statuses = async (ctx: Ctx) => Object.fromEntries(normalizeSteps((await ctx.store.get(ctx.runId))!.steps).map((s) => [s.key, s.status]));

/** Everything the plan promises exists exactly once. */
function expectCompleteNoDuplicates(ctx: Ctx) {
  const { store, repo, plan, fake } = ctx;
  expect(store.clients).toHaveLength(1);
  expect(store.firmClients).toHaveLength(1);
  expect(store.firmClients[0]).toMatchObject({ clientCode: "ACME01", clSiteUrl: "https://srcaassociate.sharepoint.com/sites/CL-ACME01" });
  expect(store.engagements.map((e) => e.service)).toEqual(["GST", "ROC", "Books"]);
  expect(store.jobTasks).toHaveLength(plan.jobs.length);
  expect(new Set(store.jobTasks.map((t) => `${t.service}|${t.title}|${t.period}`)).size).toBe(plan.jobs.length);
  expect(store.jobTasks.every((t) => t.state === "ASSIGNED" && t.assigneeId === "u-priya" && t.reviewerId === "u-ravi")).toBe(true);
  expect(store.events).toHaveLength(plan.jobs.length);
  expect(store.events.every((e) => e.fromState === null && e.toState === "ASSIGNED")).toBe(true);
  const ops = repo.rows.map((r) => r.operation);
  expect(ops.filter((o) => o === "createClient")).toHaveLength(1);
  expect(ops.filter((o) => o === "addService")).toHaveLength(3);
  expect(ops.filter((o) => o === "createTask")).toHaveLength(plan.turia.tasksNow);
  expect(new Set(repo.rows.map((r) => r.evidence?.key)).size).toBe(repo.rows.length);
  expect(fake.violations).toEqual([]); // no DELETE/PATCH ever reached SharePoint
}

describe("onboarding saga — golden path", () => {
  it("creates everything, records each step, ends DONE with Turia checklists waiting", async () => {
    const ctx = await setup();
    const run = await ctx.saga().execute(ctx.runId, "u-partner");
    expect(run.status).toBe("DONE");
    expect(await statuses(ctx)).toEqual({ lmsClient: "done", turia: "waiting", sharepoint: "done", jobs: "done", assignment: "waiting", summary: "done" });
    expectCompleteNoDuplicates(ctx);
    const steps = normalizeSteps(run.steps);
    expect(steps.every((s) => s.startedAt && s.finishedAt && s.attempts === 1)).toBe(true);
    expect(steps.find((s) => s.key === "turia")?.action).toMatch(/Complete 4 Turia checklists/);
    const summary = steps.find((s) => s.key === "summary")!.result!;
    expect(summary).toMatchObject({ clientUrl: `/clients/${ctx.store.clients[0].id}`, siteUrl: "https://srcaassociate.sharepoint.com/sites/CL-ACME01", jobTasks: ctx.plan.jobs.length, waiting: ["turia", "assignment"], blocked: [] });
    expect(summary.nextInternalDue).toMatchObject({ title: "GSTR-1", period: "2026-11" });
    expect(ctx.store.audits.map((a) => a.action)).toEqual(["onboarding.done"]);
    expect(run.firmClientId).toBe(ctx.store.firmClients[0].id);
  });

  it("resume after DONE changes nothing", async () => {
    const ctx = await setup();
    await ctx.saga().execute(ctx.runId, "u-partner");
    const posts = () => ctx.fake.calls.filter((c) => c.method === "POST").length;
    const before = posts();
    expect(before).toBeGreaterThan(0);
    const again = await ctx.saga().resume(ctx.runId, "u-partner");
    expect(again.status).toBe("DONE");
    expectCompleteNoDuplicates(ctx);
    expect(posts()).toBe(before); // SharePoint step was done: not even re-checked
  });

  it("settleWaiting: confirming every Turia checklist turns the waiting steps done", async () => {
    const ctx = await setup();
    const saga = ctx.saga();
    await saga.execute(ctx.runId, "u-partner");
    const isSettled = async (id: string) => ["CONFIRMED", "CLOSED"].includes((await ctx.repo.get(id))!.status);
    const [first, ...rest] = ctx.repo.rows;
    await ctx.manual.confirm(first.id, { turiaRef: "TUR-1", confirmedBy: "u-staff" });
    let run = await saga.settleWaiting(ctx.runId, isSettled);
    expect(normalizeSteps(run.steps).find((s) => s.key === "turia")).toMatchObject({ status: "waiting", action: expect.stringMatching(/Complete 3 Turia/) });
    for (const r of rest) await ctx.manual.confirm(r.id, { turiaRef: `TUR-${r.id}`, confirmedBy: "u-staff" });
    run = await saga.settleWaiting(ctx.runId, isSettled);
    expect(await statuses(ctx)).toMatchObject({ turia: "done", assignment: "done" });
    // A later resume re-issues nothing and keeps the steps done.
    await saga.resume(ctx.runId, "u-partner");
    expect(await statuses(ctx)).toMatchObject({ turia: "done", assignment: "done" });
    expect(ctx.repo.rows).toHaveLength(4 + ctx.plan.turia.tasksNow);
    await expect(saga.settleWaiting("nope", isSettled)).rejects.toBeInstanceOf(SagaError);
  });
});

describe("onboarding saga — failure at each step, then resume", () => {
  const boom = (m: string) => new Error(m);
  const cases: Array<{ step: StepKey; inject: (ctx: Ctx) => { turia?: TuriaAdapter; sp?: SagaSharePoint } }> = [
    { step: "lmsClient", inject: (ctx) => (ctx.store.failOnce("createOrLinkClient", boom("database timeout")), {}) },
    { step: "turia", inject: (ctx) => ({ turia: flaky(ctx.manual, "addService", boom("Turia sync write failed"), 2) }) }, // client + 1 service issued first
    { step: "sharepoint", inject: (ctx) => ({ sp: flaky(ctx.sharepoint, "ensureFyTree", boom("Graph 503 after retries")) }) }, // site created first
    { step: "jobs", inject: (ctx) => ((ctx.store.failJobTasksAfter = 4), {}) }, // 4 JobTasks written, then the connection drops
    { step: "assignment", inject: (ctx) => ({ turia: flaky(ctx.manual, "createTask", boom("Turia sync write failed"), 3) }) },
    { step: "summary", inject: (ctx) => (ctx.store.failOnce("listJobTasks", boom("read timeout"), 1), {}) }, // assignment's read passes, summary's fails
  ];

  for (const c of cases) {
    it(`${c.step}: stops at that step (FAILED), resume completes without duplicating anything`, async () => {
      const ctx = await setup();
      const { turia, sp } = c.inject(ctx);
      const failed = await ctx.saga(turia, sp).execute(ctx.runId, "u-partner");
      expect(failed.status).toBe("FAILED");
      expect(failed.error).toMatch(/failed:/);
      const steps = normalizeSteps(failed.steps);
      const idx = STEP_KEYS.indexOf(c.step);
      expect(steps[idx]).toMatchObject({ status: "failed", error: expect.any(String) });
      for (const later of steps.slice(idx + 1)) expect(later.status).toBe("pending"); // nothing ran after the failure
      for (const earlier of steps.slice(0, idx)) expect(["done", "waiting"]).toContain(earlier.status);

      const resumed = await ctx.saga().resume(ctx.runId, "u-partner");
      expect(resumed.status).toBe("DONE");
      expect(normalizeSteps(resumed.steps)[idx]).toMatchObject({ attempts: 2 });
      expect(normalizeSteps(resumed.steps).every((s) => ["done", "waiting"].includes(s.status))).toBe(true);
      expectCompleteNoDuplicates(ctx);
    });
  }
});

describe("onboarding saga — Path A blocked", () => {
  it("a BlockedError marks SharePoint BLOCKED with the human action; other steps still run; resume finishes", async () => {
    const ctx = await setup({ env: {} }); // no PnP certificate
    const run = await ctx.saga().execute(ctx.runId, "u-partner");
    expect(run.status).toBe("BLOCKED");
    expect(run.error).toBe("Blocked: SharePoint site and FY folders");
    const sp = normalizeSteps(run.steps).find((s) => s.key === "sharepoint")!;
    expect(sp.status).toBe("blocked");
    expect(sp.action).toMatch(/SP_PNP_CERT/);
    expect(await statuses(ctx)).toMatchObject({ lmsClient: "done", jobs: "done", summary: "done" });
    expect(ctx.store.jobTasks).toHaveLength(ctx.plan.jobs.length);
    expect(normalizeSteps(run.steps).find((s) => s.key === "summary")!.result).toMatchObject({ blocked: ["sharepoint"] });
    expect(ctx.store.audits.map((a) => a.action)).toEqual(["onboarding.blocked"]);

    // The human installs the certificate; resume retries only what is not done.
    const fixed = await setup();
    const resumed = await createSaga({ store: ctx.store, turia: ctx.manual, sharepoint: fixed.sharepoint, now: () => NOW }).resume(ctx.runId, "u-partner");
    expect(resumed.status).toBe("DONE");
    expect(normalizeSteps(resumed.steps).find((s) => s.key === "sharepoint")).toMatchObject({ status: "done", attempts: 2 });
    expect(ctx.store.jobTasks).toHaveLength(ctx.plan.jobs.length);
    expect(ctx.store.firmClients[0].clSiteUrl).toBe("https://srcaassociate.sharepoint.com/sites/CL-ACME01");
  });

  it("hub not registered is BLOCKED too (exact SharePoint admin step)", async () => {
    const ctx = await setup({ hub: false });
    const run = await ctx.saga().execute(ctx.runId, "u-partner");
    expect(normalizeSteps(run.steps).find((s) => s.key === "sharepoint")!.action).toMatch(/hub site/i);
  });

  it("a blocked Turia bridge blocks the Turia steps but not the jobs", async () => {
    const ctx = await setup();
    const blocked = new Proxy(ctx.manual, {
      get: (t, k) => (k === "createClient" || k === "createTask" ? async () => { throw new TuriaBlockedError("Use the manual bridge"); } : Reflect.get(t, k)),
    }) as TuriaAdapter;
    const run = await ctx.saga(blocked).execute(ctx.runId, "u-partner");
    expect(run.status).toBe("BLOCKED");
    expect(await statuses(ctx)).toMatchObject({ turia: "blocked", jobs: "done", assignment: "blocked" });
  });

  it("a step whose dependency is blocked waits (stays pending with the reason)", async () => {
    const ctx = await setup();
    const sp = flaky(ctx.sharepoint, "ensureClientSite", new Error("x"));
    ctx.store.failOnce("createOrLinkClient", new (await import("@/lib/integrations/sharepoint/errors")).BlockedError("Grant consent"));
    const run = await ctx.saga(ctx.manual, sp).execute(ctx.runId, "u-partner");
    const steps = normalizeSteps(run.steps);
    expect(steps[0]).toMatchObject({ status: "blocked", action: "Grant consent" });
    expect(steps.find((s) => s.key === "turia")).toMatchObject({ status: "pending", action: "Waits for: LMS client record" });
    expect(steps.find((s) => s.key === "assignment")).toMatchObject({ status: "pending", action: "Waits for: Engagements and jobs" });
    expect(run.status).toBe("BLOCKED");
  });
});

describe("onboarding saga — guards", () => {
  it("refuses unknown, unconfirmed and concurrently running runs; a stale RUNNING claim is taken over", async () => {
    const ctx = await setup();
    const saga = ctx.saga();
    await expect(saga.execute("nope", "u")).rejects.toMatchObject({ code: "not-found" });
    await ctx.store.update(ctx.runId, { status: "DRAFT" });
    await expect(saga.execute(ctx.runId, "u")).rejects.toMatchObject({ code: "not-confirmed" });
    await ctx.store.update(ctx.runId, { status: "RUNNING" });
    await expect(saga.execute(ctx.runId, "u")).rejects.toMatchObject({ code: "busy" });
    const later = createSaga({ store: ctx.store, turia: ctx.manual, sharepoint: ctx.sharepoint, now: () => new Date(NOW.getTime() + 3600_000) });
    expect((await later.execute(ctx.runId, "u")).status).toBe("DONE");
  });

  it("assignment fails when the assignee left the firm after planning", async () => {
    const ctx = await setup();
    ctx.store.people = ctx.store.people.filter((p) => p.id !== "u-priya");
    const run = await ctx.saga().execute(ctx.runId, "u-partner");
    expect(run.status).toBe("FAILED");
    expect(normalizeSteps(run.steps).find((s) => s.key === "assignment")!.error).toMatch(/no longer an active user/);
  });

  it("assignment fails loudly when a planned JobTask is missing", async () => {
    const ctx = await setup();
    const saga = ctx.saga();
    ctx.store.failOnce("ensureJobTasks", new Error("x"));
    await saga.execute(ctx.runId, "u-partner");
    // Pretend the jobs step was marked done without rows (corrupt state): assignment must not guess.
    const r = ctx.store.runs.get(ctx.runId)!;
    r.steps = normalizeSteps(r.steps).map((s) => (s.key === "jobs" ? { ...s, status: "done" } : s));
    const run = await saga.resume(ctx.runId, "u-partner");
    expect(normalizeSteps(run.steps).find((s) => s.key === "assignment")!.error).toMatch(/is missing; resume/);
  });

  it("normalizeSteps fills missing steps in order", () => {
    expect(normalizeSteps(null).map((s) => s.key)).toEqual([...STEP_KEYS]);
    expect(normalizeSteps([{ key: "jobs", label: "x", status: "done" }]).find((s) => s.key === "jobs")!.status).toBe("done");
  });
});
