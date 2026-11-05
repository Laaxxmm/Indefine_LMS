// verify:audit-coverage rules on in-memory programs: the check catches a mutating route without
// logAudit, a write whose path has no audit even when another branch audits, and accepts wrappers.
import { describe, expect, it } from "vitest";
import { checkAuditCoverage, directSink, isWrite, type AuditReport } from "./audit-check";
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

function check(routes: Record<string, string>): AuditReport {
  const { program, root } = createMemoryProgram({ ...LIB, ...routes });
  return checkAuditCoverage(new CallGraph(program, root), Object.keys(routes).sort());
}
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
