// Integration: clfolders + the real graph-client against an in-memory fake SharePoint.
import { describe, it, expect, vi } from "vitest";
import { createClFolders, defaultClFolders, ensureClientLists, ensureClientSite, ensureClientUploadGroup, ensureFyTree, fyTreePlan } from "./clfolders";
import { readSharePointConfig, type SharePointConfig } from "./config";
import { BlockedError, NotProvisionedError } from "./errors";
import { createSharePointClient } from "./graph-client";
import { KINDS, PathError, SERVICES } from "./paths";
import { FakeSharePoint } from "../../../../tests/fakes/fake-sharepoint";

const CONFIGURED_ENV = { SP_PNP_CERT_KEY_PEM: "k", SP_PNP_CERT_THUMBPRINT: "8ED1DCE79AD893C70D19A48E77C202AE8FC574D3", SP_SITE_OWNER: "partner@srca.in" };

function setup(opts: { config?: SharePointConfig; hub?: "hub" | "plain" | "none"; provisionPolls?: number; maxPolls?: number } = {}) {
  const fake = new FakeSharePoint();
  if (opts.hub === "plain") fake.addSite("/sites/Indefine-Compliance");
  else if (opts.hub !== "none") fake.addHub();
  fake.provisionPolls = opts.provisionPolls ?? 0;
  const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "g", sharePointToken: async () => "s", sleep: async () => {} });
  const sleeps: number[] = [];
  const cl = createClFolders({
    client,
    config: opts.config ?? readSharePointConfig(CONFIGURED_ENV),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    pollMs: 10,
    maxPolls: opts.maxPolls ?? 3,
  });
  return { fake, cl, sleeps };
}

const FOLDERS_PER_FY = 1 + SERVICES.length + (12 + 12 + 4 + 4) * (1 + KINDS.length); // FY + services + periods×(period + kinds)

describe("fyTreePlan", () => {
  it("covers every service, default periods and kinds", () => {
    const plan = fyTreePlan("2026-27");
    expect(plan[0]).toEqual(["", ["FY2026-27"]]);
    expect(plan[1]).toEqual(["FY2026-27", [...SERVICES]]);
    expect(plan.find(([p]) => p === "FY2026-27/GST")?.[1]).toHaveLength(12);
    expect(plan.find(([p]) => p === "FY2026-27/TDS")?.[1]).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(plan.find(([p]) => p === "FY2026-27/Audit/Annual")?.[1]).toEqual([...KINDS]);
    expect(plan.reduce((n, [, names]) => n + names.length, 0)).toBe(FOLDERS_PER_FY);
  });

  it("honours chosen services/periods and validates them", () => {
    const plan = fyTreePlan("FY2026-27", { services: ["GST"], periods: { GST: ["2026-10"] } });
    expect(plan).toEqual([
      ["", ["FY2026-27"]],
      ["FY2026-27", ["GST"]],
      ["FY2026-27/GST", ["2026-10"]],
      ["FY2026-27/GST/2026-10", ["Working", "Final", "ClientDocs"]],
    ]);
    expect(() => fyTreePlan("FY2026-27", { services: ["GST"], periods: { GST: ["2027-04"] } })).toThrow(/outside FY2026-27/);
    expect(() => fyTreePlan("FY2026-27", { periods: { TDS: ["Q5" as never] } })).toThrow(PathError);
    expect(() => fyTreePlan("FY2026-27", { services: ["VAT" as never] })).toThrow(PathError);
  });
});

