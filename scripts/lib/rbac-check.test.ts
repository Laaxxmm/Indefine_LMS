// verify:rbac rules on in-memory programs: a route needs an auth guard and a policy check on its
// call graph, the expected-policy table is enforced, and stale table rows fail.
import { describe, expect, it } from "vitest";
import { AUTH_SOURCES, checkRbac, EXPECTED_POLICIES, PREFLIGHT_ROUTES, preflightDataCall, type ExpectedPolicy } from "./rbac-check";
import { CallGraph, createMemoryProgram, type CallSite } from "./route-graph";

const LIB = {
  "src/lib/auth.ts": "declare function NextAuth(c: unknown): { auth: () => Promise<{ user?: { id: string } } | null> };\nexport const { auth } = NextAuth({});",
  "src/lib/cron-auth.ts": "export function cronUnauthorized(req: unknown) { return bearerUnauthorized(req, 'x'); }\nexport function bearerUnauthorized(req: unknown, s: string) { return req && s ? null : 401; }",
  "src/lib/agents/access.ts": "export function canViewJob(u: unknown, j: unknown) { return !!u && !!j; }\nexport const canDecideMistakes = (u: unknown) => has(u);\nconst has = (u: unknown) => !!u;",
  "src/lib/rbac/policy.ts": "export { canViewJob, canDecideMistakes } from '@/lib/agents/access';\nexport function canSpotCheck(u: unknown) { return !!u; }",
  "src/lib/svc.ts": [
    "import { canViewJob, canDecideMistakes } from '@/lib/rbac/policy';",
    "export async function approve(u: unknown, id: string) { if (!canViewJob(u, { id })) return 404; return 200; }",
    "export async function decide(u: unknown) { if (!canDecideMistakes(u)) return 403; return 200; }",
    "export async function open(u: unknown) { return u ? 200 : 401; }",
  ].join("\n"),
};

const route = (body: string, imports = "import { auth } from '@/lib/auth';\nimport { approve, decide, open } from '@/lib/svc';") => `${imports}\n${body}`;

function check(routes: Record<string, string>, table: ExpectedPolicy[] = [], preflights: { route: string; why: string }[] = []) {
  const { program, root } = createMemoryProgram({ ...LIB, ...COMPANION, ...routes });
  return checkRbac(new CallGraph(program, root), Object.keys(routes).sort(), table, preflights);
}

// A pairing-token verifier (bearer credential of the Companion extension), a data provider and a
// preflight helper, shaped like src/lib/companion/{tokens,http}.ts.
const COMPANION = {
  "src/lib/companion/tokens.ts": [
    "declare const db: { companionToken: { findUnique(a: unknown): Promise<{ userId: string } | null> } };",
    "export async function verifyPairing(raw: string | null) { const row = raw ? await db.companionToken.findUnique({ where: { tokenHash: raw } }) : null; return row ? { ok: true as const, userId: row.userId } : { ok: false as const }; }",
  ].join("\n"),
  "src/lib/companion/http.ts": [
    "import { verifyPairing } from '@/lib/companion/tokens';",
    "import { canSpotCheck } from '@/lib/rbac/policy';",
    "declare const db: { jobTask: { findMany(a: unknown): Promise<unknown[]> } };",
    "export function preflight(origin: string | null) { return origin === 'chrome-extension://x' ? 204 : 403; }",
    "export async function leakyPreflight(origin: string | null) { return origin ? db.jobTask.findMany({}) : 403; }",
    "export async function nextTaskRoute(raw: string | null) { const v = await verifyPairing(raw); if (!v.ok) return 401; return canSpotCheck({ id: v.userId }) ? 200 : 403; }",
  ].join("\n"),
};
const PREFLIGHT = [{ route: "/api/firm-os/companion/next-task", why: "extension CORS preflight" }];

