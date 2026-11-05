// A confirmed onboarding run over in-memory infrastructure, for chaos tests: the real saga, the
// real ManualBridge (Turia) over an in-memory TuriaSync table, and the real Path A clfolders +
// graph-client over the fake SharePoint transport — with a hook to wrap that transport in faults.
// Same world as src/lib/agents/onboarding/saga.test.ts, so "no duplicates" means the same thing.
import { expect } from "vitest";
import { DEFAULT_CALENDAR } from "@/lib/agents/core";
import { PEOPLE, completeSpec } from "@/lib/agents/onboarding/__fixtures__/synthetic";
import { buildPlan, type OnboardingPlan } from "@/lib/agents/onboarding/plan";
import { createCalendarPlanner } from "@/lib/agents/onboarding/planner";
import { createSaga, initialSteps, normalizeSteps, type SagaSharePoint, type SagaStore } from "@/lib/agents/onboarding/saga";
import { createClFolders } from "@/lib/integrations/sharepoint/clfolders";
import { readSharePointConfig } from "@/lib/integrations/sharepoint/config";
import { createSharePointClient, type FetchLike } from "@/lib/integrations/sharepoint/graph-client";
import type { TuriaAdapter } from "@/lib/integrations/turia/adapter";
import { ManualBridge } from "@/lib/integrations/turia/manual-bridge";
import { MemoryOnboardingStore } from "../../fakes/fake-onboarding-store";
import { FakeSharePoint } from "../../fakes/fake-sharepoint";
import { FakeTuriaRepo } from "../../fakes/fake-turia-repo";

export const NOW = new Date("2026-11-05T10:00:00Z"); // Thu 15:30 IST
export const CONFIGURED_ENV = { SP_PNP_CERT_KEY_PEM: "k", SP_PNP_CERT_THUMBPRINT: "8ED1DCE79AD893C70D19A48E77C202AE8FC574D3", SP_SITE_OWNER: "partner@srca.in" };

export interface WorldOptions {
  /** Wrap the fake SharePoint transport (fault injection). */
  wrapFetch?: (inner: FetchLike) => FetchLike;
  /** Wrap the Turia repo the ManualBridge writes to. */
  repo?: FakeTuriaRepo;
}

export async function onboardingWorld(opts: WorldOptions = {}) {
  const store = new MemoryOnboardingStore(PEOPLE);
  const repo = opts.repo ?? new FakeTuriaRepo();
  const manual = new ManualBridge(repo, () => NOW);
  const fake = new FakeSharePoint();
  fake.addHub();
  const sleeps: number[] = [];
  const transport = opts.wrapFetch ? opts.wrapFetch(fake.fetch) : fake.fetch;
  const client = createSharePointClient({
    fetch: transport,
    graphToken: async () => "g",
    sharePointToken: async () => "s",
    sleep: async (ms) => void sleeps.push(ms),
    now: () => NOW.getTime(),
  });
  const cl = createClFolders({ client, config: readSharePointConfig(CONFIGURED_ENV), sleep: async () => {}, pollMs: 1, maxPolls: 2 });
  const sharepoint: SagaSharePoint = { ensureClientSite: (c) => cl.ensureClientSite(c), ensureFyTree: (c, fy, o) => cl.ensureFyTree(c, fy, o) };
  const spec = completeSpec();
  const jobs = await createCalendarPlanner({ loadPack: async () => ({ pack: DEFAULT_CALENDAR, source: "defaults" }) }).planJobs({
    entityType: spec.entityType,
    services: spec.services,
    fy: spec.fy,
    firstPeriod: spec.firstPeriod,
    gstStateCode: "29",
    qrmp: false,
  });
  const plan: OnboardingPlan = buildPlan(spec, {
    jobs,
    existingLmsClient: null,
    turiaMode: "MANUAL",
    checks: [],
    confirmRequired: true,
    plannerSource: "defaults",
    people: { assignee: { id: "u-priya", name: "Priya Sharma" }, reviewer: { id: "u-ravi", name: "Ravi Kumar" } },
    now: NOW,
  });
  const run = await store.create({ createdById: "u-partner", prompt: "Onboard Acme", spec });
  await store.update(run.id, { plan, status: "CONFIRMED", steps: initialSteps() });

  /** A saga "process": its own instance, clock and (optionally) wrapped store / Turia bridge. */
  const saga = (o: { turia?: TuriaAdapter; store?: SagaStore; sharepoint?: SagaSharePoint; now?: () => Date } = {}) =>
    createSaga({ store: o.store ?? store, turia: o.turia ?? manual, sharepoint: o.sharepoint ?? sharepoint, now: o.now ?? (() => NOW) });

  const stepStatuses = async () => Object.fromEntries(normalizeSteps((await store.get(run.id))!.steps).map((s) => [s.key, s.status]));
  const stored = async () => (await store.get(run.id))!;

  return { store, repo, manual, fake, client, cl, sharepoint, plan, runId: run.id, saga, sleeps, stepStatuses, stored };
}

export type OnboardingWorld = Awaited<ReturnType<typeof onboardingWorld>>;

/** Everything the plan promises exists exactly once — the "nothing duplicated" assertion. */
export function expectCompleteNoDuplicates(w: OnboardingWorld) {
  const { store, repo, plan, fake } = w;
  expect(store.clients).toHaveLength(1);
  expect(store.firmClients).toHaveLength(1);
  expect(store.firmClients[0]).toMatchObject({ clientCode: "ACME01", clSiteUrl: "https://srcaassociate.sharepoint.com/sites/CL-ACME01" });
  expect(store.engagements.map((e) => e.service)).toEqual(["GST", "ROC", "Books"]);
  expect(store.jobTasks).toHaveLength(plan.jobs.length);
  expect(new Set(store.jobTasks.map((t) => `${t.service}|${t.title}|${t.period}`)).size).toBe(plan.jobs.length);
  expect(store.events).toHaveLength(plan.jobs.length);
  const ops = repo.rows.map((r) => r.operation);
  expect(ops.filter((o) => o === "createClient")).toHaveLength(1);
  expect(ops.filter((o) => o === "addService")).toHaveLength(3);
  expect(ops.filter((o) => o === "createTask")).toHaveLength(plan.turia.tasksNow);
  expect(new Set(repo.rows.map((r) => r.evidence?.key)).size).toBe(repo.rows.length);
  expect(fake.violations).toEqual([]); // no DELETE / PATCH / overwrite ever reached SharePoint
}
