// The help registry (src/lib/help/pages.ts) and the Help panel (src/components/HelpButton.tsx).
//
//   1. coverage   every Firm OS page under src/app (onboard, agents, focus, workspace, coach, comms,
//                 search, companion, admin/firm-os) has its own help entry, and every entry's route
//                 is a page that exists
//   2. words      every sentence passes the plain-language rules (src/lib/errors/rules.ts, the same
//                 rules as tests/unit/plain-language-errors.test.tsx) and has the parts the panel shows
//   3. lookup     a path finds its page's entry, the most specific pattern first, then its area's
//   4. the panel  a modal dialog named by its heading, the five parts in order, a Close button; the
//                 Help button only where there is help; Tab stays inside (trapTab)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JobTaskState } from "@prisma/client";
import { messageProblems } from "@/lib/errors/rules";
import { HELP_PAGES, findHelp, routeMatches, type HelpEntry } from "@/lib/help/pages";
import { trapTab } from "@/lib/help/focus-trap";
import { renderHtml } from "./routes/harness";

const state = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", async () => ({ ...(await import("./routes/harness")).navigationMock, usePathname: () => state.pathname }));
const { HelpButton, HelpPanel } = await import("@/components/HelpButton");

const APP = join(process.cwd(), "src", "app");
const FIRM_OS_SECTIONS = ["onboard", "agents", "focus", "workspace", "coach", "comms", "search", "companion", "admin/firm-os"];

/** Every page route under a folder of src/app, as its pattern ("/agents/[agent]/runs/[id]"). */
function pageRoutes(section: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f === "page.tsx") out.push("/" + p.slice(APP.length + 1).replace(/\\/g, "/").replace(/\/?page\.tsx$/, ""));
    }
  };
  walk(join(APP, section));
  return out.map((r) => r.replace(/\/\([^)]+\)/g, "")).sort(); // route groups "(x)" are not in the path
}

/** Every string a person reads in an entry. */
function sentences(e: HelpEntry): { where: string; text: string }[] {
  return [
    { where: "title", text: e.title },
    { where: "purpose", text: e.purpose },
    ...e.steps.map((text, i) => ({ where: `step ${i + 1}`, text })),
    ...e.terms.flatMap((t, i) => [...("term" in t ? [{ where: `term ${i + 1}`, text: t.term }] : []), { where: `term ${i + 1} meaning`, text: t.meaning }]),
    ...e.stuck.flatMap((s, i) => [
      { where: `stuck ${i + 1} problem`, text: s.problem },
      { where: `stuck ${i + 1} fix`, text: s.fix },
    ]),
    { where: "ask", text: e.ask },
  ];
}

describe("1. coverage", () => {
  const firmOsPages = FIRM_OS_SECTIONS.flatMap(pageRoutes);

  it("finds the Firm OS pages (the walk can see)", () => {
    expect(firmOsPages).toEqual(expect.arrayContaining(["/onboard", "/agents", "/agents/[agent]/runs/[id]", "/focus", "/workspace/[jobId]", "/comms/[id]", "/admin/firm-os/breaches/[id]"]));
    expect(firmOsPages.length).toBeGreaterThanOrEqual(22);
  });

  it("every Firm OS page has its own help entry", () => {
    const own = new Set(HELP_PAGES.map((e) => e.route));
    expect(firmOsPages.filter((r) => !own.has(r))).toEqual([]);
  });

  it("every help entry's route is a page that exists, and no route has two entries", () => {
    const missing = HELP_PAGES.filter((e) => !existsSync(join(APP, ...e.route.split("/").filter(Boolean), "page.tsx"))).map((e) => e.route);
    expect(missing).toEqual([]);
    const routes = HELP_PAGES.map((e) => e.route);
    expect(routes.filter((r, i) => routes.indexOf(r) !== i)).toEqual([]);
  });

  it("only LMS areas cover the pages under them; Firm OS pages each have their own", () => {
    const sections = HELP_PAGES.filter((e) => e.section).map((e) => e.route);
    expect(sections.sort()).toEqual(["/clients", "/tools"]);
  });
});

describe("2. words", () => {
  it("every sentence passes the plain-language rules: no codes, no jargon beyond the firm's words", () => {
    const problems = HELP_PAGES.flatMap((e) => sentences(e).flatMap(({ where, text }) => messageProblems(text).map((p) => `${e.route} ${where}: ${p} — ${text}`)));
    expect(problems).toEqual([]);
  });

  it("each entry has all five parts: one or two sentences of purpose, steps, terms, fixes, who to ask", () => {
    for (const e of HELP_PAGES) {
      expect(e.purpose.split(/(?<=[.?])\s+(?=[A-Z])/).length, `${e.route} purpose`).toBeLessThanOrEqual(2);
      expect(e.steps.length, `${e.route} steps`).toBeGreaterThanOrEqual(3);
      expect(e.terms.length, `${e.route} terms`).toBeGreaterThanOrEqual(3);
      expect(e.stuck.length, `${e.route} stuck`).toBeGreaterThanOrEqual(3);
      expect(e.ask, `${e.route} ask`).toMatch(/\b(admin|partner|manager|reviewer|IT)\b/);
    }
  });

  it("sentences end with a full stop; titles and terms do not; steps carry no numbers of their own (the panel numbers them)", () => {
    for (const e of HELP_PAGES) {
      for (const { where, text } of sentences(e)) {
        if (where === "title" || /^term \d+$/.test(where)) expect(text, `${e.route} ${where}`).not.toMatch(/\.$/);
        else expect(text, `${e.route} ${where}`).toMatch(/[.?]$/);
      }
      for (const s of e.steps) expect(s, e.route).not.toMatch(/^\s*\d+[.)]/);
    }
  });

  it("job states are named by the chips the pages show", () => {
    const states = HELP_PAGES.flatMap((e) => e.terms.flatMap((t) => ("state" in t ? [t.state] : [])));
    expect(states.length).toBeGreaterThan(0);
    for (const s of states) expect(Object.values(JobTaskState)).toContain(s);
  });
});

