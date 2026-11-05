// /clients/[id] under FIRM_OS_CL_PATHS: flag off = legacy render and no FirmClient query;
// flag on + client code = CL-{Code} site and job folder links via paths.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, prismaCalls, renderHtml } from "./harness";

const state = vi.hoisted(() => ({ firmCode: null as string | null }));

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
  return {
    prisma: new Proxy(
      {},
      {
        get: (_t, key: string | symbol) => {
          if (key === "client") return { findUnique: async (args: unknown) => (record("client", "findUnique", args), CLIENT) };
          if (key === "firmClient") {
            return { findUnique: async (args: unknown) => (record("firmClient", "findUnique", args), state.firmCode ? { clientCode: state.firmCode } : null) };
          }
          return (prismaMock as Record<string | symbol, unknown>)[key];
        },
      },
    ),
  };
});

const { auth } = await import("@/lib/auth");
const { default: ClientPage } = await import("@/app/clients/[id]/page");
const render = async () => renderHtml(await ClientPage({ params: Promise.resolve({ id: "c1" }) }));

describe("/clients/[id] folder links", () => {
  beforeEach(() => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(activeSession());
    prismaCalls.length = 0;
    state.firmCode = "ACME01";
  });
  afterEach(() => vi.unstubAllEnvs());

  it("flag off (default): legacy header, no Path A links, FirmClient never queried", async () => {
    vi.stubEnv("FIRM_OS_CL_PATHS", "");
    const html = await render();
    expect(html).toContain("SharePoint: Clients / <!-- -->Acme Pvt Ltd");
    expect(html).not.toContain("CL-ACME01");
    expect(html).not.toContain("Open Path A folder");
    expect(prismaCalls.some((c) => c.model === "firmClient")).toBe(false);
  });

  it("flag on without a client code: legacy header unchanged", async () => {
    vi.stubEnv("FIRM_OS_CL_PATHS", "1");
    state.firmCode = null;
    const html = await render();
    expect(html).toContain("SharePoint: Clients / <!-- -->Acme Pvt Ltd");
    expect(html).not.toContain("Open Path A folder");
    expect(prismaCalls.find((c) => c.model === "firmClient")?.args).toEqual({ where: { lmsClientId: "c1" }, select: { clientCode: true } });
  });

  it("flag on with a client code: site and job folder links resolve to CL-{Code}", async () => {
    vi.stubEnv("FIRM_OS_CL_PATHS", "true");
    const html = await render();
    expect(html).toContain('href="https://srcaassociate.sharepoint.com/sites/CL-ACME01"');
    expect(html).toContain("SharePoint: <!-- -->CL-ACME01");
    expect(html).toContain('href="https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2026-27/GST"');
    expect(html.match(/Open Path A folder/g)?.length).toBe(2); // title + aria-label of the one GST link; Tech job has none
    expect(html).not.toContain("SharePoint: Clients /");
  });
});
