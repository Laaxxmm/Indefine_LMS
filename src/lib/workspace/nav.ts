// Which navigation links a person sees, from the modules they have on (effectiveModules, which
// already applies the role rules and the Firm OS master switch). Pure: the pages render these
// lists, and the tests check them per module set. Labels are the names the other pages already
// use for each place (the dashboard's links, the pages' titles).
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

/** The dashboard's header links after Home, in order. Search is a button (the command palette), not a link. */
export function dashboardLinks(modules: readonly ModuleKey[]): NavItem[] {
  const on = has(modules);
  const links: NavItem[] = [];
  if (on("learning")) links.push({ href: "/dashboard#courses", label: "Courses" });
  if (on("leaderboard")) {
    links.push({ href: "/leaderboard", label: "Leaderboard", tour: "leaderboard" });
    links.push({ href: "/checkin", label: "Check-in" });
    links.push({ href: "/recap/year", label: "Recap" });
  }
  if (on("tools")) links.push({ href: "/tools", label: "Tools" });
  if (on("clients")) links.push({ href: "/clients", label: "Clients" });
  if (on("agents")) {
    links.push({ href: "/focus", label: "Next task" });
    links.push({ href: "/agents", label: "Agents" });
  }
  if (on("coach")) links.push({ href: "/coach", label: "My day" });
  if (on("comms")) links.push({ href: "/comms", label: "Client messages" });
  if (on("work")) links.push({ href: "/work", label: "Work" });
  return links;
}

export type FirmOsNav = { links: NavItem[]; search: boolean };

/**
 * The one Firm OS header (every Firm OS page): a short, fixed set of places, each only when its
 * module is on and the role may use it, then Search (the command palette) and the way back to the
 * dashboard. `companion`: may the person pair the companion (guard.ts companionVisibleFor).
 */
export function firmOsNav(user: SessionUser, modules: readonly ModuleKey[], companion: boolean): FirmOsNav {
  const on = has(modules);
  const links: NavItem[] = [];
  if (on("agents")) {
    links.push({ href: "/focus", label: "Next task", also: ["/workspace"] });
    links.push({ href: "/agents", label: "Agents", except: ["/agents/spot-checks"] });
  }
  if (on("coach")) links.push({ href: "/coach", label: "My day" });
  if (on("comms")) links.push({ href: "/comms", label: "Client messages" });
  if (on("onboard")) links.push({ href: "/onboard", label: "Firm OS onboarding" });
  if (on("agents") && canSpotCheck(user)) links.push({ href: "/agents/spot-checks", label: "Spot checks" });
  if (companion) links.push({ href: "/companion", label: "Companion" });
  return { links, search: on("search") };
}
