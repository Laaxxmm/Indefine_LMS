// verify:audit-coverage rules (Phase 11): every mutating Firm OS route handler writes an AuditEvent.
//
// Mutating handlers: POST / PUT / PATCH / DELETE; every handler of a cron route (cron GETs change
// data); and the GET routes in EXPORT_ROUTES (a download is an export).
//
// For each one, on the TypeScript call graph (scripts/lib/route-graph.ts):
//   1. some function reachable from the handler writes an AuditEvent; and
//   2. every reachable function that writes to the database (a `<client>.<model>.create / update /
//      upsert / delete…` call, `transitionJobTask`, `$executeRaw`) has an audit write in itself or in
//      a function above it on the path from the handler. So a service function that changes a row
//      while nothing on its path audits is reported, even if some other branch of the route audits.
//
// What counts as an audit write: a call to logAudit() (src/lib/audit/log.ts). Legacy forms are
// accepted and listed as notes, so they can be migrated: a direct `<client>.auditEvent.create(...)`,
// a call to an injected `audit(...)` callback (no body to follow, e.g. the onboarding service's
// deps.audit), and a call to a small wrapper whose own body makes one of these writes (e.g.
// close-loop db.audit → logAudit).
import type { CallGraph, CallSite, Fn, Handler } from "./route-graph";

export const AUDIT_LOG_FILE = "src/lib/audit/log.ts";
/** GET handlers that hand data out of the firm's systems (downloads): audited like a mutation. */
export const EXPORT_ROUTES = ["GET /api/firm-os/agents/deliverables/[id]"];
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WRITE_METHODS = new Set(["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]);
const WRITE_CALLS = new Set(["transitionJobTask", "$executeRaw", "$executeRawUnsafe"]);
const MAX_DEPTH = 12;

export type SinkKind = "logAudit" | "legacy:auditEvent.create" | "legacy:injected-audit" | "wrapper";

export type AuditFinding = {
  handler: Handler;
  sinks: { kind: SinkKind; where: string }[];
  problems: string[];
};

export type AuditReport = { findings: AuditFinding[]; checked: number; skipped: number; violations: string[]; notes: string[] };

export function isMutatingHandler(h: Handler): boolean {
  if (MUTATING_METHODS.has(h.method)) return true;
  if (h.file.startsWith("src/app/api/cron/")) return true;
  return EXPORT_ROUTES.includes(`${h.method} ${h.route}`);
}

/** The audit write a call makes by itself, if any (no wrapper lookup). */
export function directSink(c: CallSite): SinkKind | null {
  if (c.name === "logAudit" && (c.declFiles.includes(AUDIT_LOG_FILE) || c.targets.some((t) => t.file === AUDIT_LOG_FILE))) return "logAudit";
  if (/(^|\.)auditEvent\.create(Many)?$/.test(c.text)) return "legacy:auditEvent.create";
  if (c.name === "audit" && c.targets.length === 0) return "legacy:injected-audit";
  return null;
}

/** A database write the call makes (audit writes excluded). */
export function isWrite(c: CallSite): boolean {
  if (directSink(c)) return false;
  if (WRITE_CALLS.has(c.name)) return true;
  // `<client>.<model>.create(...)`, `this.repo.update(...)`: a member call on a dotted receiver,
  // so `hash.update(buf)` and `createHash(...).update(...)` do not count.
  return WRITE_METHODS.has(c.name) && !!c.receiver && /^[\w$]+(\.[\w$]+)+$/.test(c.receiver);
}

export function checkAuditCoverage(graph: CallGraph, routeFiles: string[]): AuditReport {
  const findings: AuditFinding[] = [];
  const violations: string[] = [];
  const notes = new Set<string>();
  let skipped = 0;

  const sinkCache = new Map<string, { kind: SinkKind; where: string }[]>();
  /** Audit writes made by `fn` itself or by a wrapper it calls (one level). */
  const sinksOf = (fn: Fn) => {
    const hit = sinkCache.get(fn.id);
    if (hit) return hit;
    const out: { kind: SinkKind; where: string }[] = [];
    for (const c of graph.callsOf(fn)) {
      // Inside src/lib/audit/log.ts the auditEvent.create IS logAudit.
      const k = fn.file === AUDIT_LOG_FILE && directSink(c) ? "logAudit" : directSink(c);
      if (k) {
        out.push({ kind: k, where: `${fn.file}:${c.line} ${fn.name} → ${c.text}` });
        continue;
      }
      // A wrapper is an audit-only helper (close-loop db.audit, recordAudit): it makes an audit write
      // and no database write. Calling a service that happens to audit its own work does not count.
      for (const t of c.targets) {
        if (t.id === fn.id) continue;
        const inner = graph.callsOf(t);
        const kind = inner.map(directSink).find((x): x is SinkKind => !!x);
        if (kind && !inner.some(isWrite)) out.push({ kind: "wrapper", where: `${fn.file}:${c.line} ${fn.name} → ${t.name} (${kind})` });
      }
    }
    sinkCache.set(fn.id, out);
    return out;
  };

  for (const file of routeFiles) {
    for (const h of graph.handlers(file)) {
      if (!isMutatingHandler(h)) {
        skipped += 1;
        continue;
      }
      const sinks: { kind: SinkKind; where: string }[] = [];
      const problems: string[] = [];
      const reported = new Set<string>();
      const seen = new Set<string>();
      const visit = (fn: Fn, auditedAbove: boolean, path: string[], depth: number) => {
        const own = sinksOf(fn);
        sinks.push(...own);
        const audited = auditedAbove || own.length > 0;
        const state = `${fn.id}|${audited}`;
        if (seen.has(state)) return;
        seen.add(state);
        if (!audited) {
          for (const c of graph.callsOf(fn).filter(isWrite)) {
            const k = `${fn.id}:${c.line}`;
            if (reported.has(k)) continue;
            reported.add(k);
            problems.push(`${fn.file}:${c.line} ${fn.name} writes (${c.text}) with no audit write on its path [${[...path, fn.name].join(" → ")}]`);
          }
        }
        if (depth >= MAX_DEPTH) return;
        for (const c of graph.callsOf(fn)) for (const t of c.targets) visit(t, audited, [...path, fn.name], depth + 1);
      };
      visit(h.fn, false, [], 0);
      if (!sinks.length) problems.unshift("no AuditEvent is written on any path (call logAudit from src/lib/audit/log.ts)");
      for (const s of sinks) if (s.kind !== "logAudit" && s.kind !== "wrapper") notes.add(`legacy audit write (${s.kind}) at ${s.where}: migrate to logAudit when that module is next edited`);
      for (const p of problems) violations.push(`${h.method} ${h.route}  ${h.file}: ${p}`);
      findings.push({ handler: h, sinks: dedupe(sinks), problems });
    }
  }
  return { findings, checked: findings.length, skipped, violations, notes: [...notes].sort() };
}

function dedupe<T extends { where: string }>(xs: T[]): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.where) ? false : (seen.add(x.where), true)));
}
