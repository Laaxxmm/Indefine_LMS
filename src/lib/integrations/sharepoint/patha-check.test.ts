import { describe, it, expect } from "vitest";
import { createClFolders } from "./clfolders";
import { readSharePointConfig } from "./config";
import { BlockedError, GraphError } from "./errors";
import { createSharePointClient } from "./graph-client";
import {
  PARTNERS_GROUP_ID, STAFF_GROUP_ID, discoverClientCodes, errorRow, exitCodeFor, formatGapTable, parsePathAArgs,
  preflightBlocked, runPathACheck, type CheckRow,
} from "./patha-check";
import { FakeSharePoint } from "../../../../tests/fakes/fake-sharepoint";

const FULL_ENV = { SP_PNP_CERT_KEY_PEM: "k", SP_PNP_CERT_THUMBPRINT: "8ED1DCE79AD893C70D19A48E77C202AE8FC574D3", SP_SITE_OWNER: "p@srca.in" };

function world(env: Record<string, string> = FULL_ENV) {
  const fake = new FakeSharePoint();
  fake.addHub();
  fake.addEntraGroup(PARTNERS_GROUP_ID, "Partners");
  fake.addEntraGroup(STAFF_GROUP_ID, "Staff");
  const config = readSharePointConfig(env);
  const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "g", sharePointToken: async () => "s", sleep: async () => {} });
  const cl = createClFolders({ client, config: readSharePointConfig(FULL_ENV), sleep: async () => {} });
  return { fake, config, client, cl };
}

async function provision(cl: ReturnType<typeof world>["cl"], code: string) {
  await cl.ensureClientSite(code);
  await cl.ensureFyTree(code, "2026-27", { services: undefined, periods: { GST: ["2026-10"], Books: ["2026-10"], TDS: ["Q2"] } });
  await cl.ensureClientLists(code);
  await cl.ensureClientUploadGroup(code);
}

const statuses = (rows: CheckRow[]) => rows.map((r) => `${r.scope} | ${r.check} | ${r.status}`);

