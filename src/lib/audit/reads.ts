// Audit of READS of client data (security audit #6). The breach runbook has to answer "who
// accessed client X, and when"; writes were audited, reads were not. Each loader that shows or
// hands out client data records one AuditEvent through logAudit():
//
//   action "view"    a screen loaded client data (client detail, agent run review, deliverable
//                    preview, comms draft). Deduplicated: at most one row per person per record per
//                    hour (VIEW_DEDUPE_MS), so a busy reviewer does not flood the table.
//   action "export"  data left the screen as a file (client report export, client workbook
//                    download). Every time, no deduplication.
//
// `meta` is masked: ids, codes, counts and short machine words only — never names, PAN, e-mail,
// phone, addresses or free text (ADR-006). An audit write that fails is logged and the read goes
// on: a page must not break because the audit table is busy.
//
// Deduplication is in-process (per database client, so tests with fresh fakes start clean). With
// more than one app instance a person may get one "view" row per instance per hour; that is fine.
import { logAudit, type AuditDb } from "./log";

export const VIEW_DEDUPE_MS = 60 * 60_000;
const MAX_REMEMBERED = 10_000;

export type ReadAudit = {
  actorId: string | null | undefined;
  /** Prisma model the data belongs to ("Client", "AgentRun", "Deliverable", "CommsDraft"). */
  entity: string;
  entityId: string | null;
  action?: "view" | "export";
  meta?: Record<string, unknown> | null;
  now?: Date;
};

const PII_KEY = /name|email|e_mail|mail|pan|phone|mobile|address|aadhaar|aadhar|gstin|dob|birth|contact|note|text|body|subject|message|search|query|q$/i;
const SAFE_STRING = /^[A-Za-z0-9_.:/-]{1,64}$/;

/** Keeps ids, codes, counts and short machine words; masks anything else; drops keys that name personal data. */
export function maskReadMeta(meta: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (PII_KEY.test(k)) continue;
    if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (typeof v === "string") out[k] = SAFE_STRING.test(v) ? v : "[masked]";
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => (typeof x === "string" && SAFE_STRING.test(x) ? x : typeof x === "number" ? x : "[masked]"));
    else out[k] = "[masked]";
  }
  return Object.keys(out).length ? out : undefined;
}

const remembered = new WeakMap<object, Map<string, number>>();

function seenFor(db: AuditDb): Map<string, number> {
  let m = remembered.get(db);
  if (!m) remembered.set(db, (m = new Map()));
  return m;
}

function prune(m: Map<string, number>, now: number) {
  if (m.size <= MAX_REMEMBERED) return;
  for (const [k, at] of m) if (now - at >= VIEW_DEDUPE_MS) m.delete(k);
  // Still too many (a burst within the hour): forget the oldest; worst case one extra row each.
  for (const k of m.keys()) {
    if (m.size <= MAX_REMEMBERED) break;
    m.delete(k);
  }
}

/**
 * Records one read of client data. Resolves true when a row was written, false when a "view" was
 * already recorded for this person and record within the hour, or the write failed (logged).
 * Never throws.
 */
export async function auditRead(db: AuditDb, e: ReadAudit): Promise<boolean> {
  const action = e.action ?? "view";
  const now = (e.now ?? new Date()).getTime();
  const seen = seenFor(db);
  const key = `${e.actorId ?? "-"}|${e.entity}|${e.entityId ?? "-"}`;
  if (action === "view") {
    const last = seen.get(key);
    if (last !== undefined && now - last < VIEW_DEDUPE_MS && now >= last) return false;
    seen.delete(key); // re-insert at the end: Map order = age order for prune()
    seen.set(key, now);
    prune(seen, now);
  }
  try {
    await logAudit(db, { actorId: e.actorId, action, entity: e.entity, entityId: e.entityId, meta: maskReadMeta(e.meta) });
    return true;
  } catch (err) {
    if (action === "view" && seen.get(key) === now) seen.delete(key); // try again next time
    console.error(`[audit] could not record ${action} of ${e.entity} ${e.entityId ?? ""}: ${(err as Error).message}`);
    return false;
  }
}

// ------------------------------------------------------------------ app-client helpers
// For loaders that take no injected client (src/lib/clients/**, the /api/clients routes). Prisma
// is imported lazily so importing this module stays cheap and route tests can mock "@/lib/prisma".

type Actor = { id?: string | null } | null | undefined;

async function appDb(): Promise<AuditDb> {
  const { prisma } = await import("@/lib/prisma");
  return prisma as unknown as AuditDb;
}

/** Client detail data load (/clients/[id]): one "view" per person per client per hour. */
export async function auditClientView(user: Actor, clientId: string, meta?: { clientCode?: string | null }): Promise<boolean> {
  return auditRead(await appDb(), { actorId: user?.id, entity: "Client", entityId: clientId, meta: meta ? { clientCode: meta.clientCode ?? null } : undefined });
}

/** Client jobs report exported as a file (/api/clients/reports/export): every time. */
export async function auditClientReportExport(user: Actor, meta: { rows: number; format?: string; filters?: string[] }): Promise<boolean> {
  return auditRead(await appDb(), { actorId: user?.id, entity: "Client", entityId: null, action: "export", meta: { what: "client-jobs-report", rows: meta.rows, format: meta.format ?? "xlsx", filters: meta.filters ?? [] } });
}

/** The all-clients workbook downloaded (/api/clients/workbook): every time. */
export async function auditClientWorkbookDownload(user: Actor, meta: { clients?: number; bytes?: number } = {}): Promise<boolean> {
  return auditRead(await appDb(), { actorId: user?.id, entity: "Client", entityId: null, action: "export", meta: { what: "client-workbook", ...meta } });
}
