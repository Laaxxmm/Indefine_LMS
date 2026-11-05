// /clients/[id] under FIRM_OS_CL_PATHS: flag off = legacy render and no FirmClient / JobTask query;
// flag on + client code = CL-{Code} site and job folder links via paths.ts, and the client's Firm OS
// jobs (read-only, scoped as /agents is) from the in-memory Firm OS tables.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type MemoryDb } from "@/lib/agents/core/memory-db";
import { activeSession, prismaCalls, renderHtml } from "./harness";

const state = vi.hoisted(() => ({ firmCode: null as string | null, mem: null as unknown as MemoryDb }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("@/lib/prisma", async () => {
  const { prismaMock, prismaCalls: calls } = await import("./harness");
  const CLIENT = {
    id: "c1", name: "Acme Pvt Ltd", active: true, entityType: "PVT_LTD", pan: null, gstin: null, cin: null, industry: null, city: "Bengaluru",
    contactName: null, contactPhone: null, contactEmail: null, referralSource: null, turnover: 1_500_000, turnoverBand: "UNDER_40L",
    growthGoal: "MAINTAIN", growthNote: null, onboardedOn: new Date("2026-04-01T00:00:00+05:30"), primaryHandlerId: "u1",
    primaryHandler: { name: "Priya", email: "priya@indefine.test" }, graphFolderId: "legacy-folder-id", folderName: "Acme Pvt Ltd", folderStatus: "READY",
    documents: [],
    jobs: [
      { id: "j1", fy: "2026-27", handlerId: "u1", status: "IN_PROGRESS", dueOn: null, fees: null, notes: null, folderStatus: "READY", _count: { documents: 0 }, serviceType: { department: "TAX", name: "GST monthly/quarterly returns" } },
      { id: "j2", fy: "2026-27", handlerId: "u1", status: "NOT_STARTED", dueOn: null, fees: null, notes: null, folderStatus: "READY", _count: { documents: 0 }, serviceType: { department: "TECH", name: "Tally setup" } },
    ],
  };
  const record = (model: string, method: string, args: unknown) => calls.push({ model, method, args });
  const legacyUser = (prismaMock as Record<string, Record<string, (a: unknown) => Promise<unknown>>>).user;
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, key: string | symbol) => {
          if (key === "client") return { findUnique: async (args: unknown) => (record("client", "findUnique", args), CLIENT) };
          if (key === "firmClient") {
            return { findUnique: async (args: unknown) => (record("firmClient", "findUnique", args), state.firmCode ? { clientCode: state.firmCode } : null) };
          }
          // Firm OS tables: the in-memory db (real where / select / orderBy semantics).
          if (key === "jobTask") return { findMany: async (args: never) => (record("jobTask", "findMany", args), state.mem.jobTask.findMany(args)) };
          if (key === "user") {
            // Assignee names come from the memory db (`where: { id: { in } }`); the LMS handler list stays empty.
            return {
              findMany: async (args: { where?: { id?: { in?: string[] } } }) =>
                args?.where?.id?.in ? (record("user", "findMany", args), (state.mem as unknown as { user: { findMany(a: unknown): Promise<unknown> } }).user.findMany(args)) : legacyUser.findMany(args),
            };
          }
          return (prismaMock as Record<string | symbol, unknown>)[key];
        },
      },
    ),
  };
});

const { auth } = await import("@/lib/auth");
const { default: ClientPage } = await import("@/app/clients/[id]/page");
const render = async () => (await renderHtml(await ClientPage({ params: Promise.resolve({ id: "c1" }) }))).replace(/<!-- -->/g, "");
const as = (overrides: Parameters<typeof activeSession>[0]) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(activeSession(overrides));
const PORTAL_OR_SEND = />\s*(Submit to portal|Send[^<]*|File on portal)\s*</i;
const firmOsCalls = () => prismaCalls.filter((c) => c.model === "firmClient" || c.model === "jobTask");

