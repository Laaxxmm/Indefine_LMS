// LMS regression (Phase 12 §4): every existing LMS page still server-renders behind its session
// with its heading, inside its layout where it has one, and the access gates are unchanged:
// signed-out → "/", inactive → /dashboard, non-admin → /dashboard from /admin, Neo Centra for
// partners only, /work for the tracker list only. Runs against an empty database (harness).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { NotFoundSignal, PEOPLE, TEST_EMAIL, activeSession, headings, redirectTarget, renderPage } from "./support/render";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("../unit/routes/harness")).prismaMock }));
vi.mock("next/navigation", async () => (await import("../unit/routes/harness")).navigationMock);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }), headers: async () => new Headers() }));

const { auth } = await import("@/lib/auth");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);

type Mod = { default: (props: never) => unknown };
type Route = [path: string, page: () => Promise<Mod>, heading: string | RegExp, layout?: () => Promise<Mod>];

const toolsLayout = () => import("@/app/tools/layout");
const clientsLayout = () => import("@/app/clients/layout");
const workLayout = () => import("@/app/work/layout");
const adminLayout = () => import("@/app/admin/layout");

const ROUTES: Route[] = [
  ["/dashboard", () => import("@/app/dashboard/page"), /^Smoke/],
  ["/work", () => import("@/app/work/page"), "Nothing assigned yet", workLayout],
  ["/work/board", () => import("@/app/work/board/page"), "All work", workLayout],
  ["/work/week", () => import("@/app/work/week/page"), "2 Nov – 8 Nov", workLayout],
  ["/tools", () => import("@/app/tools/page"), "Tools", toolsLayout],
  ["/tools/sop-builder", () => import("@/app/tools/sop-builder/page"), "Standard Operating Procedures", toolsLayout],
  ["/tools/sop-builder/new", () => import("@/app/tools/sop-builder/new/page"), "New SOP", toolsLayout],
  ["/tools/sop-builder/admin", () => import("@/app/tools/sop-builder/admin/page"), "SOP editors", toolsLayout],
  ["/tools/certificate-generator", () => import("@/app/tools/certificate-generator/page"), "Choose a format", toolsLayout],
  ["/tools/certificate-generator/history", () => import("@/app/tools/certificate-generator/history/page"), "History", toolsLayout],
  ["/tools/office-tools", () => import("@/app/tools/office-tools/page"), "Document & Tax Tools", toolsLayout],
  ["/tools/office-tools/gstr3b", () => import("@/app/tools/office-tools/gstr3b/page"), "GSTR-3B Processor", toolsLayout],
  ["/tools/office-tools/tds-challan", () => import("@/app/tools/office-tools/tds-challan/page"), "TDS Challan Processor", toolsLayout],
  ["/tools/office-tools/engagement-letter", () => import("@/app/tools/office-tools/engagement-letter/page"), "Engagement letters", toolsLayout],
  ["/tools/office-tools/director-report", () => import("@/app/tools/office-tools/director-report/page"), "Director's Report", toolsLayout],
  ["/tools/office-tools/llp", () => import("@/app/tools/office-tools/llp/page"), "LLP Agreement", toolsLayout],
  ["/tools/office-tools/mou", () => import("@/app/tools/office-tools/mou/page"), "MOU Generator", toolsLayout],
  ["/tools/office-tools/partnership", () => import("@/app/tools/office-tools/partnership/page"), "Partnership Deed", toolsLayout],
  ["/tools/office-tools/rental", () => import("@/app/tools/office-tools/rental/page"), "Rental Agreement", toolsLayout],
  ["/tools/office-tools/trust", () => import("@/app/tools/office-tools/trust/page"), "Trust Deed", toolsLayout],
  ["/tools/office-tools/history", () => import("@/app/tools/office-tools/history/page"), "Usage history", toolsLayout],
  ["/tools/neo-centra/how-it-works", () => import("@/app/tools/neo-centra/how-it-works/page"), /^The Race, explained/, toolsLayout],
  ["/tools/neo-centra/incentives", () => import("@/app/tools/neo-centra/incentives/page"), "The Race · Q3", toolsLayout],
  ["/tools/statutory-updates", () => import("@/app/tools/statutory-updates/page"), "Statutory updates", toolsLayout],
  ["/tools/client-ops", () => import("@/app/tools/client-ops/page"), "Client ops", toolsLayout],
  ["/clients", () => import("@/app/clients/page"), "Client database", clientsLayout],
  ["/clients/new", () => import("@/app/clients/new/page"), "New client", clientsLayout],
  ["/clients/reports", () => import("@/app/clients/reports/page"), "Client base", clientsLayout],
  ["/clients/admin/services", () => import("@/app/clients/admin/services/page"), "Services", clientsLayout],
  ["/admin", () => import("@/app/admin/page"), "Overview", adminLayout],
  ["/admin/kra", () => import("@/app/admin/kra/page"), "KRA report", adminLayout],
  ["/admin/attendance", () => import("@/app/admin/attendance/page"), "Attendance", adminLayout],
  ["/admin/team", () => import("@/app/admin/team/page"), "Team & hierarchy", adminLayout],
  ["/admin/settings", () => import("@/app/admin/settings/page"), "Settings", adminLayout],
  ["/admin/courses", () => import("@/app/admin/courses/page"), "Courses & deadlines", adminLayout],
  ["/admin/approvals", () => import("@/app/admin/approvals/page"), "Approvals", adminLayout],
  ["/admin/assignments", () => import("@/app/admin/assignments/page"), "Assignments", adminLayout],
  ["/admin/branches", () => import("@/app/admin/branches/page"), "Branches", adminLayout],
  ["/admin/checkins", () => import("@/app/admin/checkins/page"), "Weekly check-ins", adminLayout],
  ["/admin/live", () => import("@/app/admin/live/page"), "Live sessions", adminLayout],
  ["/admin/trajectory", () => import("@/app/admin/trajectory/page"), "Trajectory framework", adminLayout],
  ["/admin/auto-quiz", () => import("@/app/admin/auto-quiz/page"), "Auto-generate quizzes", adminLayout],
];

