// Smoke: /clients renders behind a signed-in session and bounces signed-out visitors to "/".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, prismaCalls, redirectTarget, renderHtml, workspaceRow } from "./harness";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
// The empty database plus a person's own workspace row when a test sets one.
const ws = vi.hoisted(() => ({ setting: null as unknown }));
vi.mock("@/lib/prisma", async () => {
  const { prismaMock, withWorkspace } = await import("./harness");
  return { prisma: withWorkspace(prismaMock, { setting: () => ws.setting }) };
});
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);

const { auth } = await import("@/lib/auth");
const { default: ClientsLayout } = await import("@/app/clients/layout");
const { default: ClientsList } = await import("@/app/clients/page");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const noParams = () => ({ searchParams: Promise.resolve({}) });

afterEach(() => vi.unstubAllEnvs());

describe("/clients", () => {
  beforeEach(() => {
    signedIn(activeSession({ level: "MANAGER" }));
    prismaCalls.length = 0;
    ws.setting = null;
  });

  it("renders the client database (empty state) inside the layout for a manager (Clients is on by default)", async () => {
    const page = await ClientsList(noParams());
    const html = await renderHtml(await ClientsLayout({ children: page }));
    expect(html).toContain("Client database");
    expect(html).toContain("No clients match");
    expect(html).toContain('href="/clients/new"');
    expect(prismaCalls.some((c) => c.model === "client" && c.method === "findMany")).toBe(true);
  });

  it("applies the search filter to the client query", async () => {
    await ClientsList({ searchParams: Promise.resolve({ q: "abcde" }) });
    const call = prismaCalls.find((c) => c.model === "client" && c.method === "findMany");
    expect(JSON.stringify(call?.args)).toContain("ABCDE"); // PAN search is upper-cased
  });

  it("redirects a signed-out visitor to sign-in (layout and page both guard)", async () => {
    signedIn(null);
    expect(await redirectTarget(() => ClientsLayout({ children: null }))).toBe("/");
    expect(await redirectTarget(() => ClientsList(noParams()))).toBe("/");
  });

  it("sends an inactive user back to the dashboard, even with Clients switched on", async () => {
    ws.setting = workspaceRow(["clients"]);
    signedIn(activeSession({ active: false }));
    expect(await redirectTarget(() => ClientsLayout({ children: null }))).toBe("/dashboard");
  });

  it("Firm OS on, staff: Clients is off by default (the dashboard explains); on when an admin switches it on", async () => {
    vi.stubEnv("FIRM_OS_ENABLED", "1");
    signedIn(activeSession());
    expect(await redirectTarget(() => ClientsLayout({ children: null }))).toBe("/dashboard?module-off=clients");
    ws.setting = workspaceRow(["clients"]);
    expect(await renderHtml(await ClientsLayout({ children: null }))).toContain('href="/clients/new"');
    vi.unstubAllEnvs();
  });

  it("Firm OS off (the default): staff open /clients as before; no settings read; no Firm OS onboarding link", async () => {
    signedIn(activeSession());
    ws.setting = workspaceRow([]); // would close everything if it were read
    const html = await renderHtml(await ClientsLayout({ children: null }));
    expect(html).toContain('href="/clients/new"');
    expect(html).not.toContain('href="/onboard"');
    signedIn(activeSession({ level: "PARTNER" }));
    expect(await renderHtml(await ClientsLayout({ children: null }))).not.toContain('href="/onboard"');
  });
});
