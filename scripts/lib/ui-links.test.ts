import { describe, expect, it } from "vitest";
import {
  WILD,
  attrValue,
  blankTargetIssues,
  buildManifest,
  checkUiLinks,
  extractTargets,
  isScanned,
  parseExportedMethods,
  parseSegments,
  routeFromFile,
  routesMatching,
  scanLiterals,
  type SourceFile,
} from "./ui-links";
import { listRepoFiles, loadFiles } from "./repo-files";

const W = WILD;
const page = (path: string, content = "export default function P() { return null; }"): SourceFile => ({ path, content });
const route = (path: string, ...methods: string[]): SourceFile => ({ path, content: methods.map((m) => `export async function ${m}() {}`).join("\n") });
const targetsOf = (content: string, path = "src/app/x/Panel.tsx") => extractTargets({ path, content });

describe("route manifest", () => {
  it("maps app files to URL patterns", () => {
    expect(routeFromFile("src/app/page.tsx")).toEqual({ path: "/", kind: "page" });
    expect(routeFromFile("src/app/agents/[agent]/runs/[id]/page.tsx")).toEqual({ path: "/agents/[agent]/runs/[id]", kind: "page" });
    expect(routeFromFile("src/app/api/work/[id]/route.ts")).toEqual({ path: "/api/work/[id]", kind: "route" });
    expect(routeFromFile("src/app/(portal)/onboard/page.tsx")).toEqual({ path: "/onboard", kind: "page" });
    expect(routeFromFile("src/app/dash/@modal/page.tsx")).toEqual({ path: "/dash", kind: "page" });
    expect(routeFromFile("src/app/icon.svg")).toEqual({ path: "/icon.svg", kind: "static" });
    expect(routeFromFile("src\\app\\work\\board\\page.tsx")).toEqual({ path: "/work/board", kind: "page" });
  });

  it("ignores non-routes: private folders, intercepting routes, panels, files outside the app dir", () => {
    expect(routeFromFile("src/app/tools/_components/page.tsx")).toBeNull();
    expect(routeFromFile("src/app/feed/(.)photo/page.tsx")).toBeNull();
    expect(routeFromFile("src/app/agents/parts.tsx")).toBeNull();
    expect(routeFromFile("src/lib/page.tsx")).toBeNull();
  });

  it("parses dynamic, catch-all and optional catch-all segments", () => {
    expect(parseSegments("/a/[id]/[...slug]/[[...rest]]")).toEqual([
      { kind: "static", value: "a" },
      { kind: "dynamic", name: "id" },
      { kind: "catchall", name: "slug" },
      { kind: "optional-catchall", name: "rest" },
    ]);
  });

  it("reads the HTTP methods a route.ts exports, in every export form", () => {
    expect(parseExportedMethods("export async function GET() {}\nexport function POST() {}")).toEqual(["GET", "POST"]);
    expect(parseExportedMethods("export const PATCH = async () => {};")).toEqual(["PATCH"]);
    expect(parseExportedMethods("export const { GET, POST } = handlers;")).toEqual(["GET", "POST"]);
    expect(parseExportedMethods('export { GET, POST } from "@/lib/auth-handlers";')).toEqual(["GET", "POST"]);
    expect(parseExportedMethods("const h = () => {};\nexport { h as PUT };")).toEqual(["PUT"]);
    expect(parseExportedMethods("// export async function DELETE() {}\nexport async function GET() {}\nexport const maxDuration = 60;")).toEqual(["GET"]);
  });
});

describe("lexer", () => {
  it("skips comments and regex literals; an apostrophe in JSX text does not swallow the next line", () => {
    const src = [
      '// href="/nope"',
      "/* fetch('/api/nope') */",
      'const re = /["\']+/g; const ok = "/yes";',
      "<p>Don't panic</p>",
      '<a href="/after">x</a>',
      "</div><Link href=\"/closing\" />",
    ].join("\n");
    expect(scanLiterals(src).map((l) => l.parts.join(W))).toEqual(["/yes", "/after", "/closing"]);
  });

  it("splits template literals into parts and expressions, and finds literals nested in ${…}", () => {
    const [outer, inner] = scanLiterals("const u = `/a/${id}/b/${x ? \"/c\" : y}`;");
    expect(outer.parts).toEqual(["/a/", "/b/", ""]);
    expect(outer.exprs).toEqual(["id", 'x ? "/c" : y']);
    expect(inner.parts).toEqual(["/c"]);
  });
});

