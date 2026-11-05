// Smoke: /dashboard renders behind a signed-in session and bounces signed-out visitors to "/".
// The page runs the real KRA, streak, trajectory and check-in code against an empty database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, prismaCalls, redirectTarget, renderHtml } from "./harness";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);

const { auth } = await import("@/lib/auth");
const { default: Dashboard } = await import("@/app/dashboard/page");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);

describe("/dashboard", () => {
  beforeEach(() => {
    signedIn(activeSession());
    prismaCalls.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T04:30:00Z")); // Wednesday 10:00 IST
  });
  afterEach(() => vi.useRealTimers());

  it("renders for an active employee with no training yet", async () => {
    const html = await renderHtml(await Dashboard());
    expect(html).toContain("Smoke"); // greets the user by name
    expect(html).toContain('id="courses"');
    // Visiting the dashboard records today's activity before computing the streak.
    expect(prismaCalls.some((c) => c.model === "dailyActivity" && c.method === "upsert")).toBe(true);
  });

  it("renders for an admin", async () => {
    signedIn(activeSession({ role: "ADMIN" }));
    const html = await renderHtml(await Dashboard());
    expect(html.length).toBeGreaterThan(1000);
  });

  it("redirects a signed-out visitor to sign-in", async () => {
    signedIn(null);
    expect(await redirectTarget(() => Dashboard())).toBe("/");
  });
});
