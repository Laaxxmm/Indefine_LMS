// /search: layout and page server render behind a mocked session, against the in-memory world.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { redirectTarget, renderHtml as renderRaw } from "./harness";
import { IDS, PEOPLE, searchWorld, type SearchWorld } from "../../fakes/search-world";
import { memoryRateLimiter } from "@/lib/search/rate-limit";

// Firm OS switched on for these tests (FIRM_OS_ENABLED defaults off: src/lib/workspace/flag.ts).
beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const state = vi.hoisted(() => ({ world: null as unknown as SearchWorld }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
// The layout reads the workspace settings: none saved, so the built-in role defaults apply.
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));
vi.mock("@/lib/search/defaults", () => ({ defaultSearchDeps: () => ({ db: state.world.db, limiter: memoryRateLimiter(), clPaths: false, now: () => new Date() }) }));

const { auth } = await import("@/lib/auth");
const { default: Layout } = await import("@/app/search/layout");
const { default: SearchPage } = await import("@/app/search/page");
const { SearchPanel } = await import("@/app/search/SearchPanel");
const { noResultsText, START_TIP, HELP_TEXT } = await import("@/lib/search/copy");

const as = (u: Session["user"] | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? { user: u, expires: "2099-01-01" } : null);
const renderHtml = async (el: Parameters<typeof renderRaw>[0]) => (await renderRaw(el)).replace(/<!-- -->/g, "");
const page = async (sp: Record<string, string> = {}) => renderHtml(await SearchPage({ searchParams: Promise.resolve(sp) }));
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

beforeEach(() => {
  state.world = searchWorld();
});
afterEach(() => vi.clearAllMocks());

describe("access", () => {
  it("signed out goes to sign-in; deactivated to the dashboard", async () => {
    as(null);
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/");
    expect(await redirectTarget(() => SearchPage({ searchParams: Promise.resolve({}) }))).toBe("/");
    as(PEOPLE.gone);
    expect(await redirectTarget(() => Layout({ children: null }))).toBe("/dashboard");
    expect(await redirectTarget(() => SearchPage({ searchParams: Promise.resolve({ q: "acme" }) }))).toBe("/dashboard");
    expect(state.world.calls).toEqual([]);
  });
});

describe("layout", () => {
  it("Firm OS header: logo, section label, nav with the Search button and a way back to the dashboard", async () => {
    as(PEOPLE.priya);
    const html = await renderHtml(await Layout({ children: "x" }));
    expect(html).toContain('aria-label="Firm OS"'); // not "Search": the search form is its own landmark
    expect(html).toMatch(/<button[^>]*aria-label="Search" aria-keyshortcuts="Control\+K Meta\+K"[^>]*>.*Ctrl K<\/kbd><\/button>/); // an icon, named Search, with its shortcut
    expect(html).toMatch(/href="\/agents"/);
    expect(html).toMatch(/href="\/dashboard"[^>]*>.*Dashboard/);
    expect(html).toContain("focus-visible:ring-2");
    expect(html).not.toContain("text-ink-faint");
  });
});

