// The help registry: one entry per page, keyed by the page's route pattern (the folder under
// src/app). The Help button in the headers (src/components/HelpButton.tsx) shows the entry for
// the page you are on. Every Firm OS page has one, and every entry's route is a real page
// (tests/unit/help-registry.test.tsx); the words follow the plain-language rules (same test).
//
// The content is grouped by area in ./content; this file is the only place that reads it.
import { ADMIN_HELP } from "./content/admin";
import { AGENT_HELP } from "./content/agents";
import { LMS_HELP } from "./content/lms";
import { WORK_HELP } from "./content/work";
import type { HelpEntry } from "./types";

export type { HelpEntry, HelpFix, HelpTerm } from "./types";

export const HELP_PAGES: readonly HelpEntry[] = [...WORK_HELP, ...AGENT_HELP, ...ADMIN_HELP, ...LMS_HELP];

const segments = (path: string) => path.split(/[?#]/)[0].split("/").filter(Boolean);
const isDynamic = (seg: string) => /^\[.+\]$/.test(seg);

/** Does `pathname` open the page at `route` ("/agents/[agent]/runs/[id]" matches "/agents/gst/runs/r1")? */
export function routeMatches(route: string, pathname: string): boolean {
  const r = segments(route);
  const p = segments(pathname);
  return r.length === p.length && r.every((seg, i) => isDynamic(seg) || seg === p[i]);
}

/** Is `pathname` the section root `route` or a page under it? */
function underSection(route: string, pathname: string): boolean {
  const r = segments(route);
  const p = segments(pathname);
  return p.length >= r.length && r.every((seg, i) => seg === p[i]);
}

/**
 * The help for the page at `pathname`, or null. The page's own entry wins; among several patterns
 * that fit, the one with more fixed words ("/agents/mistakes" over "/agents/[agent]"). Otherwise the
 * entry of the area it sits in (an LMS area marked `section`), the deepest first.
 */
export function findHelp(pathname: string | null | undefined, pages: readonly HelpEntry[] = HELP_PAGES): HelpEntry | null {
  if (!pathname) return null;
  const fixed = (e: HelpEntry) => segments(e.route).filter((s) => !isDynamic(s)).length;
  const own = pages.filter((e) => routeMatches(e.route, pathname)).sort((a, b) => fixed(b) - fixed(a));
  if (own.length) return own[0];
  const area = pages.filter((e) => e.section && underSection(e.route, pathname)).sort((a, b) => segments(b.route).length - segments(a.route).length);
  return area[0] ?? null;
}
