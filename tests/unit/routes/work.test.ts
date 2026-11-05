// Smoke: /work renders behind a signed-in session and bounces signed-out visitors to "/".
// /work is limited to WORK_TRACKER_EMAILS; the smoke user is put on that list.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundSignal, TEST_EMAIL, activeSession, redirectTarget, renderHtml } from "./harness";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);

const { auth } = await import("@/lib/auth");
const { default: WorkLayout } = await import("@/app/work/layout");
const { default: TodayPage } = await import("@/app/work/page");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);

describe("/work", () => {
  beforeEach(() => {
    vi.stubEnv("WORK_TRACKER_EMAILS", `lead@indefine.test,${TEST_EMAIL}`);
    signedIn(activeSession());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T04:30:00Z")); // Wednesday 10:00 IST: a working day
  });
  afterEach(() => vi.useRealTimers());

  it("renders Today inside the layout for a tracker member", async () => {
    // Empty database on a weekday: nothing assigned, so the gate lands on Today's empty state.
    const page = await TodayPage();
    const html = await renderHtml(await WorkLayout({ children: page }));
    expect(html).toContain("Tech work");
    expect(html).toContain("Wednesday, 4 November");
    expect(html).toContain("Nothing assigned yet");
    expect(html).toContain("Capture an idea");
  });

  it("redirects a signed-out visitor to sign-in (layout and page both guard)", async () => {
    signedIn(null);
    expect(await redirectTarget(() => WorkLayout({ children: null }))).toBe("/");
    expect(await redirectTarget(() => TodayPage())).toBe("/");
  });

  it("hides the module (404) from a signed-in user who is not on the tracker list", async () => {
    signedIn(activeSession({ email: "someone.else@indefine.test" }));
    await expect(WorkLayout({ children: null })).rejects.toBeInstanceOf(NotFoundSignal);
  });
});
