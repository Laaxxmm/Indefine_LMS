/// <reference types="vite/client" />
// Visual render (NOT run by `npm test`): server-renders every Firm OS page — and a few LMS pages for
// comparison — through the route-smoke harness, with realistic in-memory data (the echo agent run for
// real against the fake SharePoint), and writes each as a standalone HTML file styled with the
// project's compiled Tailwind CSS. Open test-results/visual/index.html in a browser and look at each
// page at 390 / 1280 / 1440 px (docs/qa/ui-checklist.md). Same method as the UI audit (PROGRESS
// "UI audit": SSR pages + compiled Tailwind in the browser pane at 390/1280/1440).
//
//   npx vitest run --config tests/regression/visual.vitest.config.ts
//
// Client-side interactions (button clicks, confirm steps) do not run here; the HTML is the first
// paint. Pages Phases 9–11 add (/coach, /comms, /agents/spot-checks) are picked up automatically
// once they exist; until then they are listed as "not built yet".
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { createElement, type ReactElement } from "react";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { renderHtml } from "../unit/routes/harness";
import { echoWorld, user, type World } from "../fakes/agent-world";

const state = vi.hoisted(() => ({ world: null as unknown as World, session: null as unknown }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.session), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("../unit/routes/harness")).navigationMock);
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }), headers: async () => new Headers() }));
vi.mock("@/lib/ai/db", () => ({
  loadModelCalls: async () => [
    { createdAt: new Date("2026-11-03T06:00:00Z"), agent: "gst", provider: "claude", status: "OK", escalated: false, costInr: 18.42, tokensIn: 12000, tokensOut: 2400 },
    { createdAt: new Date("2026-11-04T06:00:00Z"), agent: "roc", provider: "claude", status: "LOW_CONFIDENCE", escalated: true, costInr: 42.1, tokensIn: 30000, tokensOut: 4000 },
    { createdAt: new Date("2026-11-04T07:00:00Z"), agent: "onboarding", provider: "grok", status: "OK", escalated: false, costInr: 3.5, tokensIn: 900, tokensOut: 120 },
  ],
}));
vi.mock("@/lib/close-loop/cycle-time-db", () => {
  const H = 3_600_000;
  const t = (total: number, review: number) => ({ assignedToDone: total * H, queue: 0, prep: (total - review) * H, review: review * H, waitOnClient: 0, filing: 0, filingToDone: 0, done: true });
  return {
    loadCycleJobs: async () => ({
      capped: false,
      jobs: [
        { id: "j1", service: "GST", title: "GSTR-3B", clientCode: "ACME01", assigneeId: "u-priya", assigneeName: "Priya S", times: t(30, 6) },
        { id: "j2", service: "ROC", title: "AOC-4", clientCode: "BRIGHT", assigneeId: "u-ravi", assigneeName: "Ravi Kumar", times: t(52, 10) },
      ],
    }),
  };
});
// The in-memory Firm OS world as the database; the legacy client row for /clients/[id]; everything else empty.
vi.mock("@/lib/prisma", async () => {
  const { prismaMock } = await import("../unit/routes/harness");
  const CLIENT = {
    id: "c1", name: "Acme Pvt Ltd", active: true, entityType: "PVT_LTD", pan: null, gstin: null, cin: null, industry: "Manufacturing", city: "Bengaluru",
    contactName: "Fixture Contact", contactPhone: null, contactEmail: null, referralSource: null, turnover: 25_000_000, turnoverBand: "1CR_10CR",
    growthGoal: "MAINTAIN", growthNote: null, onboardedOn: new Date("2026-04-01T00:00:00+05:30"), primaryHandlerId: "u-priya",
    primaryHandler: { name: "Priya S", email: "priya@indefine.test" }, graphFolderId: "legacy-folder-id", folderName: "Acme Pvt Ltd", folderStatus: "READY",
    documents: [], jobs: [],
  };
  return {
    get prisma() {
      const mem = state.world.db as unknown as Record<string, unknown> & { tables: Record<string, unknown> };
      return new Proxy({}, {
        get: (_t, key: string | symbol) => {
          if (key === "client") return { ...(mem.client as object), findUnique: async () => CLIENT };
          if (key === "turiaSync") return { findMany: async () => [] };
          if (typeof key === "string" && (key in mem.tables || key.startsWith("$"))) return mem[key];
          return (prismaMock as Record<string | symbol, unknown>)[key];
        },
      });
    },
  };
});

const OUT = join(process.cwd(), "test-results", "visual");
const WIDTHS = [390, 1280, 1440] as const;

type Mod = { default: (props: never) => unknown };
type Entry = { slug: string; title: string; who: string; session: Session["user"]; env?: Record<string, string>; page: () => Promise<Mod>; layout?: () => Promise<Mod>; props?: Record<string, unknown> };

