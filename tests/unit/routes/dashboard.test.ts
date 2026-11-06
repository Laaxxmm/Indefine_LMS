// Smoke: /dashboard renders behind a signed-in session and bounces signed-out visitors to "/".
// The page runs the real KRA, streak, trajectory and check-in code against an empty database.
// Its links and sections follow the person's workspace modules (role rules, the Firm OS master
// switch FIRM_OS_ENABLED, the workspace settings); in focus mode the next task is the landing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { activeSession, prismaCalls, redirectTarget, renderHtml as renderRaw, workspaceRow } from "./harness";

const ws = vi.hoisted(() => ({ setting: null as unknown }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => {
  const { prismaMock, withWorkspace } = await import("./harness");
  return { prisma: withWorkspace(prismaMock, { setting: () => ws.setting }) };
});
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);

const { auth } = await import("@/lib/auth");
const { default: Dashboard } = await import("@/app/dashboard/page");
const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const renderHtml = async (el: Parameters<typeof renderRaw>[0]) => (await renderRaw(el)).replace(/<!-- -->/g, "");
const page = async (sp: Record<string, string> = {}) => renderHtml(await Dashboard({ searchParams: Promise.resolve(sp) }));

/** The header's links after Home, as label → href, in order (as the bar shows them from 640 px, menus included). */
async function navOf(html: string): Promise<string[]> {
  const nav = (html.match(/<nav aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "").split('<div class="relative sm:hidden">')[0];
  return [...nav.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => `${m[2]} ${m[1]}`);
}
/** The phone Menu's links, in order. */
function phoneMenuOf(html: string): string[] {
  const menu = (html.match(/<nav aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "").split('<div class="relative sm:hidden">')[1] ?? "";
  return [...menu.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => `${m[2]} ${m[1]}`);
}
/** The bar's own buttons and links (not inside a menu): "Learn ▾", "Tools", … */
function barOf(html: string): string[] {
  const nav = (html.match(/<nav aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "").split('<div class="relative sm:hidden">')[0].replace(/<div id="[^"]+" hidden=""[\s\S]*?<\/ul><\/div><\/div>/g, "");
  return [...nav.matchAll(/<a [^>]*>([^<]+)<\/a>|<button [^>]*aria-expanded[^>]*>([^<]+)<svg/g)].map((m) => (m[2] ? `${m[2]} ▾` : m[1]));
}
const FIRM_OS_HREF = /href="\/(agents|coach|focus|comms|search|onboard|workspace|companion)\b/;
const FIRM_OS_MODELS = new Set(["jobTask", "agentRun", "checklistResult", "sopPack", "commsDraft", "coachEvent", "coachPreference", "activityHeartbeat"]);
const as = (s: Session) => signedIn(s);
const SEARCH_BUTTON = 'aria-keyshortcuts="Control+K Meta+K"';

describe("/dashboard", () => {
  beforeEach(() => {
    signedIn(activeSession());
    prismaCalls.length = 0;
    ws.setting = null;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T04:30:00Z")); // Wednesday 10:00 IST
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("renders for an active employee with no training yet", async () => {
    const html = await renderHtml(await Dashboard({}));
    expect(html).toContain("Smoke"); // greets the user by name
    expect(html).toContain('id="courses"');
    // Visiting the dashboard records today's activity before computing the streak.
    expect(prismaCalls.some((c) => c.model === "dailyActivity" && c.method === "upsert")).toBe(true);
  });

  it("renders for an admin", async () => {
    signedIn(activeSession({ role: "ADMIN" }));
    const html = await renderHtml(await Dashboard({}));
    expect(html.length).toBeGreaterThan(1000);
  });

  it("redirects a signed-out visitor to sign-in", async () => {
    signedIn(null);
    expect(await redirectTarget(() => Dashboard({}))).toBe("/");
  });

  describe("Firm OS switched off (the default)", () => {
    it("the LMS links as before for every role (staff keep Clients), no Firm OS link, card or query", async () => {
      for (const who of [activeSession(), activeSession({ level: "MANAGER" }), activeSession({ level: "PARTNER" }), activeSession({ role: "ADMIN" })]) {
        as(who);
        prismaCalls.length = 0;
        const html = await page();
        expect(await navOf(html)).toEqual(["Courses /dashboard#courses", "Leaderboard /leaderboard", "Check-in /checkin", "Recap /recap/year", "Tools /tools", "Clients /clients"]);
        expect(barOf(html)).toEqual(["Learn ▾", "Tools", "Clients"]); // no Firm OS menu
        expect(phoneMenuOf(html)).toEqual(await navOf(html));
        expect(html).not.toMatch(FIRM_OS_HREF);
        expect(html).not.toContain(SEARCH_BUTTON); // no command palette without Firm OS
        expect(prismaCalls.filter((c) => FIRM_OS_MODELS.has(c.model))).toEqual([]);
      }
    });

    it("a person sent back from a Firm OS page reads why", async () => {
      const html = await page({ "module-off": "firm-os" });
      expect(html).toContain("Firm OS is not switched on for the firm yet. Everything else works as before; ask an admin if you expected to use it.");
    });

    it("an inactive person gets no Clients link (its own rule)", async () => {
      as(activeSession({ active: false }));
      expect(await navOf(await page())).not.toContain("Clients /clients");
    });
  });

  describe("Firm OS switched on: links follow the workspace modules", () => {
    beforeEach(() => vi.stubEnv("FIRM_OS_ENABLED", "1"));

    it("built-in staff modules: the LMS, Tools, Next task, Agents and My day; not Clients or Client messages; the Search button", async () => {
      const html = await page();
      expect(html).toContain(SEARCH_BUTTON);
      ws.setting = workspaceRow(["learning", "agents"]);
      expect(await page()).not.toContain(SEARCH_BUTTON); // Search off for this person
      ws.setting = null;
      expect(await navOf(html)).toEqual([
        "Courses /dashboard#courses",
        "Leaderboard /leaderboard",
        "Check-in /checkin",
        "Recap /recap/year",
        "Tools /tools",
        "Next task /focus",
        "Agents /agents",
        "My day /coach",
      ]);
      // Grouped on the bar: the learning pages under Learn, the Firm OS places under Firm OS; a phone gets one Menu with the same links.
      expect(barOf(html)).toEqual(["Learn ▾", "Tools", "Firm OS ▾"]);
      expect(phoneMenuOf(html)).toEqual(await navOf(html));
      expect(html).toContain('<nav aria-label="Main" data-tour="leaderboard"'); // the tour points at the bar, seen at every width
    });

    it("built-in manager modules add Clients and Client messages; the work tracker still needs its allow-list", async () => {
      as(activeSession({ level: "MANAGER" }));
      const links = await navOf(await page());
      expect(links).toContain("Clients /clients");
      expect(links).toContain("Client messages /comms");
      expect(links).not.toContain("Work /work");
      vi.stubEnv("WORK_TRACKER_EMAILS", "smoke.user@indefine.test");
      expect(await navOf(await page())).toContain("Work /work");
    });

    it("each module shows only its own links and sections", async () => {
      const cases: [string[], string[]][] = [
        [["learning"], ["Courses /dashboard#courses"]],
        [["leaderboard"], ["Leaderboard /leaderboard", "Check-in /checkin", "Recap /recap/year"]],
        [["tools"], ["Tools /tools"]],
        [["clients"], ["Clients /clients"]],
        [["agents"], ["Next task /focus", "Agents /agents"]],
        [["coach"], ["My day /coach"]],
        [["comms"], ["Client messages /comms"]],
        [[], []],
      ];
      as(activeSession({ level: "MANAGER" }));
      for (const [modules, links] of cases) {
        ws.setting = workspaceRow(modules);
        const html = await page();
        expect(await navOf(html), modules.join(",") || "none").toEqual(links);
        expect(html.includes('id="courses"'), `courses section with ${modules}`).toBe(modules.includes("learning"));
        expect(html.includes("Achievements"), `badges with ${modules}`).toBe(modules.includes("learning") || modules.includes("leaderboard"));
      }
      ws.setting = workspaceRow([]);
      expect(await page()).toContain("Good"); // the greeting stays when everything is off
    });

    it("a switched-on module never adds a link the role may not use", async () => {
      as(activeSession({ active: false }));
      ws.setting = workspaceRow(["clients", "agents", "coach", "comms", "search", "learning"]);
      expect(await navOf(await page())).toEqual(["Courses /dashboard#courses"]);
    });

    it("the dashboard says why a module sent the person back", async () => {
      expect(await page({ "module-off": "clients" })).toContain("Clients is turned off for your account. If you need it, ask an admin to turn it on in Workspace settings.");
      expect(await page({ "module-off": "nonsense" })).not.toContain('role="status"');
    });

    it("no Firm OS jobs → no My day card; the coach card and its query only with the coach module", async () => {
      const html = await page();
      expect(html).not.toContain('id="my-day"');
      ws.setting = workspaceRow(["learning"]);
      prismaCalls.length = 0;
      await page();
      expect(prismaCalls.filter((c) => FIRM_OS_MODELS.has(c.model))).toEqual([]);
    });

    it("focus mode: the next task is the one card, linking to /focus; everything else waits behind Show everything", async () => {
      ws.setting = workspaceRow(null, { focusMode: true });
      const html = await page();
      expect(html).toContain(">Your next task</p>");
      expect(html).toContain("Everything is up to date"); // nothing is assigned in the empty database
      expect(html).toContain("Nothing is waiting for you right now.");
      expect(html).toMatch(/<a [^>]*href="\/focus"[^>]*>Open Next task/);
      expect(html.match(/<h1\b/g)).toHaveLength(1); // the card carries the page's one h1; the greeting steps down
      const card = html.indexOf('aria-labelledby="next-task-heading"');
      const details = html.indexOf("<details");
      expect(card).toBeGreaterThan(-1);
      expect(details).toBeGreaterThan(card);
      expect(html).toMatch(/<summary[^>]*>Show everything/);
      expect(html.indexOf('id="courses"')).toBeGreaterThan(details); // the courses are inside the disclosure
    });

    it("focus mode without the Agents module: no next-task page to land on, so the normal dashboard", async () => {
      ws.setting = workspaceRow(["learning", "leaderboard"], { focusMode: true });
      const html = await page();
      expect(html).not.toContain("Your next task");
      expect(html).not.toContain("<details");
    });

    it("without focus mode there is no disclosure and no next-task read", async () => {
      prismaCalls.length = 0;
      const html = await page();
      expect(html).not.toContain("<details");
      expect(prismaCalls.some((c) => c.model === "jobTask" && c.method === "findMany" && JSON.stringify(c.args).includes("assigneeId"))).toBe(true); // the coach card's own lookup only
    });
  });
});
