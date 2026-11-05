import { describe, it, expect, vi } from "vitest";
import { createSharePointClient, isRetryable, parseRetryAfter, type ClientOptions } from "./graph-client";
import { BlockedError, GraphError } from "./errors";
import { FakeSharePoint } from "../../../../tests/fakes/fake-sharepoint";

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers });

function setup(over: Partial<ClientOptions> = {}) {
  const fake = new FakeSharePoint();
  const sleeps: number[] = [];
  const client = createSharePointClient({
    fetch: fake.fetch,
    graphToken: async () => "graph-token",
    sharePointToken: async (host) => `sp-token:${host}`,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => Date.parse("2026-11-05T10:00:00Z"),
    ...over,
  });
  return { fake, client, sleeps };
}

describe("parseRetryAfter / isRetryable", () => {
  const now = Date.parse("2026-11-05T10:00:00Z");
  it("parses seconds, fractional seconds and HTTP dates", () => {
    expect(parseRetryAfter("7", now)).toBe(7000);
    expect(parseRetryAfter(" 1.5 ", now)).toBe(1500);
    expect(parseRetryAfter("Thu, 05 Nov 2026 10:00:03 GMT", now)).toBe(3000);
    expect(parseRetryAfter("Thu, 05 Nov 2026 09:00:00 GMT", now)).toBe(0);
  });
  it("returns null when absent or unparseable", () => {
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
  });
  it("retries 429 and 5xx only", () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    expect(isRetryable(404)).toBe(false);
    expect(isRetryable(409)).toBe(false);
  });
});