describe("page", () => {
  it("empty: the title, a labelled search box, type filters the person may use, and what to try", async () => {
    as(PEOPLE.priya);
    const html = decode(await page());
    expect(html).toMatch(/<h1[^>]*>Search<\/h1>/);
    expect(html).toContain('role="search"');
    expect(html).toMatch(/<label[^>]*for="search-q"/);
    expect(html).toContain('aria-describedby="search-help"');
    expect(html).toContain(HELP_TEXT);
    expect(html).toContain('aria-label="Filter by type"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>All types</);
    expect(html).toContain(">Firm OS jobs<");
    expect(html).not.toContain(">Onboarding<"); // staff cannot open onboarding runs
    expect(html).toContain("Search for anything you work on");
    expect(html).toContain(START_TIP);
    expect(state.world.calls).toEqual([]);
  });

  it("managers get the Onboarding filter", async () => {
    as(PEOPLE.manager);
    expect(await page()).toContain(">Onboarding<");
  });

  it("a text query in the address is searched: grouped results with type, context and link", async () => {
    as(PEOPLE.priya);
    const html = decode(await page({ q: "acme" }));
    expect(html).toContain('value="acme"');
    expect(html).toMatch(/<h2 id="results-client"[^>]*>Clients · 2</);
    expect(html).toMatch(/data-result="0"[^>]*href="\/clients\/c-acme"/);
    expect(html).toContain("Acme Traders Private Limited");
    expect(html).toContain("Client code ACME01 · Private limited · Chennai");
    expect(html).toMatch(/href="\/agents\/gst\/runs\/run-gst-2"/);
    expect(html).not.toContain("job-acme-roc"); // assigned to someone else
    expect(html).not.toContain("AOC-4 —");
  });

  it("a type in the address filters and presses that chip", async () => {
    as(PEOPLE.priya);
    const html = await page({ q: "acme", type: "client" });
    expect(html).toMatch(/aria-pressed="true"[^>]*>Clients</);
    expect(html).not.toContain('id="results-job"');
  });

  it("an identifier in the address is not run; the page says how to search by it", async () => {
    as(PEOPLE.priya);
    const html = decode(await page({ q: IDS.acmePan }));
    expect(html).toContain("Searches by PAN, GSTIN, phone or email are not run from the page address. Type the full value in the search box and press Enter.");
    expect(html).not.toContain(IDS.acmePan);
    expect(state.world.calls).toEqual([]);
    expect(state.world.tables.auditEvent).toEqual([]);
  });

  it("no match: says what was searched and what to try", async () => {
    as(PEOPLE.priya);
    const html = decode(await page({ q: "zzqq" }));
    expect(html).toContain("No results for “zzqq”");
    expect(html).toContain("Check the spelling, try the client code, or use fewer words.");
  });

  it("a too-short query in the address shows the sentence, not an error code", async () => {
    as(PEOPLE.priya);
    const html = decode(await page({ q: "a" }));
    expect(html).toContain("Type at least 2 characters to search.");
    expect(html).not.toMatch(/\b400\b/);
  });
});

describe("panel", () => {
  it("identifier results say they were searched by a masked identifier and logged", async () => {
    const html = decode(
      await renderHtml(
        <SearchPanel
          types={["client"]}
          initialQuery=""
          initialType={null}
          initialNotice={null}
          initial={{
            query: "XXXXXX234F",
            mode: "identifier",
            identifier: { kind: "pan", masked: "XXXXXX234F" },
            total: 1,
            message: null,
            types: ["client"],
            groups: [{ type: "client", label: "Clients", more: true, hits: [{ type: "client", id: "c-acme", label: "Acme", context: "Matched PAN XXXXXX234F", href: "/clients/c-acme", rank: 0, at: "2026-11-01" }] }],
          }}
        />,
      ),
    );
    expect(html).toContain("Searched by PAN XXXXXX234F. Searches by PAN, GSTIN, phone or email are logged.");
    expect(html).toContain("Showing the first 1.");
    expect(html).toContain("Show only clients");
  });

  it("no-results text follows the mode and the filter", () => {
    const base = { query: "acme", mode: "text" as const, identifier: null, groups: [], total: 0, message: null, types: [] };
    expect(noResultsText(base, null)).toEqual({ title: "No results for “acme”", tip: "Check the spelling, try the client code, or use fewer words." });
    expect(noResultsText(base, "draft").tip).toBe("Nothing in comms drafts matches. Try all types, the client code, or fewer words.");
    expect(noResultsText({ ...base, query: "", mode: "partial", message: "Search by PAN needs the full 10-character PAN." }, null)).toEqual({ title: "No results", tip: "Search by PAN needs the full 10-character PAN." });
  });
});
