// Route smoke for /coach (layout + page), the dashboard "My day" card and the Firm OS nav links:
// full server render behind a mocked session, against the in-memory coach world.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDayKey } from "@/lib/ist";
import { CoachWorld } from "../../fakes/coach-world";
import { activeSession, redirectTarget, renderHtml as renderRaw } from "./harness";

// Firm OS switched on for these tests (FIRM_OS_ENABLED defaults off: src/lib/workspace/flag.ts).
beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

let w: CoachWorld;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
// The layouts read the workspace settings: none saved, so the built-in role defaults apply.
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));
vi.mock("@/lib/agents/coach/defaults", () => ({ coachDb: () => w.db, coachDeps: () => ({ db: w.db }) }));

const { auth } = await import("@/lib/auth");
const { default: Layout } = await import("@/app/coach/layout");
const { default: CoachPage } = await import("@/app/coach/page");
const { CoachCard } = await import("@/app/coach/CoachCard");
const { default: AgentsLayout } = await import("@/app/agents/layout");
const { default: OnboardLayout } = await import("@/app/onboard/layout");

const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const renderHtml = async (el: Parameters<typeof renderRaw>[0]) => (await renderRaw(el)).replace(/<!-- -->/g, "");
const day = (k: string) => parseDayKey(k) as Date;
const EMOJI = /\p{Extended_Pictographic}/u;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-04T10:00:00+05:30")); // Wednesday
  w = new CoachWorld();
  w.addUser("u-priya", { name: "Priya S", managerId: "u-meena" });
  w.addUser("u-meena", { name: "Meena R", level: "MANAGER" });
  signedIn(activeSession({ id: "u-priya", name: "Priya S" }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("guards", () => {
  it("signed out → sign-in; inactive → dashboard", async () => {
    signedIn(null);
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/");
    expect(await redirectTarget(() => CoachPage())).toBe("/");
    signedIn(activeSession({ active: false }));
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/dashboard");
  });
});

describe("/coach", () => {
  it("layout: the Firm OS header with My day, Agents and the way back to the dashboard", async () => {
    const html = await renderHtml(await Layout({ children: null }));
    expect(html).toContain('aria-label="Firm OS"');
    expect(html).toContain('href="/coach"');
    expect(html).toContain(">My day<");
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/dashboard"');
  });

  it("ranked board with reasons, dates DD MMM YYYY and links to where the work is done; no scores, no emoji", async () => {
    const overdue = w.addJob({ title: "GSTR-1", state: "IN_PREP", internalDueOn: day("2026-11-03"), statutoryDueOn: day("2026-11-11") });
    w.addJob({ title: "GSTR-3B", state: "AGENT_DONE", internalDueOn: day("2026-11-06"), firmClient: { clientCode: "BETA02", client: { name: "Beta Foods" } } });
    const run = w.addRun(w.jobTask.rows[1].id as string, "gst", new Date("2026-11-03T05:00:00Z"));
    w.addJob({ title: "AOC-4", service: "ROC", state: "ASSIGNED", internalDueOn: day("2026-12-15") });
    w.addJob({ title: "TDS Q2", service: "TDS", state: "CLOSING" });
    w.coachEvent.insert({ userId: "u-priya", kind: "reminder", jobTaskId: overdue.id, dedupeKey: "r1", payload: { message: "GSTR-1 2026-10 for ACME01 is due internally today at 18:00 IST, in about 2 hours." } });

    const html = await renderHtml(await CoachPage());
    expect(html).toContain("<h1");
    expect(html).toContain(">My day</h1>");
    for (const id of ["notices", "must-today", "this-week", "everything-else", "filed", "your-week", "settings"]) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Internal due 03 Nov 2026 has passed");
    expect(html).toContain('href="/agents#waiting"');
    expect(html).toContain(`href="/agents/gst/runs/${run.id}"`);
    expect(html).toContain("Open pack to submit");
    expect(html).toContain("11 Nov 2026");
    expect(html).toContain("Filed, waiting to close");
    expect(html).toContain("in about 2 hours");
    expect(html).toContain(">Dismiss<");
    expect(html).not.toMatch(/score/i);
    expect(EMOJI.test(html)).toBe(false);
    // Must today lists the overdue job before anything else.
    expect(html.indexOf("GSTR-1")).toBeLessThan(html.indexOf("GSTR-3B"));
  });

  it("empty states for someone with no jobs; break controls hidden while the firm has them off", async () => {
    const html = await renderHtml(await CoachPage());
    expect(html).toContain("Nothing must be done today");
    expect(html).toContain("Nothing else due this week");
    expect(html).toContain("No summary yet");
    expect(html).toContain("Break reminders are not turned on for the firm");
    expect(html).not.toContain("Your team");
  });

  it("break controls when the firm turns them on: on/off and snooze 30 / 60 min", async () => {
    vi.stubEnv("FIRM_OS_BREAK_NUDGE", "1");
    const html = await renderHtml(await CoachPage());
    expect(html).toContain("at most 3 a day");
    expect(html).toContain("Snooze 30 min");
    expect(html).toContain("Snooze 60 min");
    expect(html).toContain("Only you see it");
  });

  it("a manager sees each report's weekly summary and nothing about their breaks", async () => {
    w.coachEvent.insert({
      userId: "u-priya",
      kind: "summary",
      dedupeKey: "summary:u-priya:2026-11-02",
      payload: { weekOf: "2026-11-02", done: 3, medianMs: 26 * 3600_000, bottleneck: { stage: "review", label: "Review", share: 0.4 }, open: 4, overdue: 1, message: "Week of 02 Nov 2026: 3 jobs done." },
    });
    w.coachEvent.insert({ userId: "u-priya", kind: "break", dedupeKey: "break:u-priya:2026-11-04:1", payload: { message: "You have been working for about 1 h 41 min without a pause." } });
    signedIn(activeSession({ id: "u-meena", name: "Meena R", level: "MANAGER" }));
    const html = await renderHtml(await CoachPage());
    expect(html).toContain("Your team&#x27;s week");
    expect(html).toContain("Priya S");
    expect(html).toContain("1d 2h");
    expect(html).toContain("02 Nov 2026");
    expect(html).not.toContain("without a pause");

    signedIn(activeSession({ id: "u-priya", name: "Priya S" }));
    const own = await renderHtml(await CoachPage());
    expect(own).toContain("Week of 02 Nov 2026: 3 jobs done.");
    expect(own).toContain("Visible to you and your manager");
  });
});

describe("dashboard card", () => {
  it("shows the top of the board to someone with Firm OS jobs, linking to /coach", async () => {
    w.addJob({ title: "GSTR-1", state: "IN_PREP", internalDueOn: day("2026-11-04") });
    const html = await renderHtml((await CoachCard({ userId: "u-priya" }))!);
    expect(html).toContain('id="my-day"');
    expect(html).toContain("Must today · 1");
    expect(html).toContain('href="/coach"');
    expect(html).toContain("Internal due today");
    expect(EMOJI.test(html)).toBe(false);
  });

  it("this week when nothing is due today; nothing at all without jobs", async () => {
    w.addJob({ title: "GSTR-3B", state: "IN_PREP", internalDueOn: day("2026-11-06") });
    w.addJob({ title: "TDS Q2", state: "CLOSING" });
    const html = await renderHtml((await CoachCard({ userId: "u-priya" }))!);
    expect(html).toContain("This week · 1");
    expect(html).toContain("1 filed and waiting to close");
    expect(await CoachCard({ userId: "u-meena" })).toBeNull();
  });
});

describe("Firm OS nav links to /coach", () => {
  it("from /agents and /onboard", async () => {
    expect(await renderHtml(await AgentsLayout({ children: null }))).toContain('href="/coach"');
    signedIn(activeSession({ id: "u-p", level: "PARTNER" }));
    expect(await renderHtml(await OnboardLayout({ children: null }))).toContain('href="/coach"');
  });
});
