// verify:audit-coverage rules on in-memory programs: the check catches a mutating route without
// logAudit, a write whose path has no audit even when another branch audits, and accepts wrappers.
import { describe, expect, it } from "vitest";
import { AUDIT_EXEMPTIONS, EXPORT_ROUTES, checkAuditCoverage, directSink, isWrite, writeModel, type AuditExemption, type AuditReport } from "./audit-check";
import { CallGraph, createMemoryProgram, type CallSite } from "./route-graph";

const LIB = {
  "src/lib/audit/log.ts": "export interface AuditDb { auditEvent: { create(a: unknown): Promise<{ id: string }> } }\nexport async function logAudit(db: AuditDb, e: unknown) { return db.auditEvent.create({ data: e, select: { id: true } }); }",
  "src/lib/db.ts": "export const db = { job: { update: async (a: unknown) => a, create: async (a: unknown) => a }, auditEvent: { create: async (a: unknown) => ({ id: 'x' }) } };",
  "src/lib/svc.ts": [
    "import { db } from './db';",
    "import { logAudit } from '@/lib/audit/log';",
    "export async function approve(id: string) { await db.job.update({ where: { id } }); await logAudit(db, { action: 'approve' }); }",
    "export async function silent(id: string) { await db.job.update({ where: { id } }); }",
    "export async function parent(id: string) { await logAudit(db, { action: 'p' }); await silent(id); }",
    "export async function branchy(id: string) { await approve(id); await silent(id); }",
    "export async function legacy(id: string) { await db.job.create({ data: { id } }); await db.auditEvent.create({ data: {} }); }",
    "export async function audit(e: unknown) { await logAudit(db, e); }",
    "export async function viaWrapper(id: string) { await db.job.update({ where: { id } }); await audit({ action: 'w' }); }",
    "export interface Deps { audit(e: unknown): Promise<void>; runs: { create(a: unknown): Promise<unknown> } }",
    "export async function injected(d: Deps) { await d.runs.create({}); await d.audit({}); }",
    "export function makeRepo() { return { save: async () => db.job.create({ data: {} }) }; }",
    "export async function hashOnly(h: { update(s: string): void }) { h.update('x'); }",
    "export async function inTx(id: string) { await run(async () => { await db.job.update({ where: { id } }); }); }",
    "async function run(fn: () => Promise<void>) { await fn(); }",
  ].join("\n"),
};

function check(routes: Record<string, string>, exemptions: AuditExemption[] = []): AuditReport {
  const { program, root } = createMemoryProgram({ ...LIB, ...COACH, ...routes });
  return checkAuditCoverage(new CallGraph(program, root), Object.keys(routes).sort(), exemptions);
}

// The break-nudge heartbeat, shaped like src/lib/agents/coach/{activity,db}.ts.
const COACH = {
  "src/lib/coach.ts": [
    "import { logAudit } from '@/lib/audit/log';",
    "export const cdb = { activityHeartbeat: { create: async (a: unknown) => a }, coachEvent: { createMany: async (a: unknown) => a }, coachPreference: { update: async (a: unknown) => a }, auditEvent: { create: async (a: unknown) => ({ id: 'x' }) } };",
    "export async function createOnce(e: unknown) { await cdb.coachEvent.createMany({ data: [e] }); }",
    "export async function heartbeat(u: string) { await cdb.activityHeartbeat.create({ data: { u } }); await createOnce({ u }); }",
    "export async function heartbeatAndPrefs(u: string) { await heartbeat(u); await cdb.coachPreference.update({ where: { u } }); }",
    "export async function heartbeatAudited(u: string) { await heartbeat(u); await logAudit(cdb, { action: 'heartbeat' }); }",
  ].join("\n"),
};
const HEARTBEAT: AuditExemption = { route: "/api/firm-os/coach/heartbeat", method: "POST", models: ["activityHeartbeat", "coachEvent"], why: "ADR-006 (break-nudge data): kept 7 days" };
const coachRoute = (call: string) => `import * as c from '@/lib/coach';\nexport async function POST() { await c.${call}('u1'); }`;
const route = (method: string, body: string) => `import * as s from '@/lib/svc';\nexport async function ${method}() { ${body} }`;