const as = (u: Session["user"]) => ({ user: u, expires: "2099-01-01T00:00:00.000Z" });
const HOOKS = /reading '(useState|useContext|useRef|useEffect|useReducer|useMemo|useCallback|useId|useTransition)'/;

async function render(e: Entry): Promise<string> {
  state.session = as(e.session);
  for (const [k, v] of Object.entries(e.env ?? {})) vi.stubEnv(k, v);
  const props = { params: Promise.resolve({}), searchParams: Promise.resolve({}), ...e.props };
  const mod = await e.page();
  let el: unknown;
  try {
    el = await (mod.default as (p: unknown) => unknown)(props);
  } catch (err) {
    if (!(err instanceof TypeError) || !HOOKS.test(err.message)) throw err;
    el = createElement(mod.default as never, props as never);
  }
  if (e.layout) el = await ((await e.layout()).default as (p: unknown) => unknown)({ children: el });
  vi.unstubAllEnvs();
  return (await renderHtml(el as ReactElement)).replace(/<!-- -->/g, "");
}

const doc = (title: string, body: string) =>
  `<!doctype html><html lang="en" class="font-sans"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><link rel="stylesheet" href="tailwind.css"></head><body class="antialiased text-ink">${body}</body></html>`;

async function compileTailwind(): Promise<string> {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const out = await postcss([tailwindcss({ config: join(process.cwd(), "tailwind.config.ts") }), autoprefixer]).process(css, { from: join(process.cwd(), "src", "app", "globals.css") });
  return out.css;
}

async function seedWorld() {
  state.world = echoWorld();
  state.world.db.seed("user", [
    { id: "u-priya", name: "Priya S", email: "priya@indefine.test" },
    { id: "u-ravi", name: "Ravi Kumar", email: "ravi@indefine.test" },
    { id: "u-partner", name: "Lakshmanan A", email: "partner@indefine.test" },
  ]);
  vi.stubEnv("FIRM_OS_ECHO_AGENT", "1");
  const { startAgentRun, submitForReview } = await import("@/lib/agents/service");
  await startAgentRun(user("priya"), "echo", "job-1", state.world.deps);
  await submitForReview(user("priya"), "run-1", state.world.deps);
  vi.unstubAllEnvs();
}

/** Pages that exist only after the Phase 9–11 merges; rendered when present. */
const LATER = import.meta.glob(["../../src/app/coach/page.tsx", "../../src/app/comms/page.tsx", "../../src/app/comms/new/page.tsx", "../../src/app/agents/spot-checks/page.tsx", "../../src/app/search/page.tsx", "../../src/app/focus/page.tsx", "../../src/app/companion/page.tsx"]);
const LATER_ADMIN = import.meta.glob(["../../src/app/admin/firm-os/workspace/page.tsx"]);

