// /focus: only the next task, its why, SOP steps, checklist and the one primary action per state;
// "Done? Show next task" re-asks; a quiet "Everything is up to date" state; same access as /agents
// and only while the Agents module is on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redirectTarget, renderHtml as renderRaw } from "./harness";
import { echoWorld, user, NOW, type World } from "../../fakes/agent-world";

// Firm OS switched on for these tests (FIRM_OS_ENABLED defaults off: src/lib/workspace/flag.ts).
beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const state = vi.hoisted(() => ({ world: null as unknown as World, setting: null as null | Record<string, unknown> }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return Object.assign(Object.create(state.world.db), {
      workspaceSetting: { findUnique: async () => state.setting },
      roleWorkspaceDefault: { findUnique: async () => null },
    });
  },
}));

const { auth } = await import("@/lib/auth");
const { default: Layout } = await import("@/app/focus/layout");
const { default: FocusPage } = await import("@/app/focus/page");

const as = (u: ReturnType<typeof user> | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? { user: u, expires: "2099-01-01" } : null);
const renderHtml = async (el: Parameters<typeof renderRaw>[0]) => (await renderRaw(el)).replace(/<!-- -->/g, "");
const page = async (sp: Record<string, string> = {}) => renderHtml(await FocusPage({ searchParams: Promise.resolve(sp) }));
const PRIMARY = /hover:bg-brand-600/g;
const PORTAL_OR_SEND = />\s*(Submit to portal|Send[^<]*|File on portal)\s*</i;

function seedRun(w: World) {
  w.db.seed("agentRun", [{ id: "run-1", jobTaskId: "job-1", agent: "echo", sopPackVersion: "1.0.0", status: "AGENT_DONE", startedAt: NOW }]);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  state.world = echoWorld();
  state.setting = null;
  vi.stubEnv("FIRM_OS_ECHO_AGENT", "1");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("layout", () => {
  it("the one Firm OS header at the page width, a narrow reading column inside the same page box; same access as /agents; the Agents module must be on", async () => {
    as(user("priya"));
    const html = await renderHtml(await Layout({ children: null }));
    expect(html).toContain('aria-label="Firm OS"');
    expect(html).toMatch(/href="\/focus"[^>]*>Next task<\/a>/);
    expect(html).toContain('href="/dashboard"');
    // The header and the page box are 1280 like every Firm OS page; only the content column is narrow, left-aligned.
    expect(html).toMatch(/<header[^>]*><div class="max-w-\[1280px\] mx-auto/);
    expect(html).toContain('<main class="max-w-[1280px] mx-auto px-4 sm:px-8 py-8"><div class="max-w-3xl">');
    as(null);
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/");
    as(user("priya", { active: false }));
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/dashboard");
    as(user("priya"));
    state.setting = { modules: ["search"], focusMode: true, companionEnabled: false };
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/dashboard?module-off=agents");
  });
});

describe("page", () => {
  it("shows one task: what it is, why it is next, SOP steps with the current one, the checklist and one primary action", async () => {
    as(user("priya"));
    const html = await page();
    expect(html).toContain(">Your next task</p>");
    expect(html).toContain(">Echo register</h1>");
    expect(html).toContain("Acme Pvt Ltd (ACME01) · Books");
    expect(html).toContain(">ASSIGNED<");
    expect(html).toContain("You prepare this job and it is ready for the agent. It has no due date yet.");
    expect(html).toContain("No due date set");
    expect(html).toContain('aria-label="Run agent: Echo register for ACME01"');
    expect(html.match(PRIMARY)?.length).toBe(1);
    expect(html).toMatch(/<li aria-current="step"[^>]*>.*Run Echo \(framework test\)/);
    expect(html).toContain("Step 1, current step: ");
    expect(html).toContain("Before you move on");
    expect(html).toContain("The documents the agent needs are in ClientDocs");
    expect(html).toContain('href="/workspace/job-1"');
    expect(html).toContain('href="/focus?after=job-1"');
    expect(html).toContain(">Done? Show next task</a>");
    expect(html).toContain("Nothing else is waiting after this one.");
    expect(html).not.toMatch(PORTAL_OR_SEND);
    expect(html).not.toContain("Open questions");
  });

  it("the primary action follows the state: submit, review, mark filed, record Turia close — each a link to the review screen", async () => {
    const cases = [
      { jobState: "AGENT_DONE", who: "priya", label: "Open pack to submit" },
      { jobState: "IN_REVIEW", who: "ravi", label: "Review pack" },
      { jobState: "APPROVED", who: "priya", label: "Mark filed" },
      { jobState: "FILED_BY_HUMAN", who: "priya", label: "Record Turia close" },
      { jobState: "CLOSING", who: "priya", label: "Record Turia close" },
    ] as const;
    for (const c of cases) {
      state.world = echoWorld({ jobState: c.jobState });
      seedRun(state.world);
      as(user(c.who));
      const html = await page();
      const link = html.match(new RegExp(`<a [^>]*aria-label="${c.label}: Echo register for ACME01"[^>]*>${c.label}</a>`))?.[0] ?? "";
      expect(link).toContain('href="/agents/echo/runs/run-1"');
      expect(html.match(PRIMARY)?.length).toBe(1);
      expect(html).toContain(`>${c.jobState}<`);
      expect(html).not.toMatch(PORTAL_OR_SEND);
    }
  });

  it("Done? Show next task: if the same job is still first, it says so plainly", async () => {
    as(user("priya"));
    const html = await page({ after: "job-1" });
    expect(html).toContain("This task still needs you: the job is ASSIGNED, and the next step is Run agent.");
    expect(await page({ after: "some-other-job" })).not.toContain("This task still needs you");
  });

  it("a portal-filed job carries the plain note and no portal link", async () => {
    state.world = echoWorld({ jobState: "APPROVED", service: "GST" });
    seedRun(state.world);
    as(user("priya"));
    const html = await page();
    expect(html).toContain("Do the filing on the portal in your browser. Keep this page open beside it; the companion side panel can show these steps next to the portal.");
    expect(html).toContain("You file it on the portal yourself. Firm OS never files, signs or pays.");
    expect(html).not.toMatch(/gov\.in|<iframe/);
  });

  it("nothing due: the quiet up-to-date state with no primary action", async () => {
    for (const who of ["ravi", "outsider", "partner"] as const) {
      as(user(who));
      const html = await page();
      expect(html).toContain(">Everything is up to date</h1>");
      expect(html).toContain("Nothing is waiting for you right now");
      expect(html).toContain('href="/focus"');
      expect(html.match(PRIMARY)).toBeNull();
    }
  });
});