describe("runPathACheck", () => {
  it("a fully provisioned tenant has no gaps (exit 0) and the check writes nothing", async () => {
    const { fake, config, client, cl } = world();
    await provision(cl, "ACME01");
    const mutations = fake.mutations.length;
    const rows = await runPathACheck({ client, config, codes: ["ACME01"], fys: ["2026-27"] });
    expect(rows.every((r) => r.status === "OK")).toBe(true);
    expect(statuses(rows)).toEqual([
      "Hub | Hub site exists | OK",
      "Hub | Registered as hub site | OK",
      "Entra | Partners group | OK",
      "Entra | Staff group | OK",
      "CL-ACME01 | Site exists | OK",
      "CL-ACME01 | Joined to hub | OK",
      "CL-ACME01 | Compliance library | OK",
      "CL-ACME01 | FY tree FY2026-27 | OK",
      "CL-ACME01 | ClientObligations list | OK",
      "CL-ACME01 | ClientRequests list | OK",
      "CL-ACME01 | Client Upload group | OK",
    ]);
    expect(exitCodeFor(rows)).toBe(0);
    expect(fake.mutations.length).toBe(mutations);
    expect(fake.violations).toEqual([]);
  });

  it("reports each gap with the ensure-* call that fixes it (exit 1)", async () => {
    const { fake, config, client } = world();
    const site = fake.addSite("/sites/CL-HALF"); // not joined to hub, no lists, no group
    const lib = fake.addLibrary(site, "Compliance");
    fake.addFolder(lib, "FY2026-27/GST/2026-10/Working");
    fake.addFolder(lib, "FY2026-27/GST/Notes"); // non-period folder is ignored
    const rows = await runPathACheck({ client, config, codes: ["HALF", "NOSITE"], fys: ["FY2026-27", "FY2025-26"] });
    const byCheck = Object.fromEntries(rows.map((r) => [`${r.scope}/${r.check}`, r]));
    expect(byCheck["CL-HALF/Joined to hub"].status).toBe("GAP");
    expect(byCheck["CL-HALF/FY tree FY2026-27"].detail).toMatch(/^8 missing: FY2026-27\/GST\/2026-10\/Final, FY2026-27\/GST\/2026-10\/ClientDocs, FY2026-27\/ROC, FY2026-27\/IncomeTax, FY2026-27\/TDS … \(\+3 more\)/);
    expect(byCheck["CL-HALF/FY tree FY2025-26"].detail).toBe('1 missing: FY2025-26 — ensureFyTree("HALF", "FY2025-26")');
    expect(byCheck["CL-HALF/ClientObligations list"].detail).toBe('ensureClientLists("HALF")');
    expect(byCheck["CL-HALF/Client Upload group"].detail).toBe('ensureClientUploadGroup("HALF")');
    expect(byCheck["CL-NOSITE/Site exists"]).toMatchObject({ status: "GAP", detail: expect.stringContaining('ensureClientSite("NOSITE")') });
    expect(rows.filter((r) => r.scope === "CL-NOSITE")).toHaveLength(1);
    expect(exitCodeFor(rows)).toBe(1);
  });

  it("flags a missing library, missing hub, unregistered hub and missing groups", async () => {
    const fake = new FakeSharePoint();
    fake.addSite("/sites/CL-BARE");
    const client = createSharePointClient({ fetch: fake.fetch, graphToken: async () => "g", sharePointToken: async () => "s" });
    const rows = await runPathACheck({ client, config: readSharePointConfig(FULL_ENV), codes: ["BARE"], fys: ["2026-27"] });
    const s = statuses(rows);
    expect(s).toContain("Hub | Hub site exists | GAP");
    expect(s).toContain("Hub | Registered as hub site | GAP");
    expect(s).toContain("Entra | Partners group | GAP");
    expect(s).toContain("CL-BARE | Joined to hub | GAP");
    expect(s).toContain("CL-BARE | Compliance library | GAP");
    expect(rows.find((r) => r.check === "FY tree FY2026-27")?.detail).toMatch(/Library missing/);
  });

  it("uses HubSiteId when present and accepts custom group ids", async () => {
    const { fake, config, client } = world();
    const hub = fake.site("/sites/Indefine-Compliance")!;
    fake.addSite("/sites/CL-JOIN", { hubSiteId: hub.id });
    fake.addEntraGroup("custom", "Custom");
    const rows = await runPathACheck({ client, config, codes: ["JOIN"], fys: ["2026-27"], partnersGroupId: "custom", staffGroupId: "custom" });
    expect(rows.find((r) => r.check === "Joined to hub")?.status).toBe("OK");
    expect(rows.find((r) => r.check === "Registered as hub site")?.detail).toBe(hub.id);
  });

  it("rows that need SharePoint REST are BLOCKED without the PnP certificate (exit 2, never a pass)", async () => {
    const { config, client, cl, fake } = world({} as Record<string, string>);
    await provision(cl, "ACME01");
    expect(fake.mutations.length).toBeGreaterThan(0);
    const rows = await runPathACheck({ client, config, codes: ["ACME01"], fys: ["2026-27"] });
    const blocked = rows.filter((r) => r.status === "BLOCKED").map((r) => `${r.scope}/${r.check}`);
    expect(blocked).toEqual(["Hub/Registered as hub site", "CL-ACME01/Joined to hub", "CL-ACME01/Client Upload group"]);
    expect(rows.find((r) => r.status === "BLOCKED")?.detail).toMatch(/381abf0e-e427-417f-9b45-651e8ca823ec/);
    expect(exitCodeFor(rows)).toBe(2);
  });

  it("maps consent failures to BLOCKED and other failures to ERROR", async () => {
    const forbidden = createSharePointClient({ fetch: async () => new Response("{}", { status: 403 }), graphToken: async () => "g", sharePointToken: async () => "s" });
    const rows = await runPathACheck({ client: forbidden, config: readSharePointConfig(FULL_ENV), codes: ["ACME"], fys: ["2026-27"] });
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(["BLOCKED"]));
    expect(rows[0].detail).toMatch(/admin consent/);

    const broken = createSharePointClient({ fetch: async () => new Response("boom", { status: 400 }), graphToken: async () => "g", sharePointToken: async () => "s" });
    const r2 = await runPathACheck({ client: broken, config: readSharePointConfig(FULL_ENV), codes: [], fys: ["2026-27"] });
    expect(r2[0].status).toBe("ERROR");
    expect(r2.at(-1)).toMatchObject({ scope: "CL- sites", status: "GAP" });
    expect(exitCodeFor(r2)).toBe(2);
  });

  it("rejects malformed client codes as a gap without calling Graph for them", async () => {
    const { config, client } = world();
    const rows = await runPathACheck({ client, config, codes: ["bad-code"], fys: ["2026-27"] });
    expect(rows.at(-1)).toMatchObject({ scope: "CL-bad-code", check: "Valid client code", status: "GAP" });
  });
});

