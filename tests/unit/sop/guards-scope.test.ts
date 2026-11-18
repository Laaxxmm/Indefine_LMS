// SOP review M2: the SOP Builder routes are inside the verify:rbac and verify:audit-coverage scope
// (scripts/lib/guards.ts GUARDED_ROUTE_DIRS), and on the real tree every one of them checks the
// session, reaches its SOP policy and writes an AuditEvent on every write path. The other Firm OS
// rules (no-delete, no-portal, AI boundary) are not widened to them.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAuditCoverage } from "../../../scripts/lib/audit-check";
import { GUARDED_ROUTE_DIRS, inNoDeleteScope, isFirmOs } from "../../../scripts/lib/guards";
import { checkRbac } from "../../../scripts/lib/rbac-check";
import { listRepoFiles } from "../../../scripts/lib/repo-files";
import { CallGraph, createRepoProgram, discoverFirmOsRoutes } from "../../../scripts/lib/route-graph";

const ROOT = join(__dirname, "..", "..", "..");
const SOP = "src/app/api/tools/sop-builder/";

describe("SOP Builder routes in the RBAC and audit guards", () => {
  const all = listRepoFiles().filter((p) => p.startsWith(SOP) && p.endsWith("/route.ts"));
  const routes = discoverFirmOsRoutes(listRepoFiles()).filter((p) => p.startsWith(SOP));

  it("every SOP Builder route file is discovered; only the two guards widen", () => {
    expect(GUARDED_ROUTE_DIRS).toEqual(["src/app/api/tools/sop-builder"]);
    expect(all.length).toBeGreaterThanOrEqual(11);
    expect(routes.sort()).toEqual(all.sort());
    expect(all.some((p) => isFirmOs(p) || inNoDeleteScope(p))).toBe(false);
  });

  it("each handler checks the session, reaches its SOP policy and audits every write (what verify:firm-os runs)", () => {
    const graph = new CallGraph(createRepoProgram(ROOT, routes), ROOT);
    const rbac = checkRbac(graph, routes, undefined, []);
    // Only the SOP rows of the table can match these routes; the rest are reported stale here.
    expect(rbac.violations.filter((v) => v.includes("/api/tools/sop-builder"))).toEqual([]);
    expect(rbac.results.length).toBe(11);
    for (const r of rbac.results) {
      expect(r.auth, r.handler.route).toContain("auth");
      expect(r.expected, `${r.handler.method} ${r.handler.route} has a row in EXPECTED_POLICIES`).not.toBeNull();
    }
    const remove = rbac.results.find((r) => r.handler.route.endsWith("/remove"))!;
    expect(remove.policies).toEqual(["canRemoveSopScreen"]);

    const audit = checkAuditCoverage(graph, routes, []);
    expect(audit.violations).toEqual([]);
    expect(audit.checked).toBe(10); // every POST / DELETE, plus the Word download (an export); the image GET is read-only
  }, 120_000);
});