function seedFirmOs() {
  const mem = createMemoryDb({ now: () => new Date("2026-11-05T06:30:00Z") });
  mem.seed("user", [
    { id: "u-priya", name: "Priya S", email: "priya@indefine.test" },
    { id: "u-ravi", name: "Ravi Kumar", email: "ravi@indefine.test" },
    { id: "u-anil", name: null, email: "anil@indefine.test" },
  ]);
  mem.seed("firmClient", [
    { id: "fc1", lmsClientId: "c1", clientCode: "ACME01" },
    { id: "fc2", lmsClientId: "c2", clientCode: "OTHER1" },
  ]);
  const ist = (d: string) => new Date(`${d}T00:00:00+05:30`);
  const base = { fy: "2026-27", reviewerId: "u-ravi", createdAt: new Date("2026-10-01T00:00:00Z") };
  mem.seed("jobTask", [
    { ...base, id: "jt-3b", firmClientId: "fc1", service: "GST", period: "2026-10", title: "GSTR-3B", state: "AGENT_DONE", assigneeId: "u-priya", internalDueOn: ist("2026-11-17") },
    { ...base, id: "jt-r1", firmClientId: "fc1", service: "GST", period: "2026-10", title: "GSTR-1", state: "ASSIGNED", assigneeId: "u-anil", reviewerId: "u-meera", internalDueOn: ist("2026-11-08") },
    { ...base, id: "jt-done", firmClientId: "fc1", service: "GST", period: "2026-09", title: "GSTR-3B", state: "DONE", assigneeId: "u-priya", internalDueOn: ist("2026-10-17") },
    { ...base, id: "jt-roc", firmClientId: "fc1", service: "ROC", period: "Annual", title: "AOC-4", state: "DRAFT", assigneeId: null, reviewerId: null, internalDueOn: null },
    { ...base, id: "jt-other", firmClientId: "fc2", service: "GST", period: "2026-10", title: "GSTR-3B", state: "IN_PREP", assigneeId: "u-priya", internalDueOn: ist("2026-11-17") },
  ]);
  mem.seed("agentRun", [
    { id: "run-1", jobTaskId: "jt-3b", agent: "gst", attempt: 1, status: "AGENT_DONE", startedAt: new Date("2026-11-04T05:00:00Z") },
    { id: "run-2", jobTaskId: "jt-3b", agent: "gst", attempt: 2, status: "AGENT_DONE", startedAt: new Date("2026-11-05T05:00:00Z") },
    { id: "run-9", jobTaskId: "jt-done", agent: "gst", attempt: 1, status: "APPROVED", startedAt: new Date("2026-10-10T05:00:00Z") },
  ]);
  return mem;
}

describe("/clients/[id] folder links", () => {
  beforeEach(() => {
    as({});
    prismaCalls.length = 0;
    state.firmCode = "ACME01";
    state.mem = seedFirmOs();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flag off (default): legacy header, no Path A links, no Firm OS jobs; FirmClient and JobTask never queried", async () => {
    vi.stubEnv("FIRM_OS_CL_PATHS", "");
    const html = await render();
    expect(html).toContain("SharePoint: Clients / Acme Pvt Ltd");
    expect(html).not.toContain("CL-ACME01");
    expect(html).not.toContain("Open Path A folder");
    expect(html).not.toContain("Firm OS jobs");
    expect(firmOsCalls()).toEqual([]);
  });

  it("flag on without a client code: legacy header unchanged, no Firm OS jobs and no JobTask query", async () => {
    vi.stubEnv("FIRM_OS_CL_PATHS", "1");
    state.firmCode = null;
    const html = await render();
    expect(html).toContain("SharePoint: Clients / Acme Pvt Ltd");
    expect(html).not.toContain("Open Path A folder");
    expect(html).not.toContain("Firm OS jobs");
    expect(prismaCalls.find((c) => c.model === "firmClient")?.args).toEqual({ where: { lmsClientId: "c1" }, select: { clientCode: true } });
    expect(prismaCalls.some((c) => c.model === "jobTask")).toBe(false);
  });

  it("flag on with a client code: site and job folder links resolve to CL-{Code}", async () => {
    vi.stubEnv("FIRM_OS_CL_PATHS", "true");
    const html = await render();
    expect(html).toContain('href="https://srcaassociate.sharepoint.com/sites/CL-ACME01"');
    expect(html).toContain("SharePoint: CL-ACME01");
    expect(html).toContain('href="https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2026-27/GST"');
    expect(html.match(/Open Path A folder/g)?.length).toBe(2); // title + aria-label of the one GST link; Tech job has none
    expect(html).not.toContain("SharePoint: Clients /");
  });
});

