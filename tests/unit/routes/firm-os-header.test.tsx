// The one Firm OS header (src/components/FirmOsHeader.tsx): the same short set of places on every
// Firm OS page, filtered by module and role, the current section marked with aria-current, a
// Search button for the command palette; and the palette itself, mounted once in the root layout
// and only for people with the Search module on.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { Session } from "next-auth";
import { MODULE_KEYS, type ModuleKey } from "@/lib/workspace/registry";
import { activeSession, renderHtml as renderRaw, workspaceRow } from "./harness";

const state = vi.hoisted(() => ({ pathname: "/", setting: null as unknown }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
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

/** The header nav's entries as "label href" (links) or "label [button]". */
function navEntries(html: string): string[] {
  const nav = html.match(/<nav aria-label="Firm OS"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  return [...nav.matchAll(/<a [^>]*href="([^"]+)"[^>]*>(?:<svg[\s\S]*?<\/svg>)?\s*([^<]+)<\/a>|<button[^>]*>(?:<svg[\s\S]*?<\/svg>)?\s*([^<]+)<\/button>/g)].map((m) =>
    m[3] ? `${m[3].trim()} [button]` : `${m[2].trim()} ${m[1]}`,
  );
}
const current = (html: string) => [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
const header = async (who: Session, modules: ModuleKey[] | null = null) => {
  state.setting = modules ? workspaceRow(modules) : null;
  return renderHtml(await FirmOsHeader({ user: who.user, home: "/agents" }));
};

beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
  state.pathname = "/";
  state.setting = null;
});
afterEach(() => vi.unstubAllEnvs());

describe("firmOsNav: the places, by module and role", () => {
  it("everything on, partner: Next task, Agents, My day, Client messages, Firm OS onboarding, Spot checks, Companion, then Search", () => {
    const nav = firmOsNav(PARTNER.user, ALL, true);
    expect(nav.links.map((l) => `${l.label} ${l.href}`)).toEqual([
      "Next task /focus",
      "Agents /agents",
      "My day /coach",
      "Client messages /comms",
      "Firm OS onboarding /onboard",
      "Spot checks /agents/spot-checks",
      "Companion /companion",
    ]);
    expect(nav.search).toBe(true);
  });

  it("spot checks only for partners; the companion only when allowed; each place only with its module", () => {
    expect(firmOsNav(MANAGER.user, ALL, false).links.map((l) => l.label)).not.toContain("Spot checks");
    expect(firmOsNav(ADMIN.user, ALL, false).links.map((l) => l.label)).not.toContain("Spot checks"); // an IT admin is not a partner
    expect(firmOsNav(PARTNER.user, ALL, false).links.map((l) => l.label)).not.toContain("Companion");
    expect(firmOsNav(PARTNER.user, ["coach"], false)).toEqual({ links: [{ href: "/coach", label: "My day" }], search: false });
    expect(firmOsNav(PARTNER.user, ["comms", "search"], false).links.map((l) => l.label)).toEqual(["Client messages"]);
    expect(firmOsNav(PARTNER.user, [], false)).toEqual({ links: [], search: false });
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

  it("the header marks exactly one place with aria-current, wherever the person is", async () => {
    for (const [path, label] of [
      ["/focus", "Next task"],
      ["/workspace/job-1", "Next task"],
      ["/agents", "Agents"],
      ["/agents/echo/runs/r1", "Agents"],
      ["/agents/spot-checks", "Spot checks"],
      ["/coach", "My day"],
      ["/comms/d-1", "Client messages"],
      ["/onboard", "Firm OS onboarding"],
    ]) {
      state.pathname = path;
      expect(current(await header(PARTNER)), path).toEqual([label]);
    }
    state.pathname = "/search";
    expect(current(await header(PARTNER))).toEqual([]); // Search is a button, not a place
  });
});

describe("the header", () => {
  it("built-in staff modules: Next task, Agents, My day, the Search button and the way back", async () => {
    expect(navEntries(await header(STAFF))).toEqual(["Next task /focus", "Agents /agents", "My day /coach", "Search [button]", "Dashboard /dashboard"]);
  });

  it("built-in partner modules: every place, Spot checks and the Companion (partners may pair)", async () => {
    expect(navEntries(await header(PARTNER))).toEqual([
      "Next task /focus",
      "Agents /agents",
      "My day /coach",
      "Client messages /comms",
      "Firm OS onboarding /onboard",
      "Spot checks /agents/spot-checks",
      "Companion /companion",
      "Search [button]",
      "Dashboard /dashboard",
    ]);
  });

  it("follows the person's own modules: Search off → no Search button; the companion only when allowed", async () => {
    expect(navEntries(await header(MANAGER, ["coach", "comms"]))).toEqual(["My day /coach", "Client messages /comms", "Dashboard /dashboard"]);
    state.setting = workspaceRow(["agents"], { companionEnabled: true });
    const html = await renderHtml(await FirmOsHeader({ user: STAFF.user, home: "/focus" }));
    expect(navEntries(html)).toEqual(["Next task /focus", "Agents /agents", "Companion /companion", "Dashboard /dashboard"]);
  });

  it("calm and accessible: labelled landmark, focus rings, AA text, no emoji, the Search button names its shortcut", async () => {
    const html = await header(PARTNER);
    expect(html).toContain('<nav aria-label="Firm OS"');
    expect(html).toContain("focus-visible:ring-2");
    expect(html).not.toContain("text-ink-faint");
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html).toMatch(/<button type="button" aria-keyshortcuts="Control\+K Meta\+K"/);
    expect(html).toContain(">Firm OS</p>");
  });

  it("every Firm OS layout shows the same header for the same person", async () => {
    as(PARTNER);
    state.setting = workspaceRow(ALL);
    const layouts = await Promise.all(
      ["agents", "onboard", "coach", "comms", "search", "focus", "workspace", "companion"].map(async (p) => [p, (await import(`@/app/${p}/layout`)).default] as const),
    );
    const seen = new Map<string, string[]>();
    for (const [name, Layout] of layouts) seen.set(name, navEntries(await renderHtml(await Layout({ children: null }))));
    const first = seen.get("agents")!;
    expect(first).toContain("Search [button]");
    for (const [name, entries] of seen) expect(entries, name).toEqual(first);
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