describe("ensureClientSite", () => {
  it("creates the site, joins the hub, and is a no-op the second time", async () => {
    const { fake, cl } = setup({ provisionPolls: 2 });
    const first = await cl.ensureClientSite("ACME01");
    expect(first.created).toEqual([
      "site CL-ACME01",
      "hub association CL-ACME01 → https://srcaassociate.sharepoint.com/sites/Indefine-Compliance",
    ]);
    const site = fake.site("/sites/CL-ACME01")!;
    expect(site.hubSiteId).toBe(fake.site("/sites/Indefine-Compliance")!.id);
    expect(first.siteId).toBe(site.id);

    const before = fake.snapshot();
    const mutationsBefore = fake.mutations.length;
    const second = await cl.ensureClientSite("ACME01");
    expect(second.created).toEqual([]);
    expect(second.siteId).toBe(first.siteId);
    expect(fake.snapshot()).toEqual(before);
    expect(fake.mutations.length).toBe(mutationsBefore);
    expect(fake.violations).toEqual([]);
  });

  it("joins the hub for an existing, unassociated site without recreating it", async () => {
    const { fake, cl } = setup();
    fake.addSite("/sites/CL-OLD1");
    const r = await cl.ensureClientSite("OLD1");
    expect(r.created).toEqual(["hub association CL-OLD1 → https://srcaassociate.sharepoint.com/sites/Indefine-Compliance"]);
    expect(fake.mutations.map((m) => m.url)).toEqual(["https://srcaassociate.sharepoint.com/sites/CL-OLD1/_api/site/JoinHubSite('site-1')"]);
  });

  it("is Blocked without the PnP certificate, before any call", async () => {
    const { fake, cl } = setup({ config: readSharePointConfig({}) });
    await expect(cl.ensureClientSite("ACME")).rejects.toBeInstanceOf(BlockedError);
    await expect(cl.ensureClientSite("ACME")).rejects.toThrow(/381abf0e-e427-417f-9b45-651e8ca823ec/);
    expect(fake.calls).toEqual([]);
  });

  it("is Blocked without a site owner when the site must be created", async () => {
    const { fake, cl } = setup({ config: readSharePointConfig({ ...CONFIGURED_ENV, SP_SITE_OWNER: "" }) });
    await expect(cl.ensureClientSite("ACME")).rejects.toThrow(/SP_SITE_OWNER/);
    expect(fake.mutations).toEqual([]);
  });

  it("is Blocked when the hub is missing or not registered as a hub", async () => {
    const none = setup({ hub: "none" });
    none.fake.addSite("/sites/CL-ACME");
    await expect(none.cl.ensureClientSite("ACME")).rejects.toThrow(/Create the hub site/);
    const plain = setup({ hub: "plain" });
    plain.fake.addSite("/sites/CL-ACME");
    await expect(plain.cl.ensureClientSite("ACME")).rejects.toThrow(/Register .* as a hub site/);
    expect(plain.fake.mutations).toEqual([]);
  });

  it("uses HubSiteId when the hub reports one", async () => {
    const { fake, cl } = setup({ hub: "none" });
    const hub = fake.addSite("/sites/Indefine-Compliance", { isHub: true });
    hub.hubSiteId = hub.id;
    fake.addSite("/sites/CL-ACME", { hubSiteId: hub.id });
    expect((await cl.ensureClientSite("ACME")).created).toEqual([]);
  });

  it("fails loudly when provisioning does not finish", async () => {
    const { cl, sleeps } = setup({ provisionPolls: 10, maxPolls: 2 });
    await expect(cl.ensureClientSite("SLOW")).rejects.toThrow(/did not finish \(SiteStatus 1\)/);
    expect(sleeps).toEqual([10, 10]);
  });

  it("fails when the new site never appears in Graph", async () => {
    const fake = new FakeSharePoint();
    fake.addHub();
    const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "g", sharePointToken: async () => "s" });
    const ghost = { ...client, getSiteByUrl: async () => null };
    const cl = createClFolders({ client: ghost, config: readSharePointConfig(CONFIGURED_ENV), sleep: async () => {}, maxPolls: 1 });
    await expect(cl.ensureClientSite("GHOST")).rejects.toBeInstanceOf(NotProvisionedError);
  });

  it("fails when SharePoint REST cannot see the site", async () => {
    const fake = new FakeSharePoint();
    fake.addHub();
    fake.addSite("/sites/CL-ACME");
    const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "g", sharePointToken: async () => "s" });
    const hubInfo = await client.getSiteInfo("https://srcaassociate.sharepoint.com/sites/Indefine-Compliance");
    const blind = { ...client, getSiteInfo: async (u: string) => (u.includes("Indefine") ? hubInfo : null) };
    const cl = createClFolders({ client: blind, config: readSharePointConfig(CONFIGURED_ENV) });
    await expect(cl.ensureClientSite("ACME")).rejects.toThrow(/not reachable through SharePoint REST/);
  });

  it("rejects invalid client codes before any call", async () => {
    const { fake, cl } = setup();
    await expect(cl.ensureClientSite("acme")).rejects.toBeInstanceOf(PathError);
    await expect(cl.ensureFyTree("A", "2026-27")).rejects.toBeInstanceOf(PathError);
    expect(fake.calls).toEqual([]);
  });
});