describe("/clients/[id] Firm OS jobs (flag on)", () => {
  beforeEach(() => {
    prismaCalls.length = 0;
    state.firmCode = "ACME01";
    state.mem = seedFirmOs();
    vi.stubEnv("FIRM_OS_CL_PATHS", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  const section = (html: string) => {
    const start = html.indexOf('aria-labelledby="firm-os-jobs"');
    expect(start, "Firm OS jobs section").toBeGreaterThan(-1);
    return html.slice(start, html.indexOf("</section>", start));
  };
  const rowsOf = (s: string) => s.split("<tr").slice(2); // drop the text before the table and the header row

  it("staff see only the jobs they prepare or review, scoped like /agents: service, period, title, exact state, DD MMM YYYY, assignee, run link", async () => {
    as({ id: "u-priya" });
    const s = section(await render());
    expect(s).toContain("Firm OS jobs (2)");
    const rows = rowsOf(s);
    expect(rows).toHaveLength(2);
    // Open jobs first; the DONE job after them.
    expect(rows[0]).toContain(">GST<");
    expect(rows[0]).toContain("2026-10 · FY 2026-27");
    expect(rows[0]).toContain(">GSTR-3B<");
    expect(rows[0]).toContain(">AGENT_DONE<");
    expect(rows[0]).toContain(">17 Nov 2026<");
    expect(rows[0]).toContain(">Priya S<");
    const runLink = /<a [^>]*>Open run<\/a>/.exec(rows[0])?.[0] ?? "";
    expect(runLink).toContain('href="/agents/gst/runs/run-2"'); // the latest run, not attempt 1
    expect(runLink).toContain('aria-label="Open run for GSTR-3B 2026-10"');
    expect(rows[0]).toContain("attempt 2");
    expect(rows[1]).toContain(">DONE<");
    expect(rows[1]).toContain("2026-09 · FY 2026-27");
    expect(rows[1]).toContain('href="/agents/gst/runs/run-9"');
    // Not on the job (GSTR-1 for Anil, AOC-4 unassigned), or another client's job: not listed.
    expect(s).not.toContain("GSTR-1");
    expect(s).not.toContain("AOC-4");
    expect(s).not.toContain("jt-other");
    expect(s).not.toMatch(PORTAL_OR_SEND);
    expect(s).not.toMatch(/<button/); // read-only
    const q = prismaCalls.find((c) => c.model === "jobTask")!.args as { where: unknown };
    expect(q.where).toEqual({ AND: [{ OR: [{ assigneeId: "u-priya" }, { reviewerId: "u-priya" }] }, { firmClient: { lmsClientId: "c1" } }] });
  });

  it("managers and partners see every job of the client; a job with no run links to Agent runs; unassigned and undated jobs say so", async () => {
    for (const level of ["MANAGER", "PARTNER"]) {
      prismaCalls.length = 0;
      as({ id: `u-${level.toLowerCase()}`, level });
      const s = section(await render());
      expect(s).toContain("Firm OS jobs (4)");
      const rows = rowsOf(s);
      expect(rows.map((r) => /<td class="[^"]*">([^<]+)<\/td><td class="[^"]*">([^<]+)<\/td><td class="[^"]*">([^<]+)</.exec(r)?.slice(1).join(" | "))).toEqual([
        "GST | 2026-10 · FY 2026-27 | GSTR-1",
        "GST | 2026-10 · FY 2026-27 | GSTR-3B",
        "ROC | Annual · FY 2026-27 | AOC-4",
        "GST | 2026-09 · FY 2026-27 | GSTR-3B",
      ]);
      expect(rows[0]).toContain(">08 Nov 2026<");
      expect(rows[0]).toContain(">anil@indefine.test<"); // no name: the email
      expect(rows[0]).toContain(">ASSIGNED<");
      expect(rows[0]).toContain("No run yet · </span>");
      const agentsLink = /<a [^>]*>Agent runs<\/a>/.exec(rows[0])?.[0] ?? "";
      expect(agentsLink).toContain('href="/agents"');
      expect(agentsLink).toContain('aria-label="Agent runs: no run yet for GSTR-1 2026-10"');
      expect(rows[2]).toContain(">DRAFT<");
      expect(rows[2]).toContain(">Not assigned<");
      expect(rows[2]).toContain(">—<");
      expect((prismaCalls.find((c) => c.model === "jobTask")!.args as { where: unknown }).where).toEqual({ AND: [{}, { firmClient: { lmsClientId: "c1" } }] });
    }
  });

  it("staff with no jobs on this client: an empty section that says why", async () => {
    as({ id: "u-nobody" });
    const s = section(await render());
    expect(s).toContain("Firm OS jobs (0)");
    expect(s).toContain("No Firm OS jobs for this client that you prepare or review.");
    expect(s).not.toContain("<table");
  });
});