describe("verify:audit-coverage", () => {
  it("passes a mutating route whose service writes and audits", () => {
    const r = check({ "src/app/api/firm-os/a/route.ts": route("POST", "await s.approve('1');") });
    expect(r.violations).toEqual([]);
    expect(r.findings[0].sinks.map((x) => x.kind)).toContain("logAudit");
  });

  it("catches a mutating route that never calls logAudit", () => {
    const r = check({ "src/app/api/firm-os/a/route.ts": route("POST", "await s.silent('1');") });
    expect(r.violations).toEqual([
      expect.stringMatching(/POST \/api\/firm-os\/a .*no AuditEvent is written on any path/),
      expect.stringMatching(/src\/lib\/svc\.ts:4 silent writes \(db\.job\.update\) with no audit write on its path \[POST → silent\]/),
    ]);
  });

  it("catches a write on a branch with no audit even when another branch of the route audits", () => {
    const r = check({ "src/app/api/firm-os/a/route.ts": route("PATCH", "await s.branchy('1');") });
    expect(r.violations).toEqual([expect.stringMatching(/silent writes \(db\.job\.update\) with no audit write on its path \[PATCH → branchy → silent\]/)]);
  });

  it("an audit above the write on its path covers it", () => {
    expect(check({ "src/app/api/firm-os/a/route.ts": route("PUT", "await s.parent('1');") }).violations).toEqual([]);
  });

  it("accepts audit wrappers and injected audit callbacks; notes legacy direct writes", () => {
    const r = check({
      "src/app/api/firm-os/w/route.ts": route("POST", "await s.viaWrapper('1');"),
      "src/app/api/firm-os/i/route.ts": route("POST", "await s.injected({ audit: async () => {}, runs: { create: async () => ({}) } });"),
      "src/app/api/firm-os/l/route.ts": route("POST", "await s.legacy('1');"),
    });
    expect(r.violations).toEqual([]);
    expect(r.notes).toEqual([
      expect.stringMatching(/legacy audit write \(legacy:auditEvent\.create\) at src\/lib\/svc\.ts:7 legacy/),
      expect.stringMatching(/legacy audit write \(legacy:injected-audit\) at src\/lib\/svc\.ts:11 injected/),
    ]);
  });

  it("checks cron GETs and download GETs; skips plain reads", () => {
    const r = check({
      "src/app/api/cron/firm-os/job/route.ts": route("GET", "await s.silent('1');"),
      "src/app/api/firm-os/agents/deliverables/[id]/route.ts": route("GET", "return 1;"),
      "src/app/api/firm-os/agents/deliverables/[id]/preview/route.ts": route("GET", "await s.silent('1');"),
    });
    expect(r.checked).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.violations.filter((v) => v.includes("no AuditEvent is written")).map((v) => v.split(" ")[1])).toEqual(["/api/cron/firm-os/job", "/api/firm-os/agents/deliverables/[id]"]);
  });

  it("does not count a factory that builds a repository, or hash.update(), as a write; does count writes in callbacks", () => {
    const r = check({
      "src/app/api/firm-os/f/route.ts": route("POST", "s.makeRepo(); await s.hashOnly({ update() {} }); await s.approve('1');"),
      "src/app/api/firm-os/t/route.ts": route("POST", "await s.inTx('1');"),
    });
    expect(r.violations).toEqual([expect.stringMatching(/POST \/api\/firm-os\/t .*no AuditEvent/), expect.stringMatching(/inTx writes \(db\.job\.update\)/)]);
  });
});

