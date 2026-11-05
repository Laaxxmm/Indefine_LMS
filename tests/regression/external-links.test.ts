// LMS regression (Phase 12 §4): the greytHR and Turia links staff use every day are unchanged —
// same URLs, opening in a new tab with rel=noreferrer — and the Tools grid offers the same tools to
// the same people. A Firm OS change that drops, renames or re-points one of these fails here.
// The expected values are a snapshot taken on 2026-11-05 from firm-os/phase-0-inventory.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { PEOPLE, anchors, hrefs, renderPage } from "./support/render";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("../unit/routes/harness")).prismaMock }));
vi.mock("next/navigation", async () => (await import("../unit/routes/harness")).navigationMock);

const { auth } = await import("@/lib/auth");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const external = (html: string) => anchors(html).filter((a) => /greythr|turia/i.test(a.href));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T04:30:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("greytHR and Turia links", () => {
  it("the dashboard links greytHR and Turia exactly as before, for staff and partners alike", async () => {
    for (const who of [PEOPLE.staff, PEOPLE.partner]) {
      signedIn(who);
      const html = await renderPage(await import("@/app/dashboard/page"));
      expect(external(html)).toEqual([
        { href: "https://streamlining.greythr.com/", target: "_blank", rel: "noreferrer" },
        { href: "https://practice.turia.in/", target: "_blank", rel: "noreferrer" },
      ]);
    }
  });

  it("the admin attendance importer still points to greytHR for the monthly CSV", async () => {
    signedIn(PEOPLE.admin);
    const html = await renderPage(await import("@/app/admin/attendance/page"));
    expect(external(html)).toEqual([{ href: "https://streamlining.greythr.com/", target: "_blank", rel: "noreferrer" }]);
  });
});

describe("Tools grid", () => {
  const toolsHrefs = async () => {
    const html = await renderPage(await import("@/app/tools/page"), {}, await import("@/app/tools/layout"));
    return [...new Set(hrefs(html).filter((h) => h.startsWith("/tools/") || h === "/onboard"))].sort();
  };

  it("staff see the shared tools (no partner-only cards)", async () => {
    signedIn(PEOPLE.staff);
    expect(await toolsHrefs()).toEqual([
      "/tools/certificate-generator",
      "/tools/client-ops",
      "/tools/office-tools",
      "/tools/sop-builder",
      "/tools/statutory-updates",
    ]);
  });

  it("partners also see Neo Centra and Firm OS onboarding", async () => {
    signedIn(PEOPLE.partner);
    expect(await toolsHrefs()).toEqual([
      "/onboard",
      "/tools/certificate-generator",
      "/tools/client-ops",
      "/tools/neo-centra/incentives",
      "/tools/office-tools",
      "/tools/sop-builder",
      "/tools/statutory-updates",
    ]);
  });

  it("office tools still list the GSTR-3B and TDS challan processors and the document generators", async () => {
    signedIn(PEOPLE.staff);
    const html = await renderPage(await import("@/app/tools/office-tools/page"));
    const tools = [...new Set(hrefs(html).filter((h) => h.startsWith("/tools/office-tools/")))].sort();
    expect(tools).toEqual(
      expect.arrayContaining([
        "/tools/office-tools/gstr3b",
        "/tools/office-tools/tds-challan",
        "/tools/office-tools/engagement-letter",
        "/tools/office-tools/partnership",
        "/tools/office-tools/llp",
        "/tools/office-tools/rental",
        "/tools/office-tools/mou",
        "/tools/office-tools/trust",
        "/tools/office-tools/director-report",
      ]),
    );
  });
});