describe("retry policy", () => {
  it("honours Retry-After on 429 then succeeds", async () => {
    const { fake, client, sleeps } = setup();
    fake.addSite("/sites/CL-ACME");
    fake.queued.push(() => res(429, {}, { "Retry-After": "2" }), () => res(503, {}, { "Retry-After": "Thu, 05 Nov 2026 10:00:01 GMT" }));
    const site = await client.getSiteByUrl("https://srcaassociate.sharepoint.com/sites/CL-ACME");
    expect(site?.webUrl).toBe("https://srcaassociate.sharepoint.com/sites/CL-ACME");
    expect(sleeps).toEqual([2000, 1000]);
    expect(fake.calls).toHaveLength(3);
  });

  it("backs off exponentially without Retry-After and caps the delay", async () => {
    const { fake, client, sleeps } = setup({ baseDelayMs: 100, maxDelayMs: 300, maxRetries: 3 });
    fake.addSite("/sites/CL-ACME");
    fake.queued.push(() => res(500), () => res(502), () => res(504, {}, { "Retry-After": "60" }));
    expect(await client.getSiteByUrl("https://srcaassociate.sharepoint.com/sites/CL-ACME")).not.toBeNull();
    expect(sleeps).toEqual([100, 200, 300]);
  });

  it("gives up after maxRetries and surfaces a GraphError (never a silent success)", async () => {
    const { fake, client, sleeps } = setup({ maxRetries: 2 });
    for (let i = 0; i < 3; i++) fake.queued.push(() => res(503, { error: "down" }));
    await expect(client.getSiteByUrl("https://srcaassociate.sharepoint.com/sites/CL-ACME")).rejects.toMatchObject({ name: "GraphError", status: 503 });
    expect(sleeps).toHaveLength(2);
    expect(fake.calls).toHaveLength(3);
  });

  it("retries transport failures, then rethrows", async () => {
    let n = 0;
    const flaky = vi.fn(async () => {
      n++;
      if (n < 2) throw new TypeError("fetch failed");
      return res(200, { id: "s1", webUrl: "u" });
    });
    const { client, sleeps } = setup({ fetch: flaky, baseDelayMs: 10 });
    expect(await client.getSiteByUrl("https://h/sites/X")).toEqual({ id: "s1", webUrl: "u" });
    expect(sleeps).toEqual([10]);

    const dead = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const c2 = setup({ fetch: dead, maxRetries: 1 }).client;
    await expect(c2.getSiteByUrl("https://h/sites/X")).rejects.toThrow("fetch failed");
    expect(dead).toHaveBeenCalledTimes(2);
  });

  it("uses real timers by default", async () => {
    vi.useFakeTimers();
    try {
      const { fake } = setup();
      fake.addSite("/sites/CL-ACME");
      fake.queued.push(() => res(429, {}, { "Retry-After": "1" }));
      const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "t" });
      const p = client.getSiteByUrl("https://srcaassociate.sharepoint.com/sites/CL-ACME");
      await vi.advanceTimersByTimeAsync(1000);
      expect(await p).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("auth", () => {
  it("throws BlockedError when the Graph token is unavailable", async () => {
    const { client } = setup({ graphToken: async () => null });
    await expect(client.getGroup("g")).rejects.toBeInstanceOf(BlockedError);
    await expect(client.getGroup("g")).rejects.toThrow(/MS_CLIENT_SECRET/);
  });

  it("throws BlockedError for SharePoint REST without a SharePoint token", async () => {
    const { client } = setup({ sharePointToken: undefined, sharePointBlockedAction: "Upload the PnP cert" });
    await expect(client.getSiteInfo("https://srcaassociate.sharepoint.com/sites/X")).rejects.toThrow("BLOCKED: Upload the PnP cert");
    const c2 = setup({ sharePointToken: undefined }).client;
    await expect(c2.getSiteInfo("https://srcaassociate.sharepoint.com/sites/X")).rejects.toThrow(/SP_PNP_CERT_KEY_PEM/);
  });

  it("sends bearer + JSON headers to Graph and nometadata headers to SharePoint REST", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fake = new FakeSharePoint();
    fake.addHub();
    const client = createSharePointClient({
      fetch: (url, init) => {
        seen.push({ url, headers: init.headers as Record<string, string> });
        return fake.fetch(url, init);
      },
      graphToken: async () => "G",
      sharePointToken: async (host) => `S@${host}`,
    });
    await client.getSiteByUrl("https://srcaassociate.sharepoint.com/sites/Indefine-Compliance");
    await client.getSiteInfo("https://srcaassociate.sharepoint.com/sites/Indefine-Compliance");
    expect(seen[0].headers).toMatchObject({ Authorization: "Bearer G", Accept: "application/json" });
    expect(seen[1].headers).toMatchObject({ Authorization: "Bearer S@srcaassociate.sharepoint.com", Accept: "application/json;odata=nometadata" });
  });

  it("defaults to the LMS app-only token (null when MS_* env is absent) and global fetch", async () => {
    vi.stubEnv("MS_TENANT_ID", "");
    vi.stubEnv("MS_CLIENT_ID", "");
    vi.stubEnv("MS_CLIENT_SECRET", "");
    const spy = vi.spyOn(globalThis, "fetch");
    const client = createSharePointClient();
    await expect(client.getGroup("g")).rejects.toBeInstanceOf(BlockedError);
    expect(spy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("default transport is global fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(res(200, { id: "g", displayName: "Partners" }));
    const client = createSharePointClient({ graphToken: async () => "t" });
    expect(await client.getGroup("g")).toEqual({ id: "g", displayName: "Partners" });
    expect(spy.mock.calls[0][0]).toBe("https://graph.microsoft.com/v1.0/groups/g?$select=id,displayName");
  });
});

describe("Graph reads", () => {
  it("site, group, drives, lists, items and children; 404 → null", async () => {
    const { fake, client } = setup();
    const s = fake.addSite("/sites/CL-ACME");
    const lib = fake.addLibrary(s, "Compliance");
    fake.addFolder(lib, "FY2026-27/GST");
    fake.addEntraGroup("p1", "Partners");

    expect(await client.getSiteByUrl("https://srcaassociate.sharepoint.com/sites/CL-NONE")).toBeNull();
    expect(await client.getSiteByUrl("https://srcaassociate.sharepoint.com/sites/CL-ACME/")).toMatchObject({ id: s.id });
    expect(await client.getGroup("p1")).toEqual({ id: "p1", displayName: "Partners" });
    expect(await client.getGroup("nope")).toBeNull();
    expect((await client.listDrives(s.id)).map((d) => d.name).sort()).toEqual(["Compliance", "Documents"]);
    expect(await client.getDriveByName(s.id, "Compliance")).toMatchObject({ id: lib.id });
    expect(await client.getDriveByName(s.id, "Missing")).toBeNull();
    expect(await client.getList(s.id, "compliance")).toMatchObject({ displayName: "Compliance" });
    expect(await client.getList(s.id, "ClientRequests")).toBeNull();
    expect(await client.getItemByPath(lib.id, "FY2026-27/GST")).toMatchObject({ name: "GST" });
    expect(await client.getItemByPath(lib.id, "")).toMatchObject({ name: "root" });
    expect(await client.getItemByPath(lib.id, "FY2026-27/TDS")).toBeNull();
    expect((await client.listChildren(lib.id, "")).map((c) => c.name)).toEqual(["FY2026-27"]);
    expect((await client.listChildren(lib.id, "FY2026-27")).map((c) => c.name)).toEqual(["GST"]);
    expect((await client.searchSites("CL-")).map((x) => x.name)).toEqual(["CL-ACME"]);
  });

  it("matches lists by internal name too", async () => {
    const { client } = setup({
      fetch: async () => res(200, { value: [{ id: "l1", displayName: "Client Obligations", name: "ClientObligations" }, { id: "l2", displayName: "X" }] }),
    });
    expect(await client.getList("s", "ClientObligations")).toMatchObject({ id: "l1" });
  });

  it("follows @odata.nextLink paging", async () => {
    const pages: Record<string, unknown> = {
      "https://graph.microsoft.com/v1.0/sites/s1/drives?$select=id,name,webUrl,driveType": { value: [{ id: "d1", name: "A" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next2" },
      "https://graph.microsoft.com/v1.0/next2": { value: [{ id: "d2", name: "B" }] },
    };
    const { client } = setup({ fetch: async (url) => res(200, pages[url]) });
    expect((await client.listDrives("s1")).map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("raises GraphError for non-404 failures on reads", async () => {
    const { client } = setup({ fetch: async () => res(403, { error: "accessDenied" }) });
    await expect(client.getItemByPath("d", "x")).rejects.toMatchObject({ name: "GraphError", status: 403 });
    await expect(client.listDrives("s")).rejects.toBeInstanceOf(GraphError);
  });

  it("treats an empty success body as {}", async () => {
    const { client } = setup({ fetch: async () => new Response(null, { status: 204 }) });
    await expect(client.joinHubSite("https://h.sharepoint.com/sites/X", "hub")).resolves.toBeUndefined();
  });
});

describe("Graph creates", () => {
  it("createFolder creates once; a second call returns the existing folder (409)", async () => {
    const { fake, client } = setup();
    const s = fake.addSite("/sites/CL-ACME");
    const lib = fake.addLibrary(s, "Compliance");
    const a = await client.createFolder(lib.id, "", "FY2026-27");
    expect(a.created).toBe(true);
    const b = await client.createFolder(lib.id, "", "FY2026-27");
    expect(b).toEqual({ item: expect.objectContaining({ id: a.item.id, name: "FY2026-27" }), created: false });
    const c = await client.createFolder(lib.id, "FY2026-27", "GST");
    expect(c.created).toBe(true);
    expect(lib.items.has("FY2026-27/GST")).toBe(true);
  });

  it("createFolder surfaces errors (missing parent, 409 that cannot be resolved)", async () => {
    const { fake, client } = setup();
    const s = fake.addSite("/sites/CL-ACME");
    const lib = fake.addLibrary(s, "Compliance");
    await expect(client.createFolder(lib.id, "Nope", "GST")).rejects.toMatchObject({ status: 404 });
    const weird = setup({ fetch: async (url, init) => (init.method === "POST" ? res(409, {}) : res(404, {})) }).client;
    await expect(weird.createFolder("d", "a", "b")).rejects.toMatchObject({ status: 409 });
  });

  it("createList creates libraries and lists; duplicates resolve to the existing list", async () => {
    const { fake, client } = setup();
    const s = fake.addSite("/sites/CL-ACME");
    const lib = await client.createList(s.id, { displayName: "Compliance", template: "documentLibrary" });
    expect(lib.created).toBe(true);
    expect(fake.drive(s, "Compliance")).toBeDefined();
    const again = await client.createList(s.id, { displayName: "Compliance", template: "documentLibrary" });
    expect(again).toEqual({ list: expect.objectContaining({ displayName: "Compliance" }), created: false });
    const gl = await client.createList(s.id, { displayName: "ClientRequests", template: "genericList", columns: [{ name: "Period", text: {} }] });
    expect(gl.created).toBe(true);
    expect([...s.lists.values()].find((l) => l.displayName === "ClientRequests")?.columns).toEqual([{ name: "Period", text: {} }]);
    const weird = setup({ fetch: async (url, init) => (init.method === "POST" ? res(409, {}) : res(200, { value: [] })) }).client;
    await expect(weird.createList("s", { displayName: "X", template: "genericList" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("SharePoint REST", () => {
  it("creates a communication site, reads status, site info, joins hub, manages site groups", async () => {
    const { fake, client } = setup();
    const hub = fake.addHub();
    const url = "https://srcaassociate.sharepoint.com/sites/CL-ACME";
    const st = await client.createCommunicationSite("srcaassociate.sharepoint.com", { Title: "CL-ACME", Url: url, Owner: "admin@x" });
    expect(st.SiteStatus).toBe(2);
    expect((await client.getSiteCreationStatus("srcaassociate.sharepoint.com", url)).SiteStatus).toBe(2);
    expect(await client.getSiteInfo(url)).toMatchObject({ IsHubSite: false, HubSiteId: "00000000-0000-0000-0000-000000000000" });
    expect(await client.getSiteInfo("https://srcaassociate.sharepoint.com/sites/NOPE")).toBeNull();
    await client.joinHubSite(url, hub.id);
    expect((await client.getSiteInfo(url))?.HubSiteId).toBe(hub.id);
    expect(await client.getSiteGroup(url, "Client Upload")).toBeNull();
    expect(await client.createSiteGroup(url, "Client Upload", "d")).toMatchObject({ Title: "Client Upload" });
    expect(await client.getSiteGroup(url, "Client Upload")).toMatchObject({ Title: "Client Upload" });
    const body = fake.calls.find((c) => c.url.endsWith("/_api/SPSiteManager/create"));
    expect(body).toBeDefined();
  });

  it("sends the communication-site template and escapes quotes in REST literals", async () => {
    const seen: Array<{ url: string; body?: string }> = [];
    const { client } = setup({
      fetch: async (url, init) => {
        seen.push({ url, body: init.body as string | undefined });
        return res(200, { SiteStatus: 2, Id: 1, Title: "t" });
      },
    });
    await client.createCommunicationSite("h.sharepoint.com", { Title: "T", Url: "https://h.sharepoint.com/sites/CL-X", Owner: "o", Description: "d", Lcid: 1081 });
    expect(JSON.parse(seen[0].body!).request).toEqual({
      Title: "T", Url: "https://h.sharepoint.com/sites/CL-X", Owner: "o", Description: "d", Lcid: 1081, WebTemplate: "SITEPAGEPUBLISHING#0", ShareByEmailEnabled: false,
    });
    await client.getSiteGroup("https://h.sharepoint.com/sites/CL-X", "O'Brien");
    expect(seen[1].url).toContain("getbyname('O''Brien')");
  });
});

describe("no destructive surface", () => {
  it("exposes no delete / move / rename / update method", () => {
    const { client } = setup();
    const names = Object.keys(client);
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(n).not.toMatch(/delete|remove|move|rename|update|patch|recycle|purge|put/i);
  });

  it("only ever issues GET or POST", async () => {
    const { fake, client } = setup();
    const s = fake.addSite("/sites/CL-ACME");
    fake.addHub();
    await client.createList(s.id, { displayName: "Compliance", template: "documentLibrary" });
    const lib = fake.drive(s, "Compliance")!;
    await client.createFolder(lib.id, "", "FY2026-27");
    await client.listChildren(lib.id, "FY2026-27");
    await client.createSiteGroup("https://srcaassociate.sharepoint.com/sites/CL-ACME", "Client Upload", "d");
    expect(new Set(fake.calls.map((c) => c.method))).toEqual(new Set(["GET", "POST"]));
    expect(fake.violations).toEqual([]);
  });
});
