// Smoke: /onboard renders for a partner (layout + page + client panel), and sends everyone else away.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, prismaCalls, redirectTarget, renderHtml } from "./harness";

// Firm OS switched on for these tests (FIRM_OS_ENABLED defaults off: src/lib/workspace/flag.ts).
beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("@/lib/ai/router", () => ({ run: vi.fn() }));

const { auth } = await import("@/lib/auth");
const { default: OnboardLayout } = await import("@/app/onboard/layout");
const { default: OnboardPage } = await import("@/app/onboard/page");
const { default: ToolsIndex } = await import("@/app/tools/page");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const params = (run?: string) => ({ searchParams: Promise.resolve(run ? { run } : {}) });

describe("/onboard", () => {
  beforeEach(() => {
    signedIn(activeSession({ level: "PARTNER" }));
    prismaCalls.length = 0;
  });

  it("renders the one-sentence form inside the Firm OS layout for a partner", async () => {
    const page = await OnboardPage(params());
    const html = await renderHtml(await OnboardLayout({ children: page }));
    expect(html).toContain("Onboard a client");
    expect(html).toContain("Client in one sentence");
    expect(html).toContain('for="onboard-prompt"');
    expect(html).toContain("Continue");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/agents"'); // where the new jobs are worked on
    expect(html).toContain('aria-label="Firm OS"'); // the one Firm OS header
    expect(html).toContain(">Firm OS onboarding</a>");
    expect(html).not.toContain("text-ink-faint"); // ~2:1 on white, below AA: Firm OS text uses ink-mute
    expect(html).not.toMatch(/submit to portal/i);
  });

  it("renders for a manager and an admin", async () => {
    signedIn(activeSession({ level: "SENIOR_MANAGER" }));
    expect(await renderHtml(await OnboardPage(params()))).toContain("Onboard a client");
    signedIn(activeSession({ role: "ADMIN" }));
    expect(await renderHtml(await OnboardLayout({ children: null }))).toContain("Firm OS");
  });

  it("an unknown ?run= falls back to a fresh form (looked up, not trusted)", async () => {
    const html = await renderHtml(await OnboardPage(params("run-missing")));
    expect(html).toContain("Client in one sentence");
    expect(prismaCalls.some((c) => c.model === "onboardingRun" && c.method === "findUnique")).toBe(true);
    prismaCalls.length = 0;
    await OnboardPage(params("../../etc"));
    expect(prismaCalls).toEqual([]);
  });

  it("redirects staff to the dashboard and signed-out visitors to sign-in", async () => {
    signedIn(activeSession()); // EXECUTIVE
    expect(await redirectTarget(() => OnboardLayout({ children: null }))).toBe("/dashboard");
    expect(await redirectTarget(() => OnboardPage(params()))).toBe("/dashboard");
    signedIn(activeSession({ level: "PARTNER", active: false }));
    expect(await redirectTarget(() => OnboardPage(params()))).toBe("/dashboard");
    signedIn(null);
    expect(await redirectTarget(() => OnboardLayout({ children: null }))).toBe("/");
    expect(await redirectTarget(() => OnboardPage(params()))).toBe("/");
  });

  it("the Tools grid links to /onboard for partners only", async () => {
    expect(await renderHtml(await ToolsIndex())).toContain('href="/onboard"');
    signedIn(activeSession());
    expect(await renderHtml(await ToolsIndex())).not.toContain('href="/onboard"');
  });
});