describe("the ADR-006 heartbeat exemption", () => {
  const HB = "src/app/api/firm-os/coach/heartbeat/route.ts";

  it("lets the heartbeat route write heartbeats and break nudges without an AuditEvent", () => {
    const r = check({ [HB]: coachRoute("heartbeat") }, [HEARTBEAT]);
    expect(r.violations).toEqual([]);
    expect(r.findings[0].sinks).toEqual([]);
  });

  it("still fails the same code on any other route, and the heartbeat route without the exemption row", () => {
    const other = check({ "src/app/api/firm-os/coach/other/route.ts": coachRoute("heartbeat") }, [HEARTBEAT]);
    expect(other.violations).toEqual([
      expect.stringMatching(/POST \/api\/firm-os\/coach\/other .*no AuditEvent is written on any path/),
      expect.stringMatching(/heartbeat writes \(cdb\.activityHeartbeat\.create\)/),
      expect.stringMatching(/createOnce writes \(cdb\.coachEvent\.createMany\)/),
      expect.stringMatching(/POST \/api\/firm-os\/coach\/heartbeat: in AUDIT_EXEMPTIONS but no such mutating route handler/),
    ]);
    const noRow = check({ [HB]: coachRoute("heartbeat") });
    expect(noRow.violations[0]).toMatch(/no AuditEvent is written on any path/);
    // A GET with the same path is not covered either (the row names the method).
    const wrongMethod = check({ [HB]: "import * as c from '@/lib/coach';\nexport async function PUT() { await c.heartbeat('u1'); }" }, [HEARTBEAT]);
    expect(wrongMethod.violations.some((v) => v.includes("PUT /api/firm-os/coach/heartbeat") && v.includes("no AuditEvent"))).toBe(true);
  });

  it("covers only the listed models: another write on the exempt route still needs an audit", () => {
    const r = check({ [HB]: coachRoute("heartbeatAndPrefs") }, [HEARTBEAT]);
    expect(r.violations).toEqual([expect.stringMatching(/heartbeatAndPrefs writes \(cdb\.coachPreference\.update\) with no audit write on its path/)]);
  });

  it("refuses an AuditEvent on the exempt route (ADR-006 forbids the permanent record)", () => {
    const r = check({ [HB]: coachRoute("heartbeatAudited") }, [HEARTBEAT]);
    expect(r.violations).toEqual([expect.stringMatching(/is exempt from audit \(ADR-006 \(break-nudge data\)\) and must not write an AuditEvent, but does/)]);
  });

  it("ships exactly one exemption, for the heartbeat, citing ADR-006, and audits the privacy access export as a download", () => {
    expect(AUDIT_EXEMPTIONS).toHaveLength(1);
    expect(AUDIT_EXEMPTIONS[0]).toMatchObject({ route: "/api/firm-os/coach/heartbeat", method: "POST", models: ["activityHeartbeat", "coachEvent"] });
    expect(AUDIT_EXEMPTIONS[0].why).toMatch(/^ADR-006/);
    expect(EXPORT_ROUTES).toContain("GET /api/firm-os/privacy/requests/[id]/export");
    expect(writeModel({ name: "create", text: "db.activityHeartbeat.create", receiver: "db.activityHeartbeat", targets: [], declFiles: [], line: 1 })).toBe("activityHeartbeat");
  });
});

describe("call classification", () => {
  const c = (over: Partial<CallSite>): CallSite => ({ name: "x", text: "x", receiver: null, targets: [], declFiles: [], line: 1, ...over });
  it("recognises audit writes", () => {
    expect(directSink(c({ name: "logAudit", text: "logAudit", declFiles: ["src/lib/audit/log.ts"] }))).toBe("logAudit");
    expect(directSink(c({ name: "logAudit", text: "logAudit", declFiles: ["src/lib/other.ts"] }))).toBeNull();
    expect(directSink(c({ name: "create", text: "tx.auditEvent.create", receiver: "tx.auditEvent" }))).toBe("legacy:auditEvent.create");
    expect(directSink(c({ name: "audit", text: "deps.audit", receiver: "deps" }))).toBe("legacy:injected-audit");
  });
  it("recognises database writes on a dotted receiver only", () => {
    expect(isWrite(c({ name: "update", text: "deps.db.agentRun.update", receiver: "deps.db.agentRun" }))).toBe(true);
    expect(isWrite(c({ name: "deleteMany", text: "db.activityHeartbeat.deleteMany", receiver: "db.activityHeartbeat" }))).toBe(true);
    expect(isWrite(c({ name: "transitionJobTask", text: "transitionJobTask" }))).toBe(true);
    expect(isWrite(c({ name: "update", text: "hash.update", receiver: "hash" }))).toBe(false);
    expect(isWrite(c({ name: "update", text: "createHash('sha256').update", receiver: "createHash('sha256')" }))).toBe(false);
    expect(isWrite(c({ name: "create", text: "tx.auditEvent.create", receiver: "tx.auditEvent" }))).toBe(false);
  });
});