function entries(): Entry[] {
  const partner = user("partner");
  const priya = user("priya");
  const ravi = user("ravi");
  const admin = user("admin");
  const agentsLayout = () => import("@/app/agents/layout");
  const echo = { FIRM_OS_ECHO_AGENT: "1" };
  const list: Entry[] = [
    { slug: "onboard", title: "/onboard", who: "partner", session: partner, page: () => import("@/app/onboard/page"), layout: () => import("@/app/onboard/layout") },
    { slug: "agents-partner", title: "/agents", who: "partner", session: partner, env: echo, page: () => import("@/app/agents/page"), layout: agentsLayout },
    { slug: "agents-staff", title: "/agents", who: "staff (assignee)", session: priya, env: echo, page: () => import("@/app/agents/page"), layout: agentsLayout },
    { slug: "agent-echo", title: "/agents/echo", who: "partner", session: partner, env: echo, page: () => import("@/app/agents/[agent]/page"), layout: agentsLayout, props: { params: Promise.resolve({ agent: "echo" }) } },
    { slug: "run-reviewer", title: "/agents/echo/runs/run-1 (IN_REVIEW)", who: "reviewer", session: ravi, env: echo, page: () => import("@/app/agents/[agent]/runs/[id]/page"), layout: agentsLayout, props: { params: Promise.resolve({ agent: "echo", id: "run-1" }) } },
    { slug: "run-assignee", title: "/agents/echo/runs/run-1 (IN_REVIEW)", who: "assignee", session: priya, env: echo, page: () => import("@/app/agents/[agent]/runs/[id]/page"), layout: agentsLayout, props: { params: Promise.resolve({ agent: "echo", id: "run-1" }) } },
    { slug: "mistakes", title: "/agents/mistakes", who: "partner", session: partner, env: echo, page: () => import("@/app/agents/mistakes/page"), layout: agentsLayout },
    { slug: "admin-models", title: "/admin/firm-os/models", who: "admin", session: admin, page: () => import("@/app/admin/firm-os/models/page"), layout: () => import("@/app/admin/layout") },
    { slug: "admin-mistakes", title: "/admin/firm-os/mistakes", who: "admin", session: admin, page: () => import("@/app/admin/firm-os/mistakes/page"), layout: () => import("@/app/admin/layout") },
    { slug: "admin-cycle-time", title: "/admin/firm-os/cycle-time", who: "admin", session: admin, page: () => import("@/app/admin/firm-os/cycle-time/page"), layout: () => import("@/app/admin/layout") },
    { slug: "client-firm-os-card", title: "/clients/c1 (FIRM_OS_CL_PATHS on)", who: "partner", session: partner, env: { FIRM_OS_CL_PATHS: "1" }, page: () => import("@/app/clients/[id]/page"), layout: () => import("@/app/clients/layout"), props: { params: Promise.resolve({ id: "c1" }) } },
    { slug: "lms-dashboard", title: "/dashboard (LMS, for comparison)", who: "staff", session: priya, page: () => import("@/app/dashboard/page") },
    { slug: "lms-tools", title: "/tools (LMS, for comparison)", who: "partner", session: partner, page: () => import("@/app/tools/page"), layout: () => import("@/app/tools/layout") },
  ];
  for (const [path, load] of Object.entries(LATER)) {
    const route = path.replace("../../src/app", "").replace("/page.tsx", "");
    list.push({ slug: route.slice(1).replace(/\//g, "-"), title: route, who: "partner", session: partner, page: load as () => Promise<Mod>, layout: undefined });
  }
  for (const [path, load] of Object.entries(LATER_ADMIN)) {
    const route = path.replace("../../src/app", "").replace("/page.tsx", "");
    list.push({ slug: route.slice(1).replace(/\//g, "-"), title: route, who: "admin", session: admin, page: load as () => Promise<Mod>, layout: () => import("@/app/admin/layout") });
  }
  return list;
}

const results: { e: Entry; ok: boolean; note: string }[] = [];

describe("visual render → test-results/visual", () => {
  it("writes every page with the compiled Tailwind CSS", async () => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "tailwind.css"), await compileTailwind());
    await seedWorld();
    for (const e of entries()) {
      try {
        const html = await render(e);
        writeFileSync(join(OUT, `${e.slug}.html`), doc(e.title, html));
        results.push({ e, ok: true, note: `${Math.round(html.length / 1024)} KB` });
      } catch (err) {
        writeFileSync(join(OUT, `${e.slug}.html`), doc(e.title, `<pre style="padding:24px;white-space:pre-wrap">Render failed: ${String((err as Error).stack ?? err)}</pre>`));
        results.push({ e, ok: false, note: (err as Error).message.slice(0, 200) });
      }
    }
    expect(results.length).toBeGreaterThan(0);
  }, 300_000);

  afterAll(() => {
    const rows = results
      .map(({ e, ok, note }) => `<tr><td><a href="${e.slug}.html">${e.title}</a></td><td>${e.who}</td><td>${ok ? "rendered" : "FAILED"} · ${note.replace(/</g, "&lt;")}</td><td>${WIDTHS.map((w) => `<a href="frame.html#${e.slug}@${w}">${w}</a>`).join(" · ")}</td></tr>`)
      .join("");
    const later = ["/coach", "/comms", "/comms/new", "/agents/spot-checks", "/search", "/focus", "/companion", "/admin/firm-os/workspace"].filter((r) => !results.some((x) => x.e.title === r));
    writeFileSync(
      join(OUT, "index.html"),
      `<!doctype html><meta charset="utf-8"><title>Firm OS visual render</title><body style="font:14px system-ui;padding:24px"><h1>Firm OS visual render</h1><p>First paint (SSR) with compiled Tailwind. Check each page against docs/qa/ui-checklist.md.</p><table cellpadding="6" border="1" style="border-collapse:collapse"><tr><th>Page</th><th>As</th><th>Result</th><th>Width</th></tr>${rows}</table>${later.length ? `<p>Not built yet (Phases 9–11): ${later.join(", ")}</p>` : ""}</body>`,
    );
    writeFileSync(
      join(OUT, "frame.html"),
      `<!doctype html><meta charset="utf-8"><title>Frame</title><body style="margin:0;background:#ddd"><p id="t" style="font:13px system-ui;margin:8px"></p><iframe id="f" style="border:0;background:#fff;height:calc(100vh - 40px)"></iframe><script>const [s,w]=location.hash.slice(1).split("@");document.getElementById("t").textContent=s+" at "+w+"px";const f=document.getElementById("f");f.style.width=w+"px";f.src=s+".html";</script></body>`,
    );
    console.log(`visual-render: ${results.filter((r) => r.ok).length}/${results.length} pages → ${join(OUT, "index.html")}`);
  });
});
