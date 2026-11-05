// LMS regression (Phase 12 §4): with every FIRM_OS_* flag OFF — the default production state until
// the go-live rollout (docs/go-live.md) — nothing of Firm OS leaks into the LMS pages beyond the
// entry points listed below, and rendering an LMS page never touches a Firm OS table.
//
// ALLOWLIST (the Firm OS surface that is visible today with every flag off — each is role-gated,
// NOT flag-gated; see docs/go-live.md "Rollout gap"):
//   /dashboard  "Agents" link → /agents          every active user (canUseAgents)
//   /tools      "Firm OS onboarding" → /onboard   partners, managers, admins (canOnboard)
//   /clients    "Firm OS onboarding" → /onboard   partners, managers, admins (canOnboard)
//   /admin      Firm OS group → /admin/firm-os/*  LMS admins
// Adding to this list is a go-live decision, not a test fix: record it in docs/go-live.md first.
// After the Phase 9 merge the dashboard board card must stay hidden here unless its flag is on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { FIRM_OS_FLAGS, FIRM_OS_MODELS, PEOPLE, TEST_EMAIL, firmOsHrefs, prismaCalls, renderPage, textOf } from "./support/render";

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
  it("/dashboard: only the role-gated Agents link, for every role; no coach board, no Firm OS query", async () => {
    for (const who of [PEOPLE.staff, PEOPLE.manager, PEOPLE.partner, PEOPLE.admin]) {
      signedIn(who);
      prismaCalls.length = 0;
      const html = await renderPage(await import("@/app/dashboard/page"));
      expect(firmOsHrefs(html), `dashboard for ${who.user.level}/${who.user.role}`).toEqual(["/agents"]);
      expect(textOf(html)).not.toMatch(/Must today|Morning board|Firm OS|Take a break/);
      expect(firmOsQueries()).toEqual([]);
    }
  });

  it("/tools: no Firm OS entry for staff; partners and managers get the onboarding card only", async () => {
    const tools = async () => renderPage(await import("@/app/tools/page"), {}, await import("@/app/tools/layout"));
    signedIn(PEOPLE.staff);
    expect(firmOsHrefs(await tools())).toEqual([]);
    for (const who of [PEOPLE.manager, PEOPLE.partner]) {
      signedIn(who);
      expect(firmOsHrefs(await tools())).toEqual(["/onboard"]);
    }
    expect(firmOsQueries()).toEqual([]);
  });

  it("/clients and /clients/[id]: no Firm OS jobs card and no FirmClient / JobTask query while FIRM_OS_CL_PATHS is off", async () => {
    signedIn(PEOPLE.staff);
    const list = await renderPage(await import("@/app/clients/page"), {}, await import("@/app/clients/layout"));
    expect(firmOsHrefs(list)).toEqual([]);
    signedIn(PEOPLE.partner);
    const listP = await renderPage(await import("@/app/clients/page"), {}, await import("@/app/clients/layout"));
    expect(firmOsHrefs(listP)).toEqual(["/onboard"]);
    const detail = await renderPage(await import("@/app/clients/[id]/page"), { params: Promise.resolve({ id: "c1" }) });
    expect(textOf(detail)).toContain("Acme Pvt Ltd");
    expect(textOf(detail)).not.toMatch(/Firm OS jobs|CL-[A-Z0-9]{3,10}/);
    expect(firmOsHrefs(detail)).toEqual([]);
    expect(firmOsQueries()).toEqual([]);
  });

  it("/work (the tech tracker): no Firm OS link or query at all", async () => {
    signedIn(PEOPLE.staff);
    for (const page of [() => import("@/app/work/page"), () => import("@/app/work/board/page"), () => import("@/app/work/week/page")]) {
      const html = await renderPage(await page(), {}, await import("@/app/work/layout"));
      expect(firmOsHrefs(html)).toEqual([]);
    }
    expect(firmOsQueries()).toEqual([]);
  });

  it("/admin: the Firm OS group is shown to LMS admins only (models, mistakes, cycle time)", async () => {
    signedIn(PEOPLE.admin);
    const html = await renderPage(await import("@/app/admin/page"), {}, await import("@/app/admin/layout"));
    expect(firmOsHrefs(html)).toEqual(["/admin/firm-os/cycle-time", "/admin/firm-os/mistakes", "/admin/firm-os/models"]);
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
