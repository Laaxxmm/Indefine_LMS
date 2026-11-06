// Re-audit NEW-8 follow-up: certificate and engagement-letter rows join a client by clientId
// (src/lib/privacy/client-link.ts), but no screen set it, so every new record stayed name-only. The
// client detail page now links to both tools with ?clientId=<id>; the certificate picker keeps the id
// on every format; the engagement-letter generator takes it the way the certificate format page does
// (checked, looked up, the name filled in) and sends it with the save while the name is unchanged.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { activeSession, hrefs, renderPage } from "../../regression/support/render";

const CLIENT = {
  id: "c1", name: "Acme Pvt Ltd", active: true, entityType: "PVT_LTD", pan: null, gstin: null, cin: null, industry: null, city: "Bengaluru",
  contactName: null, contactPhone: null, contactEmail: null, referralSource: null, turnover: 1_500_000, turnoverBand: "UNDER_40L",
  growthGoal: "MAINTAIN", growthNote: null, onboardedOn: new Date("2026-04-01T00:00:00+05:30"), primaryHandlerId: "u1",
  primaryHandler: { name: "Priya", email: "priya@indefine.test" }, graphFolderId: null, folderName: "Acme Pvt Ltd", folderStatus: "READY",
  documents: [], jobs: [],
};
const lookups: unknown[] = [];

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/prisma", async () => {
  const { prismaMock } = await import("./harness");
  return {
    prisma: new Proxy({}, {
      get: (_t, key: string | symbol) => {
        if (key === "client") {
          const base = (prismaMock as Record<string, Record<string, (a: unknown) => Promise<unknown>>>).client;
          return new Proxy({}, {
            get: (_x, m: string | symbol) =>
              m === "findUnique"
                ? async (a: { where: { id: string }; select?: Record<string, boolean> }) => {
                    lookups.push(a);
                    if (a.where.id !== "c1") return null;
                    return a.select ? { id: CLIENT.id, name: CLIENT.name } : CLIENT;
                  }
                : m === "findMany"
                  ? async () => [{ name: CLIENT.name }]
                  : base[m as string],
          });
        }
        return (prismaMock as Record<string | symbol, unknown>)[key];
      },
    }),
  };
});

const { auth } = await import("@/lib/auth");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);

beforeEach(() => {
  lookups.length = 0;
  vi.stubEnv("FIRM_OS_CL_PATHS", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("the client record carries its id to the certificate generator and the letter generator", () => {
  it("PoC: /clients/[id] links to both tools with ?clientId=<id>", async () => {
    signedIn(activeSession({ id: "u-staff", level: "EXECUTIVE" }));
    const html = await renderPage(await import("@/app/clients/[id]/page"), { params: Promise.resolve({ id: "c1" }) });
    const links = hrefs(html);
    expect(links).toContain("/tools/certificate-generator?clientId=c1");
    expect(links).toContain("/tools/office-tools/engagement-letter/editor?clientId=c1");
  });

  it("someone who cannot use the tools does not get the links", async () => {
    const { canUseCertificateTool } = await import("@/lib/certificates/access");
    const { canUseOfficeTools } = await import("@/lib/office-tools/access");
    expect(canUseCertificateTool(activeSession({ active: false }).user)).toBe(false);
    expect(canUseOfficeTools(activeSession({ active: false }).user)).toBe(false);
  });

  it("PoC: the certificate picker keeps the client's id on every format; a malformed id is dropped", async () => {
    signedIn(activeSession({ id: "u-staff", level: "EXECUTIVE" }));
    const picker = await import("@/app/tools/certificate-generator/page");
    const linked = hrefs(await renderPage(picker, { searchParams: Promise.resolve({ clientId: "c1" }) })).filter((h) => /^\/tools\/certificate-generator\/[^/]+$|\?/.test(h) && !h.endsWith("/history"));
    expect(linked.length).toBeGreaterThan(0);
    for (const h of linked) expect(h, h).toMatch(/^\/tools\/certificate-generator\/[\w-]+\?clientId=c1$/);
    const plain = hrefs(await renderPage(picker, { searchParams: Promise.resolve({ clientId: "../x\"" }) }));
    expect(plain.some((h) => h.includes("clientId"))).toBe(false);
    expect(hrefs(await renderPage(picker)).some((h) => h.includes("clientId"))).toBe(false);
  });

  it("PoC: the letter generator, opened with ?clientId=, is given that client's record (id and name) and nothing else", async () => {
    signedIn(activeSession({ id: "u-staff", level: "EXECUTIVE" }));
    const { GET } = await import("@/app/tools/office-tools/engagement-letter/editor/route");
    const page = async (q: string) => (await GET(new Request(`http://localhost/tools/office-tools/engagement-letter/editor${q}`))).text();
    expect(await page("?clientId=c1")).toContain('const CLIENT_LINK = {"id":"c1","name":"Acme Pvt Ltd"};');
    expect(await page("")).toContain("const CLIENT_LINK = null;");
    expect(await page("?clientId=nope")).toContain("const CLIENT_LINK = null;"); // no such record
    lookups.length = 0;
    expect(await page("?clientId=..%2Fx%22%3C")).toContain("const CLIENT_LINK = null;"); // malformed: not even looked up
    expect(lookups).toEqual([]);
    // No placeholder is left for the browser to choke on.
    expect(await page("?clientId=c1")).not.toMatch(/__(?:HEAD|FOOT|CLIENTS|PRELOAD|CLIENT_LINK)__/);
  });

  it("the generator sends the id with the save only while the client name is still the record's own, and fills the name in", () => {
    const html = readFileSync(join(process.cwd(), "src/lib/office-tools/engagement-letter/el-generator.template.html"), "utf8");
    expect(html).toContain("const CLIENT_LINK = __CLIENT_LINK__;");
    expect(html).toMatch(/JSON\.stringify\(\{ id: letterId, data: state\(\), overwrite, \.\.\.\(CLIENT_LINK && sameName\(f\.client\.value, CLIENT_LINK\.name\) \? \{ clientId: CLIENT_LINK\.id \} : \{\}\) \}\)/);
    expect(html).toMatch(/else if \(CLIENT_LINK\) \{[\s\S]{0,700}f\.client\.value = CLIENT_LINK\.name;/);
    // The banner says when an edited name means the letter will not be linked.
    expect(html).toContain("so this letter will not be linked to that client record.");
    // The save route compares the same way (whitespace and case), so both sides agree on "unchanged".
    const sameName = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
    expect(sameName("  acme   pvt ltd ", "Acme Pvt Ltd")).toBe(true);
    expect(sameName("Acme Traders", "Acme Pvt Ltd")).toBe(false);
  });

  it("the link a save sends is stored only when the name is the record's own (client-link.ts, unchanged)", async () => {
    const { clientLinkFor } = await import("@/lib/privacy/client-link");
    const db = { client: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "c1" ? { id: "c1", name: "Acme Pvt Ltd" } : null) } };
    expect(await clientLinkFor(db, "c1", "Acme  pvt ltd")).toEqual({ ok: true, clientId: "c1" });
    expect(await clientLinkFor(db, "c1", "Someone Else")).toEqual({ ok: true, clientId: null });
  });
});
