// verify:audit-coverage (Phase 11): every mutating Firm OS route handler (POST/PUT/PATCH/DELETE,
// cron routes, downloads) writes an AuditEvent, and every database write it reaches has an audit
// write on its path. Static analysis over the TypeScript call graph (scripts/lib/audit-check.ts);
// routes are discovered under the Firm OS directories, so new routes are checked without
// registration. Exit 1 on any uncovered handler or write.
import { join } from "node:path";
import { checkAuditCoverage } from "./lib/audit-check";
import { listRepoFiles } from "./lib/repo-files";
import { CallGraph, createRepoProgram, discoverFirmOsRoutes } from "./lib/route-graph";

const ROOT = join(__dirname, "..");
const routes = discoverFirmOsRoutes(listRepoFiles());
const graph = new CallGraph(createRepoProgram(ROOT, routes), ROOT);
const report = checkAuditCoverage(graph, routes);
const verbose = process.argv.includes("--verbose");

for (const f of report.findings) {
  if (verbose || f.problems.length) {
    const kinds = [...new Set(f.sinks.map((s) => s.kind))].join(",") || "-";
    console.log(`${f.problems.length ? "FAIL" : "ok  "} ${f.handler.method.padEnd(5)} ${f.handler.route}  audit=${kinds}`);
  }
}
for (const n of report.notes) console.log(`verify-audit-coverage: note: ${n}`);
if (report.violations.length) {
  for (const v of report.violations) console.log(v);
  console.error(`verify-audit-coverage: FAILED — ${report.violations.length} problem(s) in ${report.checked} mutating handler(s)`);
  process.exit(1);
}
console.log(`verify-audit-coverage: OK — ${report.checked} mutating Firm OS handler(s) write an AuditEvent on every write path (${report.skipped} read-only handler(s) skipped)`);