describe("target extraction", () => {
  it("finds JSX hrefs, Link templates, href: props, redirects and router calls", () => {
    const t = targetsOf(
      [
        '<a href="/clients">All</a>',
        "<Link href={`/agents/${a.key}`}>x</Link>",
        'const items = [{ href: "/admin/live", label: "Live" }];',
        'if (!session) redirect("/");',
        "router.push(`/agents/${agent}/runs/${String(r.data.runId)}`);",
        'router.replace("/onboard", { scroll: false });',
        '<Link href={done ? "/work" : "/work/board"}>y</Link>',
        'await signOut({ redirectTo: "/" });',
      ].join("\n"),
    );
    expect(t.map((x) => [x.via, x.pattern])).toEqual([
      ["<a> href", "/clients"],
      ["Link href", `/agents/${W}`],
      ["href:", "/admin/live"],
      ["redirect", "/"],
      ["router", `/agents/${W}/runs/${W}`],
      ["router", "/onboard"],
      ["Link href", "/work"],
      ["Link href", "/work/board"],
      ["redirectTo", "/"],
    ]);
    expect(t.every((x) => x.kind === "nav" && x.method === "GET")).toBe(true);
  });

  it("drops query and hash, skips in-page anchors and string replace / array push", () => {
    const t = targetsOf(
      [
        '<a href="/dashboard#courses">c</a>',
        "<Link href={`/onboard?run=${id}`}>r</Link>",
        '<a href="#top">t</a>',
        "<Link href={`?from=${a}`}>q</Link>",
        'const s = name.replace("/", "-");',
        'paths.push("/x", "/y");',
      ].join("\n"),
    );
    expect(t.map((x) => x.pattern)).toEqual(["/dashboard", "/onboard"]);
  });

  it("call() from components/ui posts unless the third argument says otherwise", () => {
    const head = 'import { btnPrimary, call } from "@/components/ui";\n';
    const t = targetsOf(
      head +
        [
          "await call(`/api/firm-os/agents/runs/${id}/submit`);",
          "await call(`/api/work/${id}`, { status }, \"PATCH\");",
          "await call(`/api/x/${id}/preview`, undefined, \"GET\");",
          "await call(\"/api/y\", body, method);",
        ].join("\n"),
    );
    expect(t.map((x) => [x.kind, x.via, x.method])).toEqual([
      ["api-call", "call", "POST"],
      ["api-call", "call", "PATCH"],
      ["api-call", "call", "GET"],
      ["api-call", "call", null],
    ]);
  });

  it("a file's own call() is read as a plain /api literal (method unknown)", () => {
    const t = targetsOf('async function call(url: string, init: RequestInit) {}\ncall(`/api/letters/${id}/file`, { method: "POST" });');
    expect(t.map((x) => [x.kind, x.method])).toEqual([["api-ref", null]]);
  });

  it("fetch() is GET unless its options carry a literal method", () => {
    const t = targetsOf(
      [
        'fetch("/api/a");',
        'fetch(`/api/b/${id}`, { method: "DELETE" });',
        'fetch("/api/c", { method: m, body });',
        'fetch("/api/d", init);',
        'fetch("https://graph.example.test/v1.0/me");',
      ].join("\n"),
    );
    expect(t.map((x) => [x.pattern, x.method, x.external])).toEqual([
      ["/api/a", "GET", false],
      [`/api/b/${W}`, "DELETE", false],
      ["/api/c", null, false],
      ["/api/d", null, false],
      [null, "GET", true],
    ]);
  });

  it("forms: action with the form's method", () => {
    const t = targetsOf('<form action="/api/upload" method="post"><button>Go</button></form>\n<form action="/search"></form>');
    expect(t.map((x) => [x.kind, x.pattern, x.method])).toEqual([
      ["form", "/api/upload", "POST"],
      ["form", "/search", "GET"],
    ]);
  });

  it("resolves ${NAME} through a const in the same file; a const prefix is not a route of its own", () => {
    const t = targetsOf(
      [
        'const API = "/api/firm-os/onboard";',
        "const base = `/api/runs/${encodeURIComponent(runId)}`;",
        'const GRAPH = "https://graph.example.test/v1.0";',
        "go(`${base}/approve`, { note });",
        "call2(`${API}/${path}`, body);",
        "fetch(`${GRAPH}/me/events`);",
      ].join("\n"),
    );
    expect(t.map((x) => [x.kind, x.pattern, x.external])).toEqual([
      ["api-ref", `/api/runs/${W}/approve`, false],
      ["api-ref", `/api/firm-os/onboard/${W}`, false],
      ["api-call", null, true],
    ]);
  });

  it("reads JSX attribute values", () => {
    expect(attrValue('<a href="/x" target="_blank" rel="noreferrer">', "rel")).toBe("noreferrer");
    expect(attrValue("<a target={'_blank'}>", "target")).toBe("_blank");
    expect(attrValue("<a href={x}>", "rel")).toBeNull();
  });
});

describe("matching", () => {
  const m = buildManifest([
    page("src/app/agents/[agent]/page.tsx"),
    page("src/app/docs/[...slug]/page.tsx"),
    page("src/app/shop/[[...path]]/page.tsx"),
    route("src/app/api/work/[id]/route.ts", "PATCH"),
  ]);
  const paths = (p: string) => routesMatching(m, p).map((r) => r.path);

  it("matches dynamic, catch-all and optional catch-all segments", () => {
    expect(paths("/agents/echo")).toEqual(["/agents/[agent]"]);
    expect(paths(`/agents/${W}`)).toEqual(["/agents/[agent]"]);
    expect(paths("/agents/echo/extra")).toEqual([]);
    expect(paths("/docs/a/b")).toEqual(["/docs/[...slug]"]);
    expect(paths("/docs")).toEqual([]);
    expect(paths("/shop")).toEqual(["/shop/[[...path]]"]);
    expect(paths(`/api/work/${W}`)).toEqual(["/api/work/[id]"]);
  });

  it("a wildcard matches a static segment, a partial segment matches by its literal text", () => {
    const m2 = buildManifest([page("src/app/tools/office-tools/rental/page.tsx")]);
    expect(routesMatching(m2, `/tools/${W}/rental`).length).toBe(1);
    expect(routesMatching(m2, `/tools/office-${W}/rental`).length).toBe(1);
    expect(routesMatching(m2, `/tools/sop-${W}/rental`).length).toBe(0);
  });
});

