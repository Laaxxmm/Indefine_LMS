// Shared helpers for the LMS regression suite (tests/regression). Builds on the route-smoke harness
// (tests/unit/routes/harness.ts): an empty-database Prisma stand-in, mocked sessions and the
// redirect / notFound sentinels. Each test file still declares its own vi.mock calls (vitest hoists
// them per file) and delegates here.
import { createElement, type ReactElement } from "react";
import type { Session } from "next-auth";
import { activeSession, renderHtml } from "../../unit/routes/harness";

export { activeSession, prismaCalls, redirectTarget, renderHtml, NotFoundSignal, RedirectSignal, TEST_EMAIL } from "../../unit/routes/harness";

type PageModule = { default: (props: never) => unknown };
const HOOK_OUTSIDE_RENDER = /reading '(useState|useContext|useRef|useEffect|useReducer|useMemo|useCallback|useId|useTransition)'/;

/**
 * Server-render a page module. Async server components are awaited as functions (that is how the
 * route-smoke tests run them); "use client" pages, which call hooks, are rendered as elements.
 */
export async function renderPage(mod: PageModule, props: Record<string, unknown> = {}, layout?: PageModule): Promise<string> {
  const full = { params: Promise.resolve({}), searchParams: Promise.resolve({}), ...props };
  let el: unknown;
  try {
    el = await (mod.default as (p: unknown) => unknown)(full);
  } catch (e) {
    if (!(e instanceof TypeError) || !HOOK_OUTSIDE_RENDER.test(e.message)) throw e;
    el = createElement(mod.default as never, full as never);
  }
  if (layout) el = await (layout.default as (p: unknown) => unknown)({ children: el });
  return (await renderHtml(el as ReactElement)).replace(/<!-- -->/g, "");
}

/** Visible text, tags stripped and whitespace collapsed. */
export const textOf = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Every <h1> as text. */
export const headings = (html: string) => [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => textOf(m[1]));

/** Every anchor: href plus target / rel, in document order. */
export function anchors(html: string): { href: string; target: string | null; rel: string | null }[] {
  return [...html.matchAll(/<a\b([^>]*)>/g)].map((m) => {
    const attr = (name: string) => m[1].match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
    return { href: (attr("href") ?? "").replace(/&amp;/g, "&"), target: attr("target"), rel: attr("rel") };
  });
}

export const hrefs = (html: string) => anchors(html).map((a) => a.href);

/** Firm OS routes (pages and APIs). Anything here on an LMS page is a Firm OS entry point. */
export const FIRM_OS_HREF = /^\/(onboard|agents|coach|comms|admin\/firm-os|api\/firm-os)(\/|$|\?)/;
export const firmOsHrefs = (html: string) => [...new Set(hrefs(html).filter((h) => FIRM_OS_HREF.test(h)))].sort();

/** Prisma models that belong to Firm OS (prisma/schema.prisma "Firm OS" sections). */
export const FIRM_OS_MODELS = new Set([
  "firmClient", "engagement", "sopPack", "jobTask", "jobTaskEvent", "agentRun", "checklistResult", "mistakeLog", "deliverable",
  "turiaSync", "onboardingRun", "modelCall", "commsDraft", "coachEvent", "coachPreference", "activityHeartbeat", "rateLimitBucket", "auditEvent",
]);

/** Sessions for the people the LMS and Firm OS distinguish. */
export const PEOPLE: Record<"staff" | "senior" | "manager" | "partner" | "admin" | "inactive", Session> = {
  staff: activeSession({ id: "u-staff", level: "EXECUTIVE" }),
  senior: activeSession({ id: "u-senior", level: "SENIOR_EXECUTIVE" }),
  manager: activeSession({ id: "u-manager", level: "MANAGER" }),
  partner: activeSession({ id: "u-partner", level: "PARTNER" }),
  admin: activeSession({ id: "u-admin", role: "ADMIN", level: "EXECUTIVE" }),
  inactive: activeSession({ id: "u-gone", active: false }),
};

/** Every FIRM_OS_* variable the code reads (src/**) plus the ones Phases 9–11 are expected to add. */
export const FIRM_OS_FLAGS = [
  "FIRM_OS_CL_PATHS",
  "FIRM_OS_ECHO_AGENT",
  "FIRM_OS_ONBOARD_CONFIRM",
  "FIRM_OS_TURIA_BRIDGE",
  "FIRM_OS_TURIA_UI",
  "FIRM_OS_BREAK_NUDGE",
  "FIRM_OS_HOLIDAYS",
  "FIRM_OS_COMMS",
  "FIRM_OS_ENABLED",
  "FIRM_OS_PILOT_EMAILS",
];