describe("ensureFyTree", () => {
  it("builds the full FY tree; running it twice yields identical state and creates nothing", async () => {
    const { fake, cl } = setup();
    await cl.ensureClientSite("ACME01");
    const first = await cl.ensureFyTree("ACME01", "2026-27");
    expect(first.created[0]).toBe("library Compliance");
    expect(first.created).toHaveLength(1 + FOLDERS_PER_FY);
    expect(first.folders).toBe(FOLDERS_PER_FY);
    const lib = fake.drive(fake.site("/sites/CL-ACME01")!, "Compliance")!;
    for (const p of ["FY2026-27/GST/2026-10/Final", "FY2026-27/GST/2027-03/ClientDocs", "FY2026-27/TDS/Q2/Working", "FY2026-27/Engagement/Annual/ClientDocs"]) {
      expect(lib.items.has(p)).toBe(true);
    }

    const snap = fake.snapshot();
    const mutations = fake.mutations.length;
    const second = await cl.ensureFyTree("ACME01", "FY2026-27");
    expect(second.created).toEqual([]);
    expect(second.folders).toBe(FOLDERS_PER_FY);
    expect(second.driveId).toBe(first.driveId);
    expect(fake.snapshot()).toEqual(snap);
    expect(fake.mutations.length).toBe(mutations);
    expect(fake.violations).toEqual([]);
  });

  it("fills only the gaps in a partial tree", async () => {
    const { fake, cl } = setup();
    const site = fake.addSite("/sites/CL-PART");
    const lib = fake.addLibrary(site, "Compliance");
    fake.addFolder(lib, "FY2026-27/GST/2026-10/Working");
    const r = await cl.ensureFyTree("PART", new Date("2026-11-05T10:00:00+05:30"), { services: ["GST"], periods: { GST: ["2026-10", "2026-11"] } });
    expect(r.created).toEqual([
      "folder Compliance/FY2026-27/GST/2026-11",
      "folder Compliance/FY2026-27/GST/2026-10/Final",
      "folder Compliance/FY2026-27/GST/2026-10/ClientDocs",
      "folder Compliance/FY2026-27/GST/2026-11/Working",
      "folder Compliance/FY2026-27/GST/2026-11/Final",
      "folder Compliance/FY2026-27/GST/2026-11/ClientDocs",
    ]);
  });

  it("a folder created concurrently (409) is not reported as created", async () => {
    const fake = new FakeSharePoint();
    const site = fake.addSite("/sites/CL-RACE");
    const lib = fake.addLibrary(site, "Compliance");
    const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "g", sharePointToken: async () => "s" });
    const racy = {
      ...client,
      listChildren: async () => [], // stale listing
    };
    fake.addFolder(lib, "FY2026-27");
    const cl = createClFolders({ client: racy, config: readSharePointConfig(CONFIGURED_ENV) });
    const r = await cl.ensureFyTree("RACE", "2026-27", { services: ["Audit"] });
    expect(r.created).not.toContain("folder Compliance/FY2026-27");
    expect(r.created).toContain("folder Compliance/FY2026-27/Audit");
  });

  it("requires the site to exist", async () => {
    const { cl } = setup();
    await expect(cl.ensureFyTree("NOPE", "2026-27")).rejects.toBeInstanceOf(NotProvisionedError);
  });

  it("fails if the library is created but no drive appears", async () => {
    const fake = new FakeSharePoint();
    fake.addSite("/sites/CL-ACME");
    const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "g", sharePointToken: async () => "s" });
    const noDrive = { ...client, getDriveByName: async () => null };
    const cl = createClFolders({ client: noDrive, config: readSharePointConfig(CONFIGURED_ENV) });
    await expect(cl.ensureFyTree("ACME", "2026-27")).rejects.toThrow(/has no drive yet/);
  });

  it("validates periods before any network call", async () => {
    const { fake, cl } = setup();
    await expect(cl.ensureFyTree("ACME", "2026-27", { periods: { GST: ["2026-13" as never] } })).rejects.toBeInstanceOf(PathError);
    expect(fake.calls).toEqual([]);
  });
});