// A partner who is also an LMS admin and on the /work tracker list sees every page.
const EVERYONE = activeSession({ role: "ADMIN", level: "PARTNER" });

beforeEach(() => {
  vi.stubEnv("WORK_TRACKER_EMAILS", `lead@indefine.test,${TEST_EMAIL}`);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T04:30:00Z")); // Wednesday 10:00 IST, FY 2026-27 Q3
  signedIn(EVERYONE);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("every LMS page server-renders with its heading", () => {
  for (const [path, page, heading, layout] of ROUTES) {
    it(path, async () => {
      const html = await renderPage(await page(), {}, layout ? await layout() : undefined);
      const h = headings(html);
      expect(h.some((x) => (typeof heading === "string" ? x === heading : heading.test(x))), `${path} headings: ${JSON.stringify(h)}`).toBe(true);
    });
  }
});

describe("access gates are unchanged", () => {
  it("signed-out visitors go to sign-in from every staff area", async () => {
    signedIn(null);
    const { default: Dashboard } = await import("@/app/dashboard/page");
    expect(await redirectTarget(() => Dashboard({}))).toBe("/");
    for (const layout of [toolsLayout, clientsLayout, workLayout]) {
      const { default: L } = (await layout()) as { default: (p: { children: null }) => unknown };
      expect(await redirectTarget(() => L({ children: null }))).toBe("/");
    }
  });

  it("inactive accounts are sent back to the dashboard from Tools and Clients", async () => {
    signedIn(PEOPLE.inactive);
    for (const layout of [toolsLayout, clientsLayout]) {
      const { default: L } = (await layout()) as { default: (p: { children: null }) => unknown };
      expect(await redirectTarget(() => L({ children: null }))).toBe("/dashboard");
    }
  });

  it("admin pages are for LMS admins only (a partner who is not an admin is sent to the dashboard)", async () => {
    const { default: L } = (await adminLayout()) as { default: (p: { children: null }) => unknown };
    signedIn(PEOPLE.partner);
    expect(await redirectTarget(() => L({ children: null }))).toBe("/dashboard");
    signedIn(PEOPLE.staff);
    expect(await redirectTarget(() => L({ children: null }))).toBe("/dashboard");
  });

  it("Neo Centra is for partners only", async () => {
    const { default: Incentives } = (await import("@/app/tools/neo-centra/incentives/page")) as unknown as { default: (p: object) => unknown };
    signedIn(PEOPLE.manager);
    expect(await redirectTarget(() => Incentives({ searchParams: Promise.resolve({}) }))).toBe("/dashboard");
    signedIn(PEOPLE.partner);
    await expect(Incentives({ searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
  });

  it("/work is invisible (404) to anyone not on WORK_TRACKER_EMAILS", async () => {
    const { default: L } = (await workLayout()) as { default: (p: { children: null }) => Promise<unknown> };
    signedIn(activeSession({ email: "someone.else@indefine.test" }));
    await expect(L({ children: null })).rejects.toBeInstanceOf(NotFoundSignal);
  });
});
