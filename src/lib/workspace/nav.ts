// Which navigation links a person sees, from the modules they have on (effectiveModules, which
// already applies the role rules and the Firm OS master switch). Pure: the pages render these
// lists, and the tests check them per module set. One label per place, the same in every menu
// (the dashboard's Firm OS menu and the Firm OS header say "Agents", "Next task", … alike).
import type { SessionUser } from "@/lib/access";
import { canSpotCheck } from "@/lib/rbac/policy";
import type { ModuleKey } from "./registry";

export type NavItem = {
  href: string;
  label: string;
  /** Marked current only on this exact path (a section root whose children have their own links). */
  exact?: boolean;
  /** Other paths that belong to this section (the guided workspace belongs to Next task). */
  also?: readonly string[];
  /** Paths under `href` that are another link's section (Spot checks under Agents). */
  except?: readonly string[];
  /** The onboarding tour's anchor on the dashboard. */
  tour?: string;
};

const has = (modules: readonly ModuleKey[]) => (k: ModuleKey) => modules.includes(k);

/** The name of /agents (the runs list) in every menu, as its page title and in every back link to it. */
export const AGENTS_LABEL = "Agents";

/** The dashboard's grouped menus: the learning pages, and the Firm OS places. */
export type DashboardGroup = "learn" | "firmOs";
export const DASHBOARD_GROUP_LABEL: Record<DashboardGroup, string> = { learn: "Learn", firmOs: "Firm OS" };

/** A dashboard link, with the menu it sits in (none: a link of its own on the bar). */
export type DashboardLink = NavItem & { group?: DashboardGroup };

/**
 * The dashboard's header links after Home, in order, flat. Search is a button (the command palette),
 * not a link. dashboardNav() groups them into the bar.
 */
export function dashboardLinks(modules: readonly ModuleKey[]): DashboardLink[] {
  const on = has(modules);
  const links: DashboardLink[] = [];
  if (on("learning")) links.push({ href: "/dashboard#courses", label: "Courses", group: "learn" });
  if (on("leaderboard")) {
    links.push({ href: "/leaderboard", label: "Leaderboard", tour: "leaderboard", group: "learn" });
    links.push({ href: "/checkin", label: "Check-in", group: "learn" });
    links.push({ href: "/recap/year", label: "Recap", group: "learn" });
  }
  if (on("tools")) links.push({ href: "/tools", label: "Tools" });
  if (on("clients")) links.push({ href: "/clients", label: "Clients" });
  if (on("agents")) {
    links.push({ href: "/focus", label: "Next task", group: "firmOs" });
    links.push({ href: "/agents", label: AGENTS_LABEL, group: "firmOs" });
  }
  if (on("coach")) links.push({ href: "/coach", label: "My day", group: "firmOs" });
  if (on("comms")) links.push({ href: "/comms", label: "Client messages", group: "firmOs" });
  if (on("work")) links.push({ href: "/work", label: "Work" });
  return links;
}

/** One entry on the dashboard bar: a link, or a menu of links. */
export type DashboardEntry = { kind: "link"; item: NavItem } | { kind: "menu"; group: DashboardGroup; label: string; items: NavItem[] };

/**
 * The dashboard bar after Home: Learn ▾, Tools, Clients, Firm OS ▾, Work — each link only when its
 * module is on (dashboardLinks). A group with one link left is that link on its own (a menu of one
 * is an extra click for nothing); a group with none is not shown.
 */
export function dashboardNav(modules: readonly ModuleKey[]): DashboardEntry[] {
  const entries: DashboardEntry[] = [];
  for (const { group, ...item } of dashboardLinks(modules)) {
    const last = entries[entries.length - 1];
    if (group && last?.kind === "menu" && last.group === group) last.items.push(item);
    else if (group) entries.push({ kind: "menu", group, label: DASHBOARD_GROUP_LABEL[group], items: [item] });
    else entries.push({ kind: "link", item });
  }
  return entries.map((e): DashboardEntry => (e.kind === "menu" && e.items.length === 1 ? { kind: "link", item: e.items[0] } : e));
}

/** The Firm OS header's places: the four on the bar, the rest in More, and whether Search shows. */
export type FirmOsNav = { primary: NavItem[]; more: NavItem[]; search: boolean };

/**
 * The one Firm OS header (every Firm OS page), with the same labels on every page. On the bar: Next
 * task, Agents, My day, Client messages. In "More": Onboard client, Spot checks, Companion. Each only
 * when its module is on and the role may use it; then Search (the command palette, when its module
 * is on), Help and the way back to the dashboard. `companion`: may the person pair the companion
 * (guard.ts companionVisibleFor).
 */
export function firmOsNav(user: SessionUser, modules: readonly ModuleKey[], opts: { companion: boolean }): FirmOsNav {
  const on = has(modules);
  const primary: NavItem[] = [];
  const more: NavItem[] = [];
  if (on("agents")) {
    primary.push({ href: "/focus", label: "Next task", also: ["/workspace"] });
    primary.push({ href: "/agents", label: AGENTS_LABEL, except: ["/agents/spot-checks"] });
  }
  if (on("coach")) primary.push({ href: "/coach", label: "My day" });
  if (on("comms")) primary.push({ href: "/comms", label: "Client messages" });
  if (on("onboard")) more.push({ href: "/onboard", label: "Onboard client" });
  if (on("agents") && canSpotCheck(user)) more.push({ href: "/agents/spot-checks", label: "Spot checks" });
  if (opts.companion) more.push({ href: "/companion", label: "Companion" });
  return { primary, more, search: on("search") };
}