describe("3. lookup", () => {
  it("a path finds its page's entry; fixed words beat a placeholder", () => {
    expect(findHelp("/agents/mistakes")?.route).toBe("/agents/mistakes");
    expect(findHelp("/agents/spot-checks")?.route).toBe("/agents/spot-checks");
    expect(findHelp("/agents/gst")?.route).toBe("/agents/[agent]");
    expect(findHelp("/agents/gst/runs/r-1")?.route).toBe("/agents/[agent]/runs/[id]");
    expect(findHelp("/comms/new")?.route).toBe("/comms/new");
    expect(findHelp("/comms/d-1")?.route).toBe("/comms/[id]");
    expect(findHelp("/workspace/job-1")?.route).toBe("/workspace/[jobId]");
    expect(findHelp("/admin/firm-os/privacy/p-1")?.route).toBe("/admin/firm-os/privacy/[id]");
    expect(findHelp("/focus/")?.route).toBe("/focus");
    expect(findHelp("/search?q=acme")?.route).toBe("/search");
  });

  it("an LMS area's entry covers its pages; elsewhere there is no help", () => {
    expect(findHelp("/clients/c-1")?.route).toBe("/clients");
    expect(findHelp("/tools/office-tools/engagement-letter")?.route).toBe("/tools");
    expect(findHelp("/dashboard")?.route).toBe("/dashboard");
    expect(findHelp("/admin")).toBeNull();
    expect(findHelp("/leaderboard")).toBeNull();
    expect(findHelp("/agents/gst/runs")).toBeNull(); // not a page
    expect(findHelp(null)).toBeNull();
    expect(routeMatches("/agents/[agent]", "/agents")).toBe(false);
  });
});

describe("4. the panel", () => {
  const entry = HELP_PAGES.find((e) => e.route === "/agents/[agent]/runs/[id]")!;

  it("is a modal dialog named by its heading, with the five parts in order and a Close button", async () => {
    const html = (await renderHtml(<HelpPanel id="help-panel" entry={entry} onClose={() => {}} />)).replace(/<!-- -->/g, "");
    const labelledBy = html.match(/role="dialog" aria-modal="true" aria-labelledby="([^"]+)"/)?.[1];
    expect(labelledBy).toBeTruthy();
    expect(html).toContain(`<h2 id="${labelledBy}"`);
    expect(html).toContain(`>${entry.title}</h2>`);
    const parts = [...html.matchAll(/<h3 class="[^"]*">([^<]+)<\/h3>/g)].map((m) => m[1].replace(/&#x27;/g, "'"));
    expect(parts).toEqual(["What this page is for", "How to use it", "What the words and statuses mean", "If you're stuck", "Who to ask"]);
    expect(html).toContain('aria-label="Close help"');
    expect(html).toMatch(/<ol class="list-decimal/);
    expect(html).toContain("IN_REVIEW"); // the chip, as the run page shows it
    expect(html).toContain("focus-visible:ring-2");
  });

  it("the Help button shows only where there is help, names its dialog and says it is closed", async () => {
    state.pathname = "/leaderboard";
    expect(await renderHtml(<HelpButton className="x" />)).toBe("");
    state.pathname = "/focus";
    const html = await renderHtml(<HelpButton className="x" labelClassName="sr-only lg:not-sr-only" />);
    expect(html).toMatch(/<button type="button" aria-haspopup="dialog" aria-expanded="false" title="Help for [^"]+" class="x inline-flex items-center gap-2">/);
    expect(html).toContain('<span class="sr-only lg:not-sr-only">Help</span>');
    expect(html).not.toContain('role="dialog"'); // closed until pressed
  });

  it("opens into <body>: the headers' backdrop-blur would clip a fixed panel rendered in place to the header's 64 px", () => {
    const src = readFileSync(join(process.cwd(), "src", "components", "HelpButton.tsx"), "utf8");
    expect(src).toMatch(/createPortal\(<HelpPanel [^>]*\/>, document\.body\)/);
    for (const header of ["FirmOsHeader.tsx", "AreaHeader.tsx"]) expect(readFileSync(join(process.cwd(), "src", "components", header), "utf8")).toContain("backdrop-blur"); // why the portal is needed
  });

  it("Tab stays inside: past the last control to the first, before the first to the last", () => {
    expect(trapTab(4, 5, false)).toBe(0);
    expect(trapTab(0, 5, true)).toBe(4);
    expect(trapTab(2, 5, false)).toBeNull(); // the browser moves on as usual
    expect(trapTab(-1, 5, false)).toBe(0); // focus on the panel itself
    expect(trapTab(-1, 5, true)).toBe(4);
    expect(trapTab(0, 0, false)).toBeNull();
  });
});
