// Chaos: Microsoft Graph throttling (429 + Retry-After) and outages (5xx) under the real Path A
// graph-client, clfolders and onboarding saga, over the in-memory fake SharePoint.
// What a person sees: the CL- site and FY tree come out complete and identical to an untroubled
// run; an outage longer than the retry budget stops the onboarding at "SharePoint site and FY
// folders" with the Graph status in the message (a typed GraphError underneath); Retry resumes and
// nothing is created twice; an upload is never overwritten.
import { describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { createClFolders } from "@/lib/integrations/sharepoint/clfolders";
import { readSharePointConfig } from "@/lib/integrations/sharepoint/config";
import { createDeliverableStore } from "@/lib/integrations/sharepoint/deliverable-store";
import { ConflictError, GraphError } from "@/lib/integrations/sharepoint/errors";
import { createSharePointClient, type FetchLike } from "@/lib/integrations/sharepoint/graph-client";
import { normalizeSteps } from "@/lib/agents/onboarding/saga";
import { FakeSharePoint } from "../fakes/fake-sharepoint";
import { chaosFetch, is, loseResponse, networkDown, respond, times, type FaultRule } from "./support/chaos-fetch";
import { CONFIGURED_ENV, NOW, expectCompleteNoDuplicates, onboardingWorld } from "./support/onboarding-world";

const FY = "2026-27";
const TREE = { services: ["GST" as const], periods: { GST: ["2026-10" as const, "2026-11" as const] } };

/** clfolders over the fake, optionally through a fault-injecting transport. */
function pathA(rules: FaultRule[] = [], opts: { maxRetries?: number } = {}) {
  const fake = new FakeSharePoint();
  fake.addHub();
  const chaos = chaosFetch(fake.fetch, rules);
  const sleeps: number[] = [];
  const client = createSharePointClient({
    fetch: chaos.fetch,
    graphToken: async () => "g",
    sharePointToken: async () => "s",
    sleep: async (ms) => void sleeps.push(ms),
    now: () => NOW.getTime(),
    maxRetries: opts.maxRetries,
  });
  const cl = createClFolders({ client, config: readSharePointConfig(CONFIGURED_ENV), sleep: async () => {}, pollMs: 1, maxPolls: 2 });
  return { fake, chaos, client, cl, sleeps };
}

async function provision(w: ReturnType<typeof pathA>) {
  const site = await w.cl.ensureClientSite("ACME01");
  const tree = await w.cl.ensureFyTree("ACME01", FY, TREE);
  return { site, tree };
}

/** The tree an untroubled run produces (the reference for "complete and identical"). */
async function cleanSnapshot() {
  const w = pathA();
  await provision(w);
  return { snapshot: w.fake.snapshot(), posts: w.fake.mutations.length };
}

describe("Graph 429 with Retry-After", () => {
  it("waits exactly what Graph asked (seconds form), then completes the site and FY tree as if nothing happened", async () => {
    const clean = await cleanSnapshot();
    const w = pathA([{ match: is.graphRead, faults: times(3, respond(429, { "Retry-After": "7" })) }]);
    const out = await provision(w);
    expect(w.sleeps).toEqual([7000, 7000, 7000]); // one wait per throttled attempt, as Graph asked
    expect(w.chaos.faulted()).toHaveLength(3);
    expect(w.fake.snapshot()).toEqual(clean.snapshot); // the same site, hub link, library and folders
    expect(w.fake.mutations).toHaveLength(clean.posts); // throttled requests never reached the service: no extra writes
    expect(out.tree.created).toContain("folder Compliance/FY2026-27/GST/2026-10/Final");
    expect(w.fake.violations).toEqual([]);
  });

  it("honours the HTTP-date form of Retry-After and caps any single wait at 30 s (no unbounded hang)", async () => {
    const in5s = new Date(NOW.getTime() + 5000).toUTCString();
    const w = pathA([
      { match: is.graphRead, faults: [respond(429, { "Retry-After": in5s }), respond(429, { "Retry-After": "3600" })] },
    ]);
    await provision(w);
    expect(w.sleeps).toEqual([5000, 30_000]);
  });

  it("a throttled folder create is retried and the folder is created once", async () => {
    const w = pathA([{ match: is.folderCreate, skip: 4, faults: times(2, respond(429, { "Retry-After": "1" })) }]);
    const { tree } = await provision(w);
    expect(w.sleeps).toEqual([1000, 1000]);
    expect(new Set(tree.created).size).toBe(tree.created.length); // each folder reported created once
    const drive = w.fake.drive(w.fake.site("/sites/CL-ACME01")!, "Compliance")!;
    expect([...drive.items.keys()].filter((k) => k.startsWith("FY2026-27/GST/2026-10/"))).toHaveLength(3);
  });
});

describe("Graph 5xx", () => {
  it("transient 503s and a dropped connection are retried with exponential backoff and the tree completes", async () => {
    const clean = await cleanSnapshot();
    const w = pathA([
      { match: is.folderCreate, skip: 2, faults: [respond(503), respond(502), networkDown()] },
    ]);
    await provision(w);
    expect(w.sleeps).toEqual([500, 1000, 2000]); // 500 ms doubling, no Retry-After given
    expect(w.fake.snapshot()).toEqual(clean.snapshot);
  });

  it("an outage longer than the retry budget surfaces a typed GraphError with the status; a later run finishes without re-creating anything", async () => {
    const clean = await cleanSnapshot();
    const w = pathA([{ match: is.folderCreate, skip: 5, faults: times(5, respond(503)) }]); // maxRetries 4 → 5 attempts, all 503
    await w.cl.ensureClientSite("ACME01");
    const err = await w.cl.ensureFyTree("ACME01", FY, TREE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GraphError);
    expect((err as GraphError).status).toBe(503);
    expect((err as GraphError).message).toMatch(/POST .*children failed: 503/);
    const createdBeforeOutage = w.fake.mutations.length;

    // Outage over: the same ensure call completes; only what was missing is created.
    const second = await w.cl.ensureFyTree("ACME01", FY, TREE);
    expect(w.fake.snapshot()).toEqual(clean.snapshot);
    expect(w.fake.mutations).toHaveLength(clean.posts); // first run's writes + second run's writes = one clean run
    expect(second.created.length).toBe(clean.posts - createdBeforeOutage);

    // And a third run is a pure read.
    const before = w.fake.mutations.length;
    expect((await w.cl.ensureFyTree("ACME01", FY, TREE)).created).toEqual([]);
    expect(w.fake.mutations.length).toBe(before);
  });

  it("a create whose 201 is lost (the write landed, the caller saw 503) is adopted on retry via 409 — one folder, one library", async () => {
    const clean = await cleanSnapshot();
    const w = pathA([
      { match: is.listCreate, faults: [loseResponse(503)] }, // the Compliance library
      { match: is.folderCreate, skip: 3, faults: [loseResponse(503)] }, // one FY folder
    ]);
    const { tree } = await provision(w);
    expect(w.chaos.faulted().map((f) => f.fault)).toEqual(["lose-response", "lose-response"]);
    expect(w.fake.snapshot()).toEqual(clean.snapshot);
    const site = w.fake.site("/sites/CL-ACME01")!;
    expect([...site.drives.values()].filter((d) => d.name === "Compliance")).toHaveLength(1);
    // The adopted folder exists but is reported as existing, not as created twice.
    expect(tree.created.length).toBeLessThan(clean.posts);
    expect(w.fake.violations).toEqual([]);
  });
});

describe("Graph trouble during uploads (create-only PUT)", () => {
  function store(rules: FaultRule[]) {
    const fake = new FakeSharePoint();
    const site = fake.addSite("/sites/CL-ACME01");
    const drive = fake.addLibrary(site, "Compliance");
    fake.addFolder(drive, "FY2026-27/GST/2026-10/Working");
    const chaos = chaosFetch(fake.fetch, rules);
    const sleeps: number[] = [];
    const client = createSharePointClient({ fetch: chaos.fetch as FetchLike, graphToken: async () => "g", sleep: async (ms) => void sleeps.push(ms), now: () => NOW.getTime() });
    return { fake, drive, client, sleeps, s: createDeliverableStore(client) };
  }
  const FOLDER = "FY2026-27/GST/2026-10/Working";
  const BYTES = Buffer.from("draft pack bytes");

  it("a throttled upload is retried after Retry-After and stored once", async () => {
    const t = store([{ match: is.upload, faults: [respond(429, { "Retry-After": "2" })] }]);
    const saved = await t.s.putNew(t.drive.id, FOLDER, "ACME01_GSTR-1-draft_2026-10_v1.xlsx", BYTES);
    expect(t.sleeps).toEqual([2000]);
    expect(saved.fileName).toBe("ACME01_GSTR-1-draft_2026-10_v1.xlsx");
    expect(t.fake.filesIn(t.drive, FOLDER)).toEqual(["ACME01_GSTR-1-draft_2026-10_v1.xlsx"]);
    expect(await t.s.verify(t.drive.id, FOLDER, saved.fileName, saved.sha256)).toBe(true);
  });

  it("a lost 201 on upload never overwrites: the retry sees 409 and the store moves to the next version; both copies are byte-identical", async () => {
    const t = store([{ match: is.upload, faults: [loseResponse(503)] }]);
    const saved = await t.s.putNew(t.drive.id, FOLDER, "ACME01_GSTR-1-draft_2026-10_v1.xlsx", BYTES);
    // Documented behaviour: the landed v1 stays (never replaced); the recorded file is v2 with the same bytes.
    expect(saved.version).toBe(2);
    expect(t.fake.filesIn(t.drive, FOLDER)).toEqual(["ACME01_GSTR-1-draft_2026-10_v1.xlsx", "ACME01_GSTR-1-draft_2026-10_v2.xlsx"]);
    expect(t.fake.fileContent(t.drive, `${FOLDER}/ACME01_GSTR-1-draft_2026-10_v1.xlsx`)).toEqual(BYTES);
    expect(await t.s.verify(t.drive.id, FOLDER, saved.fileName, saved.sha256)).toBe(true);
    expect(t.fake.violations).toEqual([]);
  });

  it("the raw client surfaces that 409 as a ConflictError (typed), never as success over an existing file", async () => {
    const t = store([{ match: is.upload, faults: [loseResponse(503)] }]);
    await expect(t.client.uploadFile(t.drive.id, `${FOLDER}/x_v1.xlsx`, BYTES, { conflict: "fail" })).rejects.toBeInstanceOf(ConflictError);
    expect(t.fake.fileContent(t.drive, `${FOLDER}/x_v1.xlsx`)).toEqual(BYTES);
  });
});

describe("onboarding saga under a Graph outage", () => {
  it("stops at the SharePoint step with the Graph status shown, keeps every other step, and Retry completes with nothing duplicated", async () => {
    const rules: FaultRule[] = [{ match: is.folderCreate, skip: 6, faults: times(5, respond(503)) }];
    let chaos: ReturnType<typeof chaosFetch> | undefined;
    const w = await onboardingWorld({ wrapFetch: (inner) => (chaos = chaosFetch(inner, rules)).fetch });

    const failed = await w.saga().execute(w.runId, "u-partner");
    expect(failed.status).toBe("FAILED");
    // Stored as a classification for IT (onboarding/run-errors.ts): method and status, never the site path.
    expect(failed.error).toBe("SharePoint site and FY folders failed: Microsoft 365: POST request failed: 503");
    const steps = normalizeSteps(failed.steps);
    expect(steps.find((s) => s.key === "sharepoint")).toMatchObject({ status: "failed", attempts: 1 });
    expect(await w.stepStatuses()).toMatchObject({ lmsClient: "done", turia: "waiting", jobs: "pending", assignment: "pending" });
    expect(w.sleeps).toEqual([500, 1000, 2000, 4000]); // bounded backoff, then the error
    expect(chaos?.faulted()).toHaveLength(5);

    // Outage over. "Retry" resumes from the first step that is not done.
    const resumed = await w.saga().resume(w.runId, "u-partner");
    expect(resumed.status).toBe("DONE");
    expect(normalizeSteps(resumed.steps).find((s) => s.key === "sharepoint")).toMatchObject({ status: "done", attempts: 2 });
    expectCompleteNoDuplicates(w);
  });
});