describe("verify:rbac", () => {
  it("passes a route that checks the session and reaches a policy (through a service and a re-export)", () => {
    const r = check({ "src/app/api/firm-os/runs/[id]/approve/route.ts": route("export async function POST() { const s = await auth(); return approve(s?.user, 'x'); }") });
    expect(r.violations).toEqual([]);
    expect(r.results[0]).toMatchObject({ auth: ["auth"], policies: ["canViewJob"] });
    expect(r.notes[0]).toMatch(/POST \/api\/firm-os\/runs\/\[id\]\/approve .* is not in EXPECTED_POLICIES/);
  });

  it("fails a route with no auth guard", () => {
    const r = check({ "src/app/api/firm-os/runs/[id]/approve/route.ts": route("export async function POST() { return approve(null, 'x'); }") });
    expect(r.violations).toEqual([expect.stringMatching(/POST \/api\/firm-os\/runs\/\[id\]\/approve .*no auth guard/)]);
  });

  it("fails a route that checks the session but calls no policy", () => {
    const r = check({ "src/app/api/firm-os/open/route.ts": route("export async function POST() { const s = await auth(); return open(s?.user); }") });
    expect(r.violations).toEqual([expect.stringMatching(/no policy check/)]);
  });

  it("does not take a local function named auth, or an internal helper, for a guard or a policy", () => {
    const r = check({
      "src/app/api/firm-os/fake/route.ts": "import { open } from '@/lib/svc';\nconst auth = async () => ({ user: { id: 'x' } });\nexport async function POST() { const s = await auth(); return open(s.user); }",
    });
    expect(r.violations).toEqual([expect.stringMatching(/no auth guard/), expect.stringMatching(/no policy check/)]);
  });

  it("accepts the cron secret as both guard and policy for system routes", () => {
    const r = check({ "src/app/api/cron/firm-os/job/route.ts": "import { cronUnauthorized } from '@/lib/cron-auth';\nexport async function GET(req: unknown) { return cronUnauthorized(req) ?? 200; }" });
    expect(r.violations).toEqual([]);
    expect(r.results[0].policies).toContain("cronUnauthorized");
  });

  it("enforces the expected-policy table: the right policy, not just any policy", () => {
    const table: ExpectedPolicy[] = [{ route: "/api/firm-os/mistakes/[id]/decide", method: "POST", policies: ["canDecideMistakes"], why: "partner only" }];
    const ok = check({ "src/app/api/firm-os/mistakes/[id]/decide/route.ts": route("export async function POST() { const s = await auth(); return decide(s?.user); }") }, table);
    expect(ok.violations).toEqual([]);
    expect(ok.notes).toEqual([]);
    const swapped = check({ "src/app/api/firm-os/mistakes/[id]/decide/route.ts": route("export async function POST() { const s = await auth(); return approve(s?.user, 'x'); }") }, table);
    expect(swapped.violations).toEqual([expect.stringMatching(/expected policy not reached: canDecideMistakes \(partner only\)/)]);
  });

  it("fails a stale table row and a route file with no handler", () => {
    const table: ExpectedPolicy[] = [{ route: "/api/firm-os/gone", method: "POST", policies: ["canViewJob"], why: "x" }];
    const r = check({ "src/app/api/firm-os/empty/route.ts": "export const dynamic = 'force-dynamic';" }, table);
    expect(r.violations).toEqual([expect.stringMatching(/empty\/route\.ts: no exported HTTP handler/), expect.stringMatching(/POST \/api\/firm-os\/gone: in EXPECTED_POLICIES but no such route handler/)]);
    expect(r.stale).toHaveLength(1);
  });

  it("checks every exported method of a route separately", () => {
    const r = check({ "src/app/api/firm-os/x/route.ts": route("export async function GET() { const s = await auth(); return approve(s?.user, 'x'); }\nexport async function POST() { return open(null); }") });
    expect(r.results.map((x) => [x.handler.method, x.problems.length])).toEqual([
      ["GET", 0],
      ["POST", 2],
    ]);
  });

  it("accepts the Companion pairing-token verifier as an auth guard, only from src/lib/companion/tokens.ts", () => {
    const routeFile = "src/app/api/firm-os/companion/next-task/route.ts";
    const ok = check({ [routeFile]: "import { nextTaskRoute } from '@/lib/companion/http';\nexport async function GET() { return nextTaskRoute('t'); }" });
    const r = ok.results.find((x) => x.handler.file === routeFile)!;
    expect(r).toMatchObject({ auth: ["verifyPairing"], policies: ["canSpotCheck"], problems: [] });
    // A local function that happens to be called verifyPairing is not a credential check.
    const fake = check({
      [routeFile]: "import { canSpotCheck } from '@/lib/rbac/policy';\nasync function verifyPairing(raw: string) { return { ok: true, userId: raw }; }\nexport async function GET() { const v = await verifyPairing('t'); return canSpotCheck({ id: v.userId }) ? 200 : 403; }",
    });
    expect(fake.violations).toEqual([expect.stringMatching(/GET \/api\/firm-os\/companion\/next-task .*no auth guard/)]);
    // The token check is authentication only: it never stands in for a policy.
    const noPolicy = check({ [routeFile]: "import { verifyPairing } from '@/lib/companion/tokens';\nexport async function GET() { return (await verifyPairing('t')).ok ? 200 : 401; }" });
    expect(noPolicy.violations.filter((v) => v.includes(routeFile))).toEqual([expect.stringMatching(/no policy check/)]);
  });

  it("lets a listed CORS preflight answer without auth or policy, and nothing else", () => {
    const routeFile = "src/app/api/firm-os/companion/next-task/route.ts";
    const src = (options: string) =>
      `import { nextTaskRoute, preflight, leakyPreflight } from '@/lib/companion/http';\nexport async function GET() { return nextTaskRoute('t'); }\nexport async function OPTIONS() { return ${options}; }`;
    // Listed, OPTIONS, no data on its graph: passes; the GET beside it is still checked in full.
    const ok = check({ [routeFile]: src("preflight('chrome-extension://x')") }, [], PREFLIGHT);
    expect(ok.violations).toEqual([]);
    expect(ok.results.find((x) => x.handler.method === "OPTIONS")?.policies).toEqual(["(cors-preflight)"]);
    expect(ok.results.find((x) => x.handler.method === "GET")).toMatchObject({ auth: ["verifyPairing"], policies: ["canSpotCheck"] });
    // Not listed: an OPTIONS handler is an ordinary handler (no blanket allow for OPTIONS).
    const unlisted = check({ [routeFile]: src("preflight('chrome-extension://x')") });
    expect(unlisted.violations).toEqual([expect.stringMatching(/OPTIONS .*no auth guard/), expect.stringMatching(/OPTIONS .*no policy check/)]);
    // Listed but reaching the database: refused — the rule never covers a handler that hands out data.
    const leaky = check({ [routeFile]: src("leakyPreflight('chrome-extension://x')") }, [], PREFLIGHT);
    expect(leaky.violations).toEqual([expect.stringMatching(/OPTIONS \/api\/firm-os\/companion\/next-task .*CORS preflight must not read or write data, but reaches .*db\.jobTask\.findMany \(database\)/)]);
    // Listed for another route, or a stale row: refused.
    const other = check({ "src/app/api/firm-os/other/route.ts": "import { preflight } from '@/lib/companion/http';\nexport async function OPTIONS() { return preflight(null); }"}, [], PREFLIGHT);
    expect(other.violations).toEqual([
      expect.stringMatching(/OPTIONS \/api\/firm-os\/other .*no auth guard/),
      expect.stringMatching(/OPTIONS \/api\/firm-os\/other .*no policy check/),
      expect.stringMatching(/OPTIONS \/api\/firm-os\/companion\/next-task: in PREFLIGHT_ROUTES but no such OPTIONS handler/),
    ]);
  });

  it("classifies preflight data calls: database reads and writes, raw queries and providers — not header reads", () => {
    const c = (over: Partial<CallSite>): CallSite => ({ name: "x", text: "x", receiver: null, targets: [], declFiles: [], line: 1, ...over });
    expect(preflightDataCall(c({ name: "findUnique", text: "db.user.findUnique", receiver: "db.user" }))).toMatch(/database/);
    expect(preflightDataCall(c({ name: "$queryRaw", text: "db.$queryRaw", receiver: "db" }))).toMatch(/database/);
    expect(preflightDataCall(c({ name: "nextTask", text: "deps.provider.nextTask", receiver: "deps.provider" }))).toMatch(/data provider/);
    expect(preflightDataCall(c({ name: "get", text: "req.headers.get", receiver: "req.headers" }))).toBeNull();
    expect(preflightDataCall(c({ name: "includes", text: "origins.includes", receiver: "origins" }))).toBeNull();
  });

  it("ships exactly one preflight row, for the Companion's next-task, with a reason", () => {
    expect(PREFLIGHT_ROUTES.map((p) => p.route)).toEqual(["/api/firm-os/companion/next-task"]);
    expect(PREFLIGHT_ROUTES[0].why.length).toBeGreaterThan(20);
    expect(AUTH_SOURCES.verifyPairing).toBe("src/lib/companion/tokens.ts");
  });

  it("ships a table with one row per method, each with a reason and at least one policy", () => {
    const keys = EXPECTED_POLICIES.map((e) => `${e.method} ${e.route}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of EXPECTED_POLICIES) {
      expect(e.policies.length, e.route).toBeGreaterThan(0);
      expect(e.why.length, e.route).toBeGreaterThan(5);
    }
    expect(EXPECTED_POLICIES.find((e) => e.route.endsWith("/mistakes/[id]/decide"))?.policies).toEqual(["canDecideMistakes"]);
  });
});