describe("errorRow", () => {
  it("classifies errors", () => {
    expect(errorRow("s", "c", new BlockedError("do X")).status).toBe("BLOCKED");
    expect(errorRow("s", "c", new GraphError(401, "GET", "u", "")).status).toBe("BLOCKED");
    expect(errorRow("s", "c", new GraphError(500, "GET", "u", "x")).status).toBe("ERROR");
    expect(errorRow("s", "c", new Error("x".repeat(500))).detail).toHaveLength(200);
  });
});

describe("discoverClientCodes", () => {
  it("keeps valid CL- sites on the tenant host only", () => {
    const sites = [
      { id: "1", webUrl: "https://srcaassociate.sharepoint.com/sites/CL-ACME01" },
      { id: "2", webUrl: "https://srcaassociate.sharepoint.com/sites/CL-ACME01/" },
      { id: "3", webUrl: "https://srcaassociate.sharepoint.com/sites/CL-bad" },
      { id: "4", webUrl: "https://srcaassociate.sharepoint.com/sites/Indefine-Compliance" },
      { id: "5", webUrl: "https://other.sharepoint.com/sites/CL-ZED" },
      { id: "6", webUrl: "https://srcaassociate.sharepoint.com/sites/CL-ABC/sub" },
      { id: "7", webUrl: "not a url" },
      { id: "8", webUrl: "https://SRCAASSOCIATE.sharepoint.com/sites/CL-BETA" },
    ];
    expect(discoverClientCodes(sites, "srcaassociate.sharepoint.com")).toEqual(["ACME01", "BETA"]);
  });
});

describe("exitCodeFor / formatGapTable", () => {
  const r = (status: CheckRow["status"]): CheckRow => ({ scope: "s", check: "c", status, detail: "" });
  it("exit codes", () => {
    expect(exitCodeFor([])).toBe(2);
    expect(exitCodeFor([r("OK")])).toBe(0);
    expect(exitCodeFor([r("OK"), r("GAP")])).toBe(1);
    expect(exitCodeFor([r("GAP"), r("BLOCKED")])).toBe(2);
    expect(exitCodeFor([r("ERROR")])).toBe(2);
  });
  it("renders a markdown table and escapes pipes/newlines", () => {
    const md = formatGapTable([{ scope: "CL-A", check: "x|y", status: "GAP", detail: "line1\nline2" }, r("OK")], { generatedAt: "Thu, 05 Nov 2026", fys: ["FY2026-27"] });
    expect(md).toBe(
      [
        "## Path A gap check — Thu, 05 Nov 2026",
        "",
        "FY checked: FY2026-27 · OK 1 · GAP 1 · BLOCKED 0 · ERROR 0 · exit 1",
        "",
        "| Scope | Check | Status | Detail / fix |",
        "|---|---|---|---|",
        "| CL-A | x\\|y | GAP | line1 line2 |",
        "| s | c | OK |  |",
        "",
      ].join("\n"),
    );
    expect(formatGapTable([], { generatedAt: "t", fys: [] })).toContain("FY checked: – ·");
  });
});

describe("parsePathAArgs / preflightBlocked", () => {
  it("parses flags", () => {
    expect(parsePathAArgs([])).toEqual({ out: null, codes: null, fys: [], help: false });
    expect(parsePathAArgs(["--out", "g.md", "--codes", "ACME, FOO,", "--fy", "2026-27,2025-26", "--fy", "2024-25", "-h"])).toEqual({
      out: "g.md", codes: ["ACME", "FOO"], fys: ["2026-27", "2025-26", "2024-25"], help: true,
    });
    expect(parsePathAArgs(["--out"]).out).toBeNull();
    expect(parsePathAArgs(["--codes"]).codes).toEqual([]);
    expect(parsePathAArgs(["--help"]).help).toBe(true);
    expect(() => parsePathAArgs(["--delete"])).toThrow(/Unknown argument/);
  });

  it("blocks when Graph credentials are absent, adding the PnP action when that is missing too", () => {
    const none = preflightBlocked({}, readSharePointConfig({}));
    expect(none).toHaveLength(2);
    expect(none[0]).toMatch(/MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET/);
    expect(none[1]).toMatch(/SP_PNP_CERT_KEY_PEM/);
    expect(preflightBlocked({}, readSharePointConfig(FULL_ENV))).toHaveLength(1);
    expect(preflightBlocked({ MS_TENANT_ID: "t", MS_CLIENT_ID: "c", MS_CLIENT_SECRET: "s" }, readSharePointConfig({}))).toEqual([]);
  });
});
