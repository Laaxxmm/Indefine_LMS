// verify:rbac (Phase 11): every Firm OS route handler checks who is calling (NextAuth session or
// the cron secret) and calls a policy from src/lib/rbac/policy.ts (or the modules it composes);
// routes in the expected-policy table reach exactly the policy the table names. Static analysis
// over the TypeScript call graph (scripts/lib/route-graph.ts); routes are discovered, not listed.
// Exit 1 on any route without a guard or policy, a missing expected policy, or a stale table row.
import { join } from "node:path";
import { checkRbac } from "./lib/rbac-check";
import { listRepoFiles } from "./lib/repo-files";
import { CallGraph, createRepoProgram, discoverFirmOsRoutes } from "./lib/route-graph";

const ROOT = join(__dirname, "..");
const routes = discoverFirmOsRoutes(listRepoFiles());
const graph = new CallGraph(createRepoProgram(ROOT, routes), ROOT);
const report = checkRbac(graph, routes);
const verbose = process.argv.includes("--verbose");

for (const r of report.results) {
  if (verbose || r.problems.length) {
    const tag = r.problems.length ? "FAIL" : "ok  ";
    console.log(`${tag} ${r.handler.method.padEnd(5)} ${r.handler.route}  auth=${r.auth.join(",") || "-"}  policy=${r.policies.join(",") || "-"}`);
  }
}
for (const n of report.notes) console.log(`verify-rbac: note: ${n}`);
if (report.violations.length) {
  for (const v of report.violations) console.log(v);
  console.error(`verify-rbac: FAILED — ${report.violations.length} problem(s) across ${report.results.length} handler(s)`);
  process.exit(1);
}
console.log(`verify-rbac: OK — ${report.results.length} Firm OS handler(s) in ${routes.length} route file(s) check auth and policy`);