describe("ensureClientLists / ensureClientUploadGroup", () => {
  it("create once, then no-op", async () => {
    const { fake, cl } = setup();
    await cl.ensureClientSite("ACME");
    expect((await cl.ensureClientLists("ACME")).created).toEqual(["list ClientObligations", "list ClientRequests"]);
    expect((await cl.ensureClientUploadGroup("ACME")).created).toEqual(["group Client Upload"]);
    const snap = fake.snapshot();
    const n = fake.mutations.length;
    expect((await cl.ensureClientLists("ACME")).created).toEqual([]);
    expect((await cl.ensureClientUploadGroup("ACME")).created).toEqual([]);
    expect(fake.snapshot()).toEqual(snap);
    expect(fake.mutations.length).toBe(n);
    const lists = [...fake.site("/sites/CL-ACME")!.lists.values()];
    expect(lists.find((l) => l.displayName === "ClientObligations")?.columns).toContainEqual({ name: "Status", choice: { choices: ["Open", "In progress", "Filed", "Closed"] } });
  });

  it("a list that appears concurrently is not reported as created", async () => {
    const fake = new FakeSharePoint();
    const site = fake.addSite("/sites/CL-ACME");
    const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "g", sharePointToken: async () => "s" });
    const stale = { ...client, getList: async () => null };
    site.lists.set("x", { id: "x", displayName: "ClientRequests", template: "genericList", columns: [] });
    const cl = createClFolders({ client: { ...stale, createList: async (id, def) => (def.displayName === "ClientRequests" ? { list: { id: "x", displayName: "ClientRequests" }, created: false } : client.createList(id, def)) }, config: readSharePointConfig(CONFIGURED_ENV) });
    expect((await cl.ensureClientLists("ACME")).created).toEqual(["list ClientObligations"]);
  });

  it("group creation is Blocked without the certificate", async () => {
    const { cl } = setup({ config: readSharePointConfig({}) });
    await expect(cl.ensureClientUploadGroup("ACME")).rejects.toBeInstanceOf(BlockedError);
  });
});

describe("default wiring (env)", () => {
  it("is Blocked with no credentials and never reaches the network", async () => {
    vi.stubEnv("SP_PNP_CERT_KEY_PEM", "");
    vi.stubEnv("SP_PNP_CERT_PEM", "");
    vi.stubEnv("SP_PNP_CERT_THUMBPRINT", "");
    vi.stubEnv("MS_TENANT_ID", "");
    vi.stubEnv("MS_CLIENT_ID", "");
    vi.stubEnv("MS_CLIENT_SECRET", "");
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(ensureClientSite("ACME")).rejects.toBeInstanceOf(BlockedError);
    await expect(ensureClientUploadGroup("ACME")).rejects.toBeInstanceOf(BlockedError);
    await expect(ensureFyTree("ACME", "2026-27")).rejects.toBeInstanceOf(BlockedError);
    await expect(ensureClientLists("ACME")).rejects.toBeInstanceOf(BlockedError);
    expect(defaultClFolders({}).ensureFyTree).toBeTypeOf("function");
    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
