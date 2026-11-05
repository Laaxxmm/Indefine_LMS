// verify:rbac rules on in-memory programs: a route needs an auth guard and a policy check on its
// call graph, the expected-policy table is enforced, and stale table rows fail.
import { describe, expect, it } from "vitest";
import { checkRbac, EXPECTED_POLICIES, type ExpectedPolicy } from "./rbac-check";
import { CallGraph, createMemoryProgram } from "./route-graph";

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

function check(routes: Record<string, string>, table: ExpectedPolicy[] = []) {
  const { program, root } = createMemoryProgram({ ...LIB, ...routes });
  return checkRbac(new CallGraph(program, root), Object.keys(routes).sort(), table);
}

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
