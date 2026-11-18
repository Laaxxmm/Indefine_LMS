// The Firm OS master switch on every API route (FIRM_OS_ENABLED, default off; src/lib/workspace/flag.ts).
// Enumerates src/app/api/firm-os/** at test time, so a new route that forgets the one-line guard
// fails here: with the switch off, every exported method answers 404 with the plain sentence
// before it reads the session or the database. Exceptions, on owner decisions: the DPDP privacy
// and breach registers (privacy/**) and the workspace rollout routes (workspace/roles, users)
// stay open. The close-loop and coach crons answer 200 "skipped" after the CRON_SECRET check;
// the retention cron keeps running.
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each case cold-imports a route module (and its whole service graph). Fast alone; under full-suite
// load beside parallel builds one import exceeded the 20 s default once. Import time, not a race.
vi.setConfig({ testTimeout: 60_000 });

const touched = vi.hoisted(() => ({ auth: 0, prisma: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => {
    touched.auth += 1;
    return null;
  }),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key === "string" && key !== "then") touched.prisma.push(key);
        return new Proxy(() => undefined, { get: () => async () => null, apply: async () => null });
      },
    },
  ),
}));

const { FIRM_OS_OFF_MESSAGE } = await import("@/lib/workspace/flag");

const API = join(process.cwd(), "src", "app", "api", "firm-os");
const EXEMPT = [/^privacy\//, /^workspace\/roles\//, /^workspace\/users\//];
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? routeFiles(join(dir, d.name)) : d.name === "route.ts" ? [join(dir, d.name)] : []));
}
const rel = (f: string) => relative(API, f).split(sep).join("/");
const all = routeFiles(API).map((f) => ({ file: f, path: rel(f) }));
const gated = all.filter((r) => !EXEMPT.some((x) => x.test(r.path)));
const open = all.filter((r) => EXEMPT.some((x) => x.test(r.path)));

const params = { params: Promise.resolve({ id: "x", agent: "echo", jobId: "x", role: "staff", userId: "x", tool: "x" }) };
const request = (method: string) => new Request("http://x/api/firm-os", { method, headers: { "content-type": "application/json", origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" }, body: method === "GET" || method === "OPTIONS" ? undefined : "{}" });

beforeEach(() => {
  touched.auth = 0;
  touched.prisma.length = 0;
  vi.stubEnv("FIRM_OS_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("FIRM_OS_ENABLED off: every Firm OS API route is closed", () => {
  it("finds the routes (a sanity check on the enumeration)", () => {
    expect(gated.length).toBeGreaterThan(25);
    expect(open.map((r) => r.path).some((p) => p.startsWith("privacy/"))).toBe(true);
    expect(gated.map((r) => r.path)).toContain("workspace/next-task/route.ts");
  });

  it.each(gated.map((r) => [r.path, r.file]))("%s answers 404 with the plain sentence for every method, before reading the session or the database", async (_p, file) => {
    const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
    const handlers = METHODS.filter((m) => typeof mod[m] === "function");
    expect(handlers.length, "exports at least one HTTP method").toBeGreaterThan(0);
    for (const m of handlers) {
      const res = (await (mod[m] as (req: Request, ctx: unknown) => Promise<Response>)(request(m), params)) as Response;
      expect(res.status, m).toBe(404);
      expect(await res.json(), m).toEqual({ error: FIRM_OS_OFF_MESSAGE });
    }
    expect(touched.auth).toBe(0);
    expect(touched.prisma).toEqual([]);
  });

  it.each(open.map((r) => [r.path, r.file]))("%s stays open (DPDP registers and workspace rollout): it reaches its own auth check", async (_p, file) => {
    const mod = (await import(/* @vite-ignore */ file)) as Record<string, unknown>;
    for (const m of METHODS.filter((x) => typeof mod[x] === "function")) {
      const res = (await (mod[m] as (req: Request, ctx: unknown) => Promise<Response>)(request(m), params)) as Response;
      expect(res.status, m).toBe(401); // signed out — not the master-switch 404
    }
    expect(touched.auth).toBeGreaterThan(0);
  });

  it("the close-loop and coach crons skip with 200 after the secret check; a wrong secret is still 401", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const { NextRequest } = await import("next/server");
    for (const path of ["close-loop", "coach"]) {
      const { GET } = (await import(`@/app/api/cron/firm-os/${path}/route`)) as { GET: (r: InstanceType<typeof NextRequest>) => Promise<Response> };
      const ok = await GET(new NextRequest(`http://x/api/cron/firm-os/${path}?job=morning`, { headers: { authorization: "Bearer s3cret" } }));
      expect(ok.status, path).toBe(200);
      expect(await ok.json()).toEqual({ ok: true, skipped: FIRM_OS_OFF_MESSAGE });
      const denied = await GET(new NextRequest(`http://x/api/cron/firm-os/${path}`, { headers: { authorization: "Bearer wrong" } }));
      expect(denied.status, path).toBe(401);
    }
    expect(touched.prisma).toEqual([]);
  });
});
