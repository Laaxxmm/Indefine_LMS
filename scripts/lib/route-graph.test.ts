// The call graph behind verify:rbac and verify:audit-coverage, on in-memory programs.
import { describe, expect, it } from "vitest";
import { CallGraph, createMemoryProgram, discoverFirmOsRoutes, routePath } from "./route-graph";

function graphOf(files: Record<string, string>) {
  const { program, root } = createMemoryProgram(files);
  return new CallGraph(program, root);
}
const names = (g: CallGraph, file: string, method = "POST") => g.reachable(g.handlers(file).find((h) => h.method === method)!.fn).map((f) => f.name).sort();

describe("discovery", () => {
  it("finds route.ts files under Firm OS directories only", () => {
    expect(
      discoverFirmOsRoutes([
        "src/app/api/firm-os/jobs/[id]/state/route.ts",
        "src/app/api/cron/firm-os/retention/route.ts",
        "src/app/api/firm-os/comms/drafts/route.ts",
        "src/app/api/clients/route.ts",
        "src/app/api/firm-os/jobs/[id]/state/helpers.ts",
        "src\\app\\api\\firm-os\\onboard\\start\\route.ts",
      ]),
    ).toEqual(["src/app/api/cron/firm-os/retention/route.ts", "src/app/api/firm-os/comms/drafts/route.ts", "src/app/api/firm-os/jobs/[id]/state/route.ts", "src/app/api/firm-os/onboard/start/route.ts"]);
    expect(routePath("src/app/api/firm-os/jobs/[id]/state/route.ts")).toBe("/api/firm-os/jobs/[id]/state");
  });

  it("reads exported handlers written as functions or as const arrows, and nothing else", () => {
    const g = graphOf({
      "src/app/api/firm-os/a/route.ts": [
        "export async function GET() { return 1; }",
        "export const POST = async () => 2;",
        "export const dynamic = 'force-dynamic';",
        "function PUT() { return 3; }",
        "export function helper() {}",
      ].join("\n"),
    });
    expect(g.handlers("src/app/api/firm-os/a/route.ts").map((h) => [h.method, h.route])).toEqual([
      ["GET", "/api/firm-os/a"],
      ["POST", "/api/firm-os/a"],
    ]);
    expect(g.handlers("src/app/api/firm-os/missing/route.ts")).toEqual([]);
  });
});

describe("resolution", () => {
  it("follows imports, aliases, barrels (export * and export { a as b }), and stops at non-src code", () => {
    const g = graphOf({
      "src/app/api/firm-os/a/route.ts": "import { svc, other as renamed } from '@/lib/barrel';\nimport { ext } from 'some-package';\nexport async function POST() { await svc(); renamed(); ext(); }",
      "src/lib/barrel.ts": "export * from './svc';\nexport { inner as other } from './inner';",
      "src/lib/svc.ts": "import { deep } from './deep';\nexport async function svc() { return deep(); }",
      "src/lib/inner.ts": "export const inner = () => 1;",
      "src/lib/deep.ts": "export function deep() { return local(); }\nfunction local() { return 2; }",
    });
    expect(names(g, "src/app/api/firm-os/a/route.ts")).toEqual(["POST", "deep", "inner", "local", "svc"]);
  });

  it("follows class methods, this.method(), object-literal factories and shorthand properties", () => {
    const g = graphOf({
      "src/app/api/firm-os/a/route.ts": "import { makeService, Store } from '@/lib/svc';\nexport async function POST() { await makeService().start('x'); new Store().save(); }",
      "src/lib/svc.ts": [
        "export class Store { save() { return this.write(); } private write() { return 1; } }",
        "function helper() { return 2; }",
        "export function makeService() { return { async start(p: string) { return helper(); }, helper }; }",
      ].join("\n"),
    });
    expect(names(g, "src/app/api/firm-os/a/route.ts")).toEqual(["POST", "Store.save", "Store.write", "helper", "makeService", "object.start"]);
  });

  it("records calls through interface-typed parameters by name, with no body to follow", () => {
    const g = graphOf({
      "src/app/api/firm-os/a/route.ts": "import { run } from '@/lib/svc';\nexport async function POST() { await run({ audit: async () => {} }); }",
      "src/lib/svc.ts": "export interface Deps { audit(e: unknown): Promise<void> }\nexport async function run(deps: Deps) { await deps.audit({}); await deps.db?.x; }",
    });
    const run = g.reachable(g.handlers("src/app/api/firm-os/a/route.ts")[0].fn).find((f) => f.name === "run")!;
    const call = g.callsOf(run).find((c) => c.name === "audit")!;
    expect(call).toMatchObject({ name: "audit", text: "deps.audit", receiver: "deps", targets: [] });
    expect(call.declFiles).toEqual(["src/lib/svc.ts"]);
  });

  it("knows which functions a module exports", () => {
    const g = graphOf({
      "src/app/api/firm-os/a/route.ts": "import { pub } from '@/lib/p';\nexport async function POST() { pub(); }",
      "src/lib/p.ts": "const priv = () => 1;\nexport const pub = () => priv();\nconst late = () => 2;\nexport { late };",
    });
    const fns = g.reachable(g.handlers("src/app/api/firm-os/a/route.ts")[0].fn);
    expect(fns.filter((f) => g.isExported(f)).map((f) => f.name).sort()).toEqual(["POST", "pub"]);
    expect(g.isExported(fns.find((f) => f.name === "priv")!)).toBe(false);
  });

  it("stops at maxDepth and survives recursion", () => {
    const g = graphOf({
      "src/app/api/firm-os/a/route.ts": "import { a } from '@/lib/r';\nexport async function POST() { a(); }",
      "src/lib/r.ts": "export function a(): number { return b(); }\nfunction b(): number { return c() + a(); }\nfunction c() { return 1; }",
    });
    const h = g.handlers("src/app/api/firm-os/a/route.ts")[0].fn;
    expect(g.reachable(h).map((f) => f.name).sort()).toEqual(["POST", "a", "b", "c"]);
    expect(g.reachable(h, 1).map((f) => f.name).sort()).toEqual(["POST", "a"]);
  });
});
