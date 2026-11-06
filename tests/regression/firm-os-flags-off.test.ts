// LMS regression (Phase 12 §4): with every FIRM_OS_* flag OFF — the default production state until
// the go-live rollout (docs/go-live.md) — nothing of Firm OS leaks into the LMS pages beyond the
// entry points listed below, and no LMS page reads or writes a Firm OS table (nor the workspace
// settings: the master switch FIRM_OS_ENABLED closes Firm OS before anything is read).
//
// ALLOWLIST (the Firm OS surface that is visible with every flag off; docs/go-live.md §3):
//   /admin      Firm OS group → /admin/firm-os/workspace only   LMS admins: Workspace settings stays open
//                                                              so the rollout can be prepared before the
//                                                              switch goes on; the other admin Firm OS pages
//                                                              are closed
// Adding to this list is a go-live decision, not a test fix: record it in docs/go-live.md first.
// The break nudge is flag-gated (FIRM_OS_BREAK_NUDGE): off → no heartbeat is stored.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { FIRM_OS_FLAGS, FIRM_OS_MODELS, PEOPLE, TEST_EMAIL, firmOsHrefs, prismaCalls, redirectTarget, renderPage, textOf } from "./support/render";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("../unit/routes/harness")).navigationMock);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }), headers: async () => new Headers() }));
// The empty-database harness, except /clients/[id] finds one legacy client (so its page renders fully).
vi.mock("@/lib/prisma", async () => {
  const { prismaMock, prismaCalls: calls } = await import("../unit/routes/harness");
  const CLIENT = {
    id: "c1", name: "Acme Pvt Ltd", active: true, entityType: "PVT_LTD", pan: null, gstin: null, cin: null, industry: null, city: "Bengaluru",
    contactName: null, contactPhone: null, contactEmail: null, referralSource: null, turnover: 1_500_000, turnoverBand: "UNDER_40L",
    growthGoal: "MAINTAIN", growthNote: null, onboardedOn: new Date("2026-04-01T00:00:00+05:30"), primaryHandlerId: "u1",
    primaryHandler: { name: "Priya", email: "priya@indefine.test" }, graphFolderId: "legacy-folder-id", folderName: "Acme Pvt Ltd", folderStatus: "READY",
    documents: [], jobs: [],
  };
  return {
    prisma: new Proxy({}, {
      get: (_t, key: string | symbol) => {
        if (key === "client") {
          const base = (prismaMock as Record<string, Record<string, (a: unknown) => Promise<unknown>>>).client;
          return new Proxy({}, { get: (_x, m: string | symbol) => (m === "findUnique" ? async (a: unknown) => (calls.push({ model: "client", method: "findUnique", args: a }), CLIENT) : base[m as string]) });
        }
        return (prismaMock as Record<string | symbol, unknown>)[key];
      },
    }),
  };
});

const { auth } = await import("@/lib/auth");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const firmOsQueries = () => [...new Set(prismaCalls.filter((c) => FIRM_OS_MODELS.has(c.model)).map((c) => `${c.model}.${c.method}`))].sort();
/** The workspace-settings tables: read only while Firm OS is switched on. */
const settingsReads = () => prismaCalls.filter((c) => c.model === "workspaceSetting" || c.model === "roleWorkspaceDefault");

