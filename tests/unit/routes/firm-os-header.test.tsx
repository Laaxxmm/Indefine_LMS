// The one Firm OS header (src/components/FirmOsHeader.tsx): the same width and labels on every
// Firm OS page — four places on the bar, the rest under More, one Menu on a phone — filtered by
// module and role, the current section marked with aria-current, a Search icon for the command
// palette and Help for the page; and the palette itself, mounted once in the root layout and only
// for people with the Search module on.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { Session } from "next-auth";
import { MODULE_KEYS, type ModuleKey } from "@/lib/workspace/registry";
import { activeSession, renderHtml as renderRaw, workspaceRow } from "./harness";

const state = vi.hoisted(() => ({ pathname: "/", setting: null as unknown }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
// next/font is compiled by Next; here it only has to hand back the class names.
vi.mock("next/font/google", () => ({ Plus_Jakarta_Sans: () => ({ variable: "font-sans-var" }), Schibsted_Grotesk: () => ({ variable: "font-display-var" }) }));
vi.mock("next/navigation", async () => ({ ...(await import("./harness")).navigationMock, usePathname: () => state.pathname }));
vi.mock("@/lib/prisma", async () => {
  const { prismaMock, withWorkspace } = await import("./harness");
  return { prisma: withWorkspace(prismaMock, { setting: () => state.setting }) };
});

const { auth } = await import("@/lib/auth");
const { firmOsNav } = await import("@/lib/workspace/nav");
const { isCurrentSection } = await import("@/components/NavLink");
const { FirmOsHeader } = await import("@/components/FirmOsHeader");
const { CommandPalette } = await import("@/components/CommandPalette");
const { default: RootLayout } = await import("@/app/layout");

const as = (s: Session | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const renderHtml = async (el: ReactElement) => (await renderRaw(el)).replace(/<!-- -->/g, "");
const STAFF = activeSession();
const MANAGER = activeSession({ level: "MANAGER" });
const PARTNER = activeSession({ level: "PARTNER" });
const ADMIN = activeSession({ role: "ADMIN" });
const ALL = [...MODULE_KEYS];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** "label href" for every link in a piece of HTML. */
const linksIn = (chunk: string) =>
  [...chunk.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(?:<svg[\s\S]*?<\/svg>)?\s*([^<]+)<\/a>/g)].map((m) => `${m[2].trim()} ${m[1]}`);
/** The header's nav landmark. */
const navOf = (html: string) => html.match(/<nav aria-label="Firm OS"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
/** The nav as a screen from 1024 px shows it: everything before the phone menu. */
const desktopOf = (html: string) => navOf(html).split('<div class="relative lg:hidden">')[0];
/** The links on the bar itself (not inside a menu), as "label href". */
const barLinks = (html: string) => linksIn(desktopOf(html).replace(/<div id="[^"]+" hidden=""[\s\S]*?<\/ul><\/div><\/div>/g, ""));
/** The links inside the menu whose button says `label` ("More", "Menu"), or null when there is no such menu. */
function menuLinks(html: string, label: string): string[] | null {
  const id = html.match(new RegExp(`aria-controls="([^"]+)"[^>]*>(?:<svg[\\s\\S]*?</svg>)?${label}<svg`))?.[1];
  if (!id) return null;
  const panel = html.match(new RegExp(`<div id="${esc(id)}"[^>]*>([\\s\\S]*?</ul></div>)</div>`))?.[1] ?? "";
  return linksIn(panel);
}
/** Marked places on the desktop bar and in More, as "label=page" (its own page) or "label=true" (a page below it). */
const current = (html: string) => [...desktopOf(html).matchAll(/<a [^>]*aria-current="(page|true)"[^>]*>([^<]+)<\/a>/g)].map((m) => `${m[2]}=${m[1]}`);
const header = async (who: Session, modules: ModuleKey[] | null = null) => {
  state.setting = modules ? workspaceRow(modules) : null;
  return renderHtml(await FirmOsHeader({ user: who.user, home: "/agents" }));
};
const O = (companion: boolean) => ({ companion });

beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
  state.pathname = "/";
  state.setting = null;
});
afterEach(() => vi.unstubAllEnvs());

describe("firmOsNav: the places, by module and role", () => {
  it("everything on, partner: four on the bar (Next task, Agents, My day, Client messages); More holds Onboard client, Spot checks, Companion; then Search", () => {
    const nav = firmOsNav(PARTNER.user, ALL, O(true));
    expect(nav.primary.map((l) => `${l.label} ${l.href}`)).toEqual(["Next task /focus", "Agents /agents", "My day /coach", "Client messages /comms"]);
    expect(nav.more.map((l) => `${l.label} ${l.href}`)).toEqual(["Onboard client /onboard", "Spot checks /agents/spot-checks", "Companion /companion"]);
    expect(nav.search).toBe(true);
  });

  it("the same labels for everyone: Agents is never 'Agent runs', Spot checks always plural", () => {
    for (const who of [STAFF, MANAGER, PARTNER, ADMIN]) {
      const labels = [...firmOsNav(who.user, ALL, O(true)).primary, ...firmOsNav(who.user, ALL, O(true)).more].map((l) => l.label);
      expect(labels, who.user.level).toContain("Agents");
      expect(labels.join("|")).not.toMatch(/Agent runs|Firm OS onboarding|Spot check(?!s)/);
    }
  });

  it("spot checks only for partners; the companion only when allowed; each place only with its module", () => {
    const all = (who: Session, mods: ModuleKey[], c: boolean) => [...firmOsNav(who.user, mods, O(c)).primary, ...firmOsNav(who.user, mods, O(c)).more].map((l) => l.label);
    expect(all(MANAGER, ALL, false)).not.toContain("Spot checks");
    expect(all(ADMIN, ALL, false)).not.toContain("Spot checks"); // an IT admin is not a partner
    expect(all(PARTNER, ALL, false)).not.toContain("Companion");
    expect(firmOsNav(PARTNER.user, ["coach"], O(false))).toEqual({ primary: [{ href: "/coach", label: "My day" }], more: [], search: false });
    expect(all(PARTNER, ["comms", "search"], false)).toEqual(["Client messages"]);
    expect(firmOsNav(PARTNER.user, [], O(false))).toEqual({ primary: [], more: [], search: false });
  });
});

describe("current section", () => {
  it("Next task covers the guided workspace; Agents stops where Spot checks starts", () => {
    const next = { also: ["/workspace"] };
    expect(isCurrentSection("/focus", "/focus", false, next)).toBe(true);
    expect(isCurrentSection("/workspace/job-1", "/focus", false, next)).toBe(true);
    const agents = { except: ["/agents/spot-checks"] };
    expect(isCurrentSection("/agents/echo/runs/r1", "/agents", false, agents)).toBe(true);
    expect(isCurrentSection("/agents/spot-checks", "/agents", false, agents)).toBe(false);
    expect(isCurrentSection("/agents/spot-checksx", "/agents", false, agents)).toBe(true);
  });

  it("the header marks exactly one place: aria-current=page on its own page, =true below it; a place in More marks the More button too", async () => {
    for (const [path, label] of [
      ["/focus", "Next task=page"],
      ["/workspace/job-1", "Next task=true"],
      ["/agents", "Agents=page"],
      ["/agents/echo/runs/r1", "Agents=true"],
      ["/agents/spot-checks", "Spot checks=page"],
      ["/coach", "My day=page"],
      ["/comms/d-1", "Client messages=true"],
      ["/onboard", "Onboard client=page"],
    ]) {
      state.pathname = path;
      expect(current(await header(PARTNER)), path).toEqual([label]);
    }
    state.pathname = "/onboard";
    expect(await header(PARTNER)).toMatch(/aria-controls="[^"]+" class="[^"]*bg-brand-50[^"]*">More<svg/);
    state.pathname = "/coach";
    expect(await header(PARTNER)).toMatch(/aria-controls="[^"]+" class="[^"]*">More<svg/);
    expect(await header(PARTNER)).not.toMatch(/aria-controls="[^"]+" class="[^"]*bg-brand-50[^"]*">More<svg/);
    state.pathname = "/search";
    expect(current(await header(PARTNER))).toEqual([]); // Search is a button, not a place
  });
});

describe("the header", () => {
  it("built-in staff modules: Next task, Agents, My day on the bar, no More (nothing in it), the Search button and the way back", async () => {
    const html = await header(STAFF);
    expect(barLinks(html)).toEqual(["Next task /focus", "Agents /agents", "My day /coach", "Dashboard /dashboard"]);
    expect(menuLinks(html, "More")).toBeNull();
    expect(html).toContain('aria-label="Search"');
  });

  it("built-in partner modules: four places on the bar, More with Onboard client, Spot checks and the Companion (partners may pair)", async () => {
    const html = await header(PARTNER);
    expect(barLinks(html)).toEqual(["Next task /focus", "Agents /agents", "My day /coach", "Client messages /comms", "Dashboard /dashboard"]);
    expect(menuLinks(html, "More")).toEqual(["Onboard client /onboard", "Spot checks /agents/spot-checks", "Companion /companion"]);
  });

  it("on a phone one Menu holds the same places in the same order with the same labels, then Dashboard", async () => {
    const html = await header(PARTNER);
    expect(menuLinks(html, "Menu")).toEqual([
      "Next task /focus",
      "Agents /agents",
      "My day /coach",
      "Client messages /comms",
      "Onboard client /onboard",
      "Spot checks /agents/spot-checks",
      "Companion /companion",
      "Dashboard /dashboard",
    ]);
    // The bar's places are hidden below 1024 px and the Menu above it, so each width shows one set.
    expect(desktopOf(html)).toMatch(/class="[^"]*hidden lg:inline-flex" href="\/focus"/);
    expect(navOf(html)).toContain('<div class="relative lg:hidden">');
    expect(navOf(html)).toContain('<div class="relative hidden lg:block">');
  });

  it("follows the person's own modules: Search off → no Search button; the companion only when allowed", async () => {
    const html = await header(MANAGER, ["coach", "comms"]);
    expect(barLinks(html)).toEqual(["My day /coach", "Client messages /comms", "Dashboard /dashboard"]);
    expect(html).not.toContain('aria-label="Search"');
    state.setting = workspaceRow(["agents"], { companionEnabled: true });
    const staff = await renderHtml(await FirmOsHeader({ user: STAFF.user, home: "/focus" }));
    expect(barLinks(staff)).toEqual(["Next task /focus", "Agents /agents", "Dashboard /dashboard"]);
    expect(menuLinks(staff, "More")).toEqual(["Companion /companion"]);
  });

  it("menus are buttons that say whether they are open and which panel they open; the panel is hidden until opened", async () => {
    const html = await header(PARTNER);
    for (const label of ["More", "Menu"]) {
      const m = html.match(new RegExp(`<button type="button" aria-expanded="false" aria-controls="([^"]+)" class="([^"]*)">(?:<svg[\\s\\S]*?</svg>)?${label}<svg`));
      expect(m, label).not.toBeNull();
      expect(m![2]).toContain("focus-visible:ring-2");
      expect(html).toMatch(new RegExp(`<div id="${esc(m![1])}" hidden=""`));
    }
  });

  it("Help shows for a page with help (every Firm OS page), with the dialog it opens named", async () => {
    state.pathname = "/";
    expect(await header(PARTNER)).not.toMatch(/aria-haspopup="dialog"/); // no help for this path
    state.pathname = "/agents";
    const html = await header(PARTNER);
    expect(html).toMatch(/<button type="button" aria-haspopup="dialog" aria-expanded="false" title="Help for Agents"/);
    expect(html).toMatch(/<span class="sr-only lg:not-sr-only">Help<\/span>/); // an icon on a phone, still named Help
  });

  it("calm and accessible: labelled landmark, focus rings, AA text, no emoji, the Search button names its shortcut", async () => {
    const html = await header(PARTNER);
    expect(html).toContain('<nav aria-label="Firm OS"');
    expect(html).toContain("focus-visible:ring-2");
    expect(html).not.toContain("text-ink-faint");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).toMatch(/<button type="button" aria-label="Search" aria-keyshortcuts="Control\+K Meta\+K"/);
    expect(html).toContain("Ctrl K");
    expect(html).toContain(">Firm OS</p>");
  });

  it("one width everywhere: the header row is the 1280 page box, whatever the page", async () => {
    const html = await header(PARTNER);
    expect(html).toMatch(/<header[^>]*><div class="max-w-\[1280px\] mx-auto px-4 sm:px-8 py-3/);
    // No layout narrows it any more (focus did, to 768).
    for (const p of ["agents", "onboard", "coach", "comms", "search", "focus", "workspace", "companion"]) {
      const src = readFileSync(join(process.cwd(), "src", "app", p, "layout.tsx"), "utf8");
      expect(src, p).toMatch(/<FirmOsHeader user=\{session\.user\} home="\/[a-z]+" \/>/);
      expect(src, p).toMatch(/<main className=\{pageMain\}>/);
    }
  });

  it("every Firm OS layout shows the same header for the same person", async () => {
    as(PARTNER);
    state.setting = workspaceRow(ALL);
    const layouts = await Promise.all(
      ["agents", "onboard", "coach", "comms", "search", "focus", "workspace", "companion"].map(async (p) => [p, (await import(`@/app/${p}/layout`)).default] as const),
    );
    const seen = new Map<string, string>();
    for (const [name, Layout] of layouts) {
      const html = await renderHtml(await Layout({ children: null }));
      // The nav without React's generated ids, which differ per render.
      seen.set(name, navOf(html).replace(/"«?[^"]*[:«»][^"]*»?"/g, '"id"'));
    }
    const first = seen.get("agents")!;
    expect(first).toContain('aria-label="Search"');
    for (const [name, nav] of seen) expect(nav, name).toEqual(first);
  });
});

// ------------------------------------------------------------------ command palette

/** How many elements of `type` the tree holds (plain elements only; the root layout has no components in between). */
function count(node: ReactNode, type: unknown): number {
  if (Array.isArray(node)) return node.reduce((n: number, c: ReactNode) => n + count(c, type), 0);
  if (!isValidElement(node)) return 0;
  const props = node.props as { children?: ReactNode };
  return (node.type === type ? 1 : 0) + count(props.children, type);
}

describe("the command palette", () => {
  it("is mounted once, in the root layout, for people with the Search module on", async () => {
    as(STAFF);
    expect(count(await RootLayout({ children: <main /> }), CommandPalette)).toBe(1);
  });

  it("is not mounted when Search is off for the person, when Firm OS is off, or when signed out", async () => {
    as(STAFF);
    state.setting = workspaceRow(["agents", "learning"]);
    expect(count(await RootLayout({ children: <main /> }), CommandPalette)).toBe(0);
    state.setting = null;
    vi.stubEnv("FIRM_OS_ENABLED", "");
    expect(count(await RootLayout({ children: <main /> }), CommandPalette)).toBe(0);
    vi.stubEnv("FIRM_OS_ENABLED", "1");
    as(null);
    expect(count(await RootLayout({ children: <main /> }), CommandPalette)).toBe(0);
    as(activeSession({ active: false }));
    expect(count(await RootLayout({ children: <main /> }), CommandPalette)).toBe(0); // its role rule
  });

  it("no other file mounts it", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(f)) files.push(p);
      }
    };
    walk(join(process.cwd(), "src"));
    const mounting = files
      .filter((f) => !f.endsWith("CommandPalette.tsx") && /<CommandPalette\b/.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(process.cwd().length + 1).replace(/\\/g, "/"));
    expect(mounting).toEqual(["src/app/layout.tsx"]);
  });
});