describe("findings", () => {
  const app = [
    page("src/app/page.tsx"),
    page("src/app/dashboard/page.tsx"),
    page("src/app/agents/[agent]/page.tsx"),
    route("src/app/api/runs/[id]/approve/route.ts", "POST"),
    route("src/app/api/files/[id]/route.ts", "GET"),
    route("src/app/api/upload/route.ts", "POST"),
    route("src/app/tools/letter/editor/route.ts", "GET"),
  ];
  const check = (panel: string, extra: SourceFile[] = [], publicFiles: string[] = []) =>
    checkUiLinks([...app, { path: "src/app/x/Panel.tsx", content: panel }, ...extra], { publicFiles }).findings.map((f) => [f.level, f.rule, f.target]);

  it("a nav target with no page is an error; pages, GET handlers and public files are fine", () => {
    expect(check('<a href="/dashbord">x</a>')).toEqual([["error", "nav:no-page", "/dashbord"]]);
    expect(check('<Link href="/dashboard">x</Link><Link href={`/agents/${k}`}>y</Link><a href="/tools/letter/editor">z</a><img /><a href="/logo.png">l</a>', [], ["public/logo.png"])).toEqual([]);
  });

  it("an API call with no route, or whose method the route does not export, is an error", () => {
    const head = 'import { call } from "@/components/ui";\n';
    expect(check(head + 'call("/api/runs/1/aprove");')).toEqual([["error", "api:no-route", "/api/runs/1/aprove"]]);
    expect(check(head + 'call("/api/runs/1/approve", undefined, "GET");')).toEqual([["error", "api:method-not-exported", "/api/runs/1/approve"]]);
    expect(check(head + 'call("/api/runs/1/approve", { note });')).toEqual([]);
    expect(check('fetch("/api/upload");')).toEqual([["error", "api:method-not-exported", "/api/upload"]]);
    expect(check('<form action="/api/upload" method="post"></form>')).toEqual([]);
  });

  it("a download link to /api needs a GET handler; other /api literals need a route", () => {
    expect(check("<a href={`/api/files/${id}`} download>d</a>")).toEqual([]);
    expect(check("<a href={`/api/runs/${id}/approve`}>d</a>")).toEqual([["error", "api:method-not-exported", "/api/runs/${…}/approve"]]);
    expect(check('const url = id ? "/api/nothing/here" : null;')).toEqual([["error", "api-ref:no-route", "/api/nothing/here"]]);
  });

  it('target="_blank" needs rel noopener or noreferrer', () => {
    expect(check('<a href="https://x.test" target="_blank">x</a>')).toEqual([["error", "link:blank-no-noopener", "https://x.test"]]);
    expect(check('<a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a><a href="https://y.test" target="_blank" rel="noreferrer">y</a>')).toEqual([]);
    expect(blankTargetIssues({ path: "src/a.tsx", content: "<Link href={u} target=\"_blank\" rel={rel}>z</Link>" })).toEqual([]);
  });

  it("warns about admin links outside the admin area in a file with no admin check", () => {
    const extra = [page("src/app/admin/page.tsx")];
    expect(check('<Link href="/admin">Admin</Link>', extra)).toEqual([["warn", "nav:admin-ungated", "/admin"]]);
    expect(check('{isAdmin && <Link href="/admin">Admin</Link>}', extra)).toEqual([]);
    expect(checkUiLinks([...app, ...extra, { path: "src/app/admin/AdminNav.tsx", content: '<Link href="/admin">o</Link>' }]).findings).toEqual([]);
  });

  it("scans source files only: no tests, fixtures or declaration files", () => {
    expect(isScanned("src/app/agents/page.tsx")).toBe(true);
    expect(isScanned("src/lib/agents/service.test.ts")).toBe(false);
    expect(isScanned("src/lib/agents/onboarding/__fixtures__/a.ts")).toBe(false);
    expect(isScanned("tests/unit/routes/harness.ts")).toBe(false);
    expect(isScanned("next-env.d.ts")).toBe(false);
  });
});

describe("this repository", () => {
  it("has no broken link, redirect, router target or API call", () => {
    const files = loadFiles((p) => p.startsWith("src/"));
    const result = checkUiLinks(files, { publicFiles: listRepoFiles().filter((p) => p.startsWith("public/")) });
    expect(result.stats.pages).toBeGreaterThan(50);
    expect(result.stats.checked).toBeGreaterThan(300);
    expect(result.findings.filter((f) => f.level === "error")).toEqual([]);
  });
});