beforeEach(() => {
  for (const f of FIRM_OS_FLAGS) vi.stubEnv(f, ""); // production default: every flag off
  vi.stubEnv("WORK_TRACKER_EMAILS", `lead@indefine.test,${TEST_EMAIL}`);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T04:30:00Z"));
  prismaCalls.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Firm OS surface on LMS pages with every FIRM_OS_* flag off", () => {
  it("/dashboard: no Firm OS link, card or query for any role (no Agents, My day, Next task, Client messages or Search)", async () => {
    for (const who of [PEOPLE.staff, PEOPLE.manager, PEOPLE.partner, PEOPLE.admin]) {
      signedIn(who);
      prismaCalls.length = 0;
      const html = await renderPage(await import("@/app/dashboard/page"));
      expect(firmOsHrefs(html), `dashboard for ${who.user.level}/${who.user.role}`).toEqual([]);
      expect(textOf(html)).not.toMatch(/Must today|Firm OS|Take a break|break reminder|Your next task/i);
      expect(firmOsQueries(), "LMS pages make zero Firm OS queries while Firm OS is off").toEqual([]);
      expect(settingsReads()).toEqual([]);
      expect(prismaCalls.some((c) => c.model === "activityHeartbeat")).toBe(false); // FIRM_OS_BREAK_NUDGE off: nothing collected
    }
  });

  it("a Firm OS page sends people to the dashboard, which says Firm OS is not switched on", async () => {
    signedIn(PEOPLE.partner);
    for (const layout of ["agents", "onboard", "coach", "comms", "search", "focus", "workspace", "companion"]) {
      const mod = await import(`@/app/${layout}/layout`);
      expect(await redirectTarget(() => mod.default({ children: null })), layout).toBe("/dashboard?module-off=firm-os");
    }
    const html = await renderPage(await import("@/app/dashboard/page"), { searchParams: Promise.resolve({ "module-off": "firm-os" }) });
    expect(textOf(html)).toContain("Firm OS is not switched on for the firm yet. Everything else works as before; ask an admin if you expected to use it.");
  });

  it("/tools: no Firm OS entry for anyone, partners and managers included", async () => {
    const tools = async () => renderPage(await import("@/app/tools/page"), {}, await import("@/app/tools/layout"));
    for (const who of [PEOPLE.staff, PEOPLE.manager, PEOPLE.partner, PEOPLE.admin]) {
      signedIn(who);
      expect(firmOsHrefs(await tools()), `tools for ${who.user.level}/${who.user.role}`).toEqual([]);
    }
    expect(firmOsQueries()).toEqual([]);
    expect(settingsReads()).toEqual([]);
  });

  it("/clients and /clients/[id]: no Firm OS jobs card and no FirmClient / JobTask query while FIRM_OS_CL_PATHS is off", async () => {
    signedIn(PEOPLE.staff);
    const list = await renderPage(await import("@/app/clients/page"), {}, await import("@/app/clients/layout"));
    expect(firmOsHrefs(list)).toEqual([]);
    signedIn(PEOPLE.partner);
    const listP = await renderPage(await import("@/app/clients/page"), {}, await import("@/app/clients/layout"));
    expect(firmOsHrefs(listP)).toEqual([]); // no Firm OS onboarding link while Firm OS is off
    const detail = await renderPage(await import("@/app/clients/[id]/page"), { params: Promise.resolve({ id: "c1" }) });
    expect(textOf(detail)).toContain("Acme Pvt Ltd");
    expect(textOf(detail)).not.toMatch(/Firm OS jobs|CL-[A-Z0-9]{3,10}/);
    expect(firmOsHrefs(detail)).toEqual([]);
    // The one write allowed: the client-data read audit (security, DPDP breach runbook §2), which
    // stays on with Firm OS off like the PII reveal and report export audits.
    const readAudit = (c: (typeof prismaCalls)[number]) => {
      const data = (c.args as { data?: { action?: string; entity?: string } } | undefined)?.data;
      return c.model === "auditEvent" && c.method === "create" && data?.action === "view" && data.entity === "Client";
    };
    expect(prismaCalls.filter(readAudit)).toHaveLength(1);
    expect([...new Set(prismaCalls.filter((c) => FIRM_OS_MODELS.has(c.model) && !readAudit(c)).map((c) => `${c.model}.${c.method}`))]).toEqual([]);
    expect(settingsReads()).toEqual([]);
  });

  it("/work (the tech tracker): no Firm OS link or query at all", async () => {
    signedIn(PEOPLE.staff);
    for (const page of [() => import("@/app/work/page"), () => import("@/app/work/board/page"), () => import("@/app/work/week/page")]) {
      const html = await renderPage(await page(), {}, await import("@/app/work/layout"));
      expect(firmOsHrefs(html)).toEqual([]);
    }
    expect(firmOsQueries()).toEqual([]);
  });

  it("/admin: the Firm OS group keeps Workspace settings (rollout prep) and the DPDP privacy/breach registers (owner decision 2026-11-06: DPDP covers all client data); the other admin Firm OS pages are closed", async () => {
    signedIn(PEOPLE.admin);
    const html = await renderPage(await import("@/app/admin/page"), {}, await import("@/app/admin/layout"));
    expect(firmOsHrefs(html).sort()).toEqual(["/admin/firm-os/breaches", "/admin/firm-os/privacy", "/admin/firm-os/workspace"]);
    for (const page of ["privacy", "breaches"]) {
      const layout = await import(`@/app/admin/firm-os/${page}/layout`);
      // Renders (no redirect): the admin layout still limits these pages to admins.
      await expect(Promise.resolve(layout.default({ children: null })), page).resolves.toBeDefined();
    }
    for (const page of ["models", "mistakes", "cycle-time"]) {
      const layout = await import(`@/app/admin/firm-os/${page}/layout`);
      expect(await redirectTarget(() => layout.default({ children: null })), page).toBe("/dashboard?module-off=firm-os");
    }
    expect(settingsReads()).toEqual([]);
  });

  it("the Echo test agent stays hidden from /agents navigation", async () => {
    signedIn(PEOPLE.partner);
    const { visibleAgents } = await import("@/lib/agents/registry");
    expect(visibleAgents().map((a) => a.key)).not.toContain("echo");
  });

  it("the Turia bridge defaults to the manual checklist and UI automation stays off", async () => {
    const { turiaBridgeMode } = await import("@/lib/integrations/turia/factory");
    const { isTuriaUiEnabled } = await import("@/lib/integrations/turia/ui-bridge");
    expect(turiaBridgeMode()).toBe("MANUAL");
    expect(isTuriaUiEnabled()).toBe(false);
  });

  it("onboarding still asks a person to confirm before creating anything (FIRM_OS_ONBOARD_CONFIRM unset = confirm)", async () => {
    const { isConfirmRequired } = await import("@/lib/agents/onboarding/plan");
    expect(isConfirmRequired()).toBe(true);
  });
});
