// In-memory stand-in for the tables Firm OS search reads (src/lib/search/db.ts SearchDb), with
// the subset of Prisma's query API the providers use: findMany / findFirst / findUnique / count /
// create; `where` with equality, equals / in / notIn / not / contains / startsWith / endsWith
// (mode: "insensitive"), lt/lte/gt/gte, AND / OR / NOT, to-one relation filters (direct, is,
// isNot) and to-many some / every / none, and JSON path filters (equals, string_contains,
// string_starts_with, array_contains); `select` / `include` through the relations below (with
// nested where / orderBy / take on to-many), `orderBy`, `take`. Every call is recorded in `calls`
// so tests can assert what was (not) selected. Nothing here can remove a row.
import type { Session } from "next-auth";
import type { SearchDb } from "@/lib/search/db";

type Row = Record<string, unknown>;
type Relation = { kind: "one" | "many"; model: string; local: string; foreign: string };
const one = (model: string, local: string, foreign = "id"): Relation => ({ kind: "one", model, local, foreign });
const many = (model: string, foreign: string, local = "id"): Relation => ({ kind: "many", model, local, foreign });

const RELATIONS: Record<string, Record<string, Relation>> = {
  user: {},
  client: {
    firmClient: one("firmClient", "id", "lmsClientId"),
    primaryHandler: one("user", "primaryHandlerId"),
    jobs: many("job", "clientId"),
    documents: many("clientDocument", "clientId"),
  },
  firmClient: { client: one("client", "lmsClientId"), jobTasks: many("jobTask", "firmClientId") },
  jobTask: { firmClient: one("firmClient", "firmClientId"), agentRuns: many("agentRun", "jobTaskId"), deliverables: many("deliverable", "jobTaskId") },
  agentRun: { jobTask: one("jobTask", "jobTaskId"), deliverables: many("deliverable", "agentRunId") },
  deliverable: { jobTask: one("jobTask", "jobTaskId"), agentRun: one("agentRun", "agentRunId") },
  commsDraft: {},
  onboardingRun: {},
  serviceType: {},
  job: { client: one("client", "clientId"), serviceType: one("serviceType", "serviceTypeId"), handler: one("user", "handlerId"), documents: many("clientDocument", "jobId") },
  clientDocument: { client: one("client", "clientId"), job: one("job", "jobId") },
  auditEvent: {},
};

export type Call = { model: string; method: string; args: Record<string, unknown> | undefined };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a) === JSON.stringify(b));
const lower = (v: unknown, insensitive: boolean) => (insensitive && typeof v === "string" ? v.toLowerCase() : v);

function cmp(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (a === b) return 0;
  if (a === null || a === undefined) return 1; // Postgres: NULLS LAST for ASC
  if (b === null || b === undefined) return -1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

const SCALAR_OPS = new Set(["equals", "in", "notIn", "not", "contains", "startsWith", "endsWith", "lt", "lte", "gt", "gte", "mode", "path", "string_contains", "string_starts_with", "string_ends_with", "array_contains"]);

function jsonAt(v: unknown, path: string[]): unknown {
  let cur = v;
  for (const k of path) cur = isObj(cur) ? cur[k] : undefined;
  return cur;
}

function matchScalar(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (!isObj(cond) || !Object.keys(cond).every((k) => SCALAR_OPS.has(k))) return same(value, cond);
  const ci = cond.mode === "insensitive";
  let v = value;
  if (Array.isArray(cond.path)) v = jsonAt(value, cond.path as string[]);
  const lv = lower(v, ci);
  for (const [op, arg] of Object.entries(cond)) {
    const la = lower(arg, ci);
    switch (op) {
      case "mode":
      case "path":
        break;
      case "equals":
        if (!(typeof lv === "string" && typeof la === "string" ? lv === la : same(v, arg))) return false;
        break;
      case "in":
        if (!(arg as unknown[]).some((x) => same(v, x))) return false;
        break;
      case "notIn":
        if ((arg as unknown[]).some((x) => same(v, x))) return false;
        break;
      case "not":
        if (isObj(arg) ? matchScalar(value, arg) : same(v, arg)) return false;
        break;
      case "contains":
      case "string_contains":
        if (typeof lv !== "string" || !lv.includes(la as string)) return false;
        break;
      case "startsWith":
      case "string_starts_with":
        if (typeof lv !== "string" || !lv.startsWith(la as string)) return false;
        break;
      case "endsWith":
      case "string_ends_with":
        if (typeof lv !== "string" || !lv.endsWith(la as string)) return false;
        break;
      case "array_contains":
        if (!Array.isArray(v) || !(arg as unknown[]).every((x) => v.some((y: unknown) => same(y, x)))) return false;
        break;
      case "lt":
        if (!(cmp(v, arg) < 0)) return false;
        break;
      case "lte":
        if (!(cmp(v, arg) <= 0)) return false;
        break;
      case "gt":
        if (!(cmp(v, arg) > 0)) return false;
        break;
      case "gte":
        if (!(cmp(v, arg) >= 0)) return false;
        break;
    }
  }
  return true;
}

export class SearchWorld {
  readonly tables: Record<string, Row[]> = Object.fromEntries(Object.keys(RELATIONS).map((m) => [m, []]));
  readonly calls: Call[] = [];
  /** Set to make auditEvent.create throw (fail-closed tests). */
  failAudit = false;
  private seq = 0;

  seed(model: string, rows: Row[]): this {
    for (const r of rows) this.tables[model].push({ createdAt: new Date("2026-01-01T00:00:00Z"), ...r });
    return this;
  }

  private related(rel: Relation, row: Row): Row[] {
    return this.tables[rel.model].filter((r) => row[rel.local] !== null && row[rel.local] !== undefined && r[rel.foreign] === row[rel.local]);
  }

  matches(model: string, row: Row, where: unknown): boolean {
    if (!isObj(where)) return true;
    for (const [key, cond] of Object.entries(where)) {
      if (cond === undefined) continue;
      if (key === "AND") {
        if (!(Array.isArray(cond) ? cond : [cond]).every((w) => this.matches(model, row, w))) return false;
        continue;
      }
      if (key === "OR") {
        if (!(cond as unknown[]).some((w) => this.matches(model, row, w))) return false;
        continue;
      }
      if (key === "NOT") {
        if ((Array.isArray(cond) ? cond : [cond]).some((w) => this.matches(model, row, w))) return false;
        continue;
      }
      const rel = RELATIONS[model]?.[key];
      if (rel?.kind === "one") {
        const target = this.related(rel, row)[0] ?? null;
        if (cond === null) {
          if (target) return false;
        } else if (isObj(cond) && ("is" in cond || "isNot" in cond)) {
          if ("is" in cond && (cond.is === null ? !!target : !target || !this.matches(rel.model, target, cond.is))) return false;
          if ("isNot" in cond && (cond.isNot === null ? !target : !!target && this.matches(rel.model, target, cond.isNot))) return false;
        } else if (!target || !this.matches(rel.model, target, cond)) return false;
        continue;
      }
      if (rel?.kind === "many") {
        const list = this.related(rel, row);
        const c = cond as { some?: unknown; every?: unknown; none?: unknown };
        if (c.some !== undefined && !list.some((r) => this.matches(rel.model, r, c.some))) return false;
        if (c.every !== undefined && !list.every((r) => this.matches(rel.model, r, c.every))) return false;
        if (c.none !== undefined && list.some((r) => this.matches(rel.model, r, c.none))) return false;
        continue;
      }
      if (!matchScalar(row[key], cond)) return false;
    }
    return true;
  }

  private ordered(rows: Row[], orderBy: unknown): Row[] {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, "asc" | "desc">[];
    if (!keys.length) return rows;
    return [...rows].sort((a, b) => {
      for (const k of keys) {
        const [field, dir] = Object.entries(k)[0];
        const c = cmp(a[field], b[field]);
        if (c) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  }

  private project(model: string, row: Row, args: { select?: Record<string, unknown>; include?: Record<string, unknown> } | undefined): Row {
    const spec = args?.select ?? args?.include;
    const out: Row = args?.select ? {} : { ...row };
    if (!spec) return out;
    for (const [k, v] of Object.entries(spec)) {
      if (!v) continue;
      const rel = RELATIONS[model]?.[k];
      if (!rel) {
        out[k] = row[k] ?? null;
        continue;
      }
      const nested = (v === true ? {} : v) as { where?: unknown; orderBy?: unknown; take?: number; select?: Record<string, unknown>; include?: Record<string, unknown> };
      if (rel.kind === "one") {
        const target = this.related(rel, row)[0];
        out[k] = target ? this.project(rel.model, target, nested) : null;
      } else {
        let list = this.related(rel, row).filter((r) => this.matches(rel.model, r, nested.where));
        list = this.ordered(list, nested.orderBy);
        if (nested.take !== undefined) list = list.slice(0, nested.take);
        out[k] = list.map((r) => this.project(rel.model, r, nested));
      }
    }
    return out;
  }

  private delegate(model: string) {
    const find = (args: Record<string, unknown> = {}) => {
      let rows = this.tables[model].filter((r) => this.matches(model, r, args.where));
      rows = this.ordered(rows, args.orderBy);
      if (typeof args.take === "number") rows = rows.slice(0, args.take);
      return rows.map((r) => this.project(model, r, args as never));
    };
    const log = (method: string, args?: Record<string, unknown>) => this.calls.push({ model, method, args: args ? structuredClone(args) : undefined });
    return {
      findMany: async (args?: Record<string, unknown>) => (log("findMany", args), find(args)),
      findFirst: async (args?: Record<string, unknown>) => (log("findFirst", args), find(args)[0] ?? null),
      findUnique: async (args: Record<string, unknown>) => (log("findUnique", args), find(args)[0] ?? null),
      count: async (args?: Record<string, unknown>) => (log("count", args), find({ where: args?.where }).length),
      create: async (args: { data: Row; select?: Record<string, unknown> }) => {
        log("create", args as never);
        if (model === "auditEvent" && this.failAudit) throw new Error("audit store unavailable");
        const row = { id: `${model}-${++this.seq}`, createdAt: new Date(), ...structuredClone(args.data) };
        this.tables[model].push(row);
        return this.project(model, row, args);
      },
    };
  }

  get db(): SearchDb {
    const models = Object.keys(RELATIONS);
    return Object.fromEntries(models.map((m) => [m, this.delegate(m)])) as unknown as SearchDb;
  }
}

// ------------------------------------------------------------------ the firm

type Level = "EXECUTIVE" | "SENIOR_EXECUTIVE" | "MANAGER" | "SENIOR_MANAGER" | "PARTNER";

export function sessionUser(id: string, over: { level?: Level; role?: "EMPLOYEE" | "ADMIN"; active?: boolean } = {}): Session["user"] {
  return { id, name: id, email: `${id}@indefine.test`, image: null, role: over.role ?? "EMPLOYEE", active: over.active ?? true, department: "TAX", level: over.level ?? "EXECUTIVE" };
}

/** Session users: staff priya (assignee), ravi (reviewer), arun (other assignee); a manager, a partner, an admin, a deactivated partner. */
export const PEOPLE = {
  admin: sessionUser("u-admin", { role: "ADMIN" }),
  partner: sessionUser("u-partner", { level: "PARTNER" }),
  manager: sessionUser("u-manager", { level: "MANAGER" }),
  priya: sessionUser("u-priya"),
  ravi: sessionUser("u-ravi", { level: "SENIOR_EXECUTIVE" }),
  arun: sessionUser("u-arun"),
  gone: sessionUser("u-gone", { level: "PARTNER", active: false }),
};

const d = (s: string) => new Date(`${s}T06:30:00Z`);

/** Synthetic data only (no real PAN, phone or email). */
export const IDS = {
  acmePan: "AAACA1234F",
  acmeGstin: "33AAACA1234F1Z5",
  acmePhone: "9876543210",
  acmeEmail: "ravi.acct@acme.example",
  bharatPan: "AAFFB5678K",
  rameshPan: "BQRPK4321M",
  rameshGstin: "29BQRPK4321M1Z2",
  zenPan: "AAJFZ1111Q",
  zenGstin: "27AAJFZ1111Q1Z9",
  zenPhone: "9988776655",
  zenEmail: "owner@zenith.example",
};

export const DRAFT_BODY = "Dear Ravi, please share the purchase register. Your PAN AAACA1234F is on file. SECRET-BODY-TEXT";

export function searchWorld(): SearchWorld {
  const w = new SearchWorld();
  w.seed("user", Object.values(PEOPLE).map((p) => ({ id: p.id, name: p.name, email: p.email })));
  w.seed("client", [
    { id: "c-acme", name: "Acme Traders Private Limited", folderName: "Acme Traders", entityType: "PVT_LTD", pan: IDS.acmePan, gstin: IDS.acmeGstin, contactPhone: IDS.acmePhone, contactEmail: IDS.acmeEmail, city: "Chennai", active: true, primaryHandlerId: "u-priya", updatedAt: d("2026-11-01") },
    { id: "c-bharat", name: "Bharat Steel Works", folderName: "Bharat Steel Works", entityType: "PARTNERSHIP", pan: IDS.bharatPan, gstin: null, contactPhone: "9123456780", contactEmail: "accounts@bharat.example", city: "Coimbatore", active: true, primaryHandlerId: "u-arun", updatedAt: d("2026-10-20") },
    { id: "c-acmeold", name: "Acme Old Holdings", folderName: "Acme Old Holdings", entityType: "PVT_LTD", pan: null, gstin: null, contactPhone: null, contactEmail: null, city: null, active: false, primaryHandlerId: "u-priya", updatedAt: d("2026-09-01") },
    { id: "c-ramesh", name: "Ramesh Kumar", folderName: "Ramesh Kumar", entityType: "PROPRIETORSHIP", pan: null, gstin: IDS.rameshGstin, contactPhone: null, contactEmail: null, city: "Bengaluru", active: true, primaryHandlerId: "u-priya", updatedAt: d("2026-08-01") },
  ]);
  w.seed("firmClient", [
    { id: "fc-acme", lmsClientId: "c-acme", clientCode: "ACME01" },
    { id: "fc-bharat", lmsClientId: "c-bharat", clientCode: "BSW" },
  ]);
  w.seed("jobTask", [
    { id: "job-acme-gst", firmClientId: "fc-acme", service: "GST", fy: "2026-27", period: "2026-10", title: "GSTR-3B", state: "IN_REVIEW", assigneeId: "u-priya", reviewerId: "u-ravi", internalDueOn: d("2026-11-17"), ackRef: null, updatedAt: d("2026-11-04") },
    { id: "job-acme-roc", firmClientId: "fc-acme", service: "ROC", fy: "2026-27", period: "Annual", title: "AOC-4", state: "ASSIGNED", assigneeId: "u-arun", reviewerId: "u-manager", internalDueOn: null, ackRef: null, updatedAt: d("2026-11-03") },
    { id: "job-bsw-tds", firmClientId: "fc-bharat", service: "TDS", fy: "2026-27", period: "Q2", title: "TDS return 26Q", state: "DONE", assigneeId: "u-priya", reviewerId: null, internalDueOn: d("2026-10-25"), ackRef: "ACK26Q0042", updatedAt: d("2026-10-15") },
  ]);
  w.seed("agentRun", [
    { id: "run-gst-1", jobTaskId: "job-acme-gst", agent: "gst", attempt: 1, status: "CHANGES_REQUESTED", startedAt: d("2026-11-02") },
    { id: "run-gst-2", jobTaskId: "job-acme-gst", agent: "gst", attempt: 2, status: "AGENT_DONE", startedAt: d("2026-11-04") },
    { id: "run-roc-1", jobTaskId: "job-acme-roc", agent: "roc", attempt: 1, status: "FAILED", startedAt: d("2026-11-03") },
  ]);
  w.seed("deliverable", [
    { id: "del-gst", jobTaskId: "job-acme-gst", agentRunId: "run-gst-2", kind: "Working", name: "GSTR-3B working ACME01 2026-10.xlsx", spPath: "Compliance/FY2026-27/GST/2026-10/Working/GSTR-3B working ACME01 2026-10.xlsx", version: 2, sha256: "x", sizeBytes: 1, createdAt: d("2026-11-04") },
    { id: "del-roc", jobTaskId: "job-acme-roc", agentRunId: null, kind: "Final", name: "AOC-4 ACME01.pdf", spPath: "Compliance/FY2026-27/ROC/Annual/Final/AOC-4 ACME01.pdf", version: 1, sha256: "x", sizeBytes: 1, createdAt: d("2026-11-03") },
    { id: "del-tds", jobTaskId: "job-bsw-tds", agentRunId: null, kind: "Working", name: `${IDS.bharatPan} TDS workings.xlsx`, spPath: `Compliance/FY2026-27/TDS/Q2/Working/${IDS.bharatPan} TDS workings.xlsx`, version: 1, sha256: "x", sizeBytes: 1, createdAt: d("2026-10-14") },
  ]);
  w.seed("commsDraft", [
    { id: "draft-chase", firmClientId: "fc-acme", jobTaskId: "job-acme-gst", kind: "doc-chase", language: "en", subject: "Documents needed for October GSTR-3B", body: DRAFT_BODY, createdById: "u-manager", outlookDraftId: "o-1", createdAt: d("2026-11-03") },
    { id: "draft-roc", firmClientId: "fc-acme", jobTaskId: "job-acme-roc", kind: "due-reminder", language: "ta", subject: "AOC-4 due date reminder", body: DRAFT_BODY, createdById: "u-partner", outlookDraftId: null, createdAt: d("2026-11-02") },
    { id: "draft-bsw", firmClientId: "fc-bharat", jobTaskId: null, kind: "status", language: "en", subject: "Status update for Bharat Steel", body: DRAFT_BODY, createdById: "u-arun", outlookDraftId: null, createdAt: d("2026-10-30") },
  ]);
  w.seed("onboardingRun", [
    {
      id: "ob-zen",
      createdById: "u-partner",
      status: "DONE",
      prompt: `Onboard Zenith Exports LLP, PAN ${IDS.zenPan}, phone ${IDS.zenPhone}, contact Kavya`,
      spec: { legalName: "Zenith Exports LLP", clientCode: "ZEN01", pan: IDS.zenPan, gstins: [IDS.zenGstin], contactPhone: IDS.zenPhone, contactEmail: "Owner@Zenith.example", contactName: "Kavya" },
      firmClientId: null,
      createdAt: d("2026-10-25"),
      updatedAt: d("2026-10-26"),
    },
    { id: "ob-new", createdById: "u-manager", status: "DRAFT", prompt: "a new client called Kavya Foods", spec: {}, firmClientId: null, createdAt: d("2026-11-05"), updatedAt: d("2026-11-05") },
  ]);
  w.seed("serviceType", [
    { id: "st-itr", department: "TAX", name: "ITR filing" },
    { id: "st-audit", department: "AUDIT", name: "Statutory Audit" },
  ]);
  w.seed("job", [
    { id: "lj-acme-itr", clientId: "c-acme", serviceTypeId: "st-itr", fy: "2026-27", handlerId: "u-priya", status: "IN_PROGRESS", dueOn: d("2026-12-31"), notes: `PAN ${IDS.acmePan}`, updatedAt: d("2026-11-01") },
    { id: "lj-bsw-audit", clientId: "c-bharat", serviceTypeId: "st-audit", fy: "2025-26", handlerId: "u-arun", status: "DELIVERED", dueOn: null, notes: null, updatedAt: d("2026-09-30") },
  ]);
  w.seed("clientDocument", [
    { id: "doc-acme-pan", clientId: "c-acme", jobId: null, docType: "PAN", name: `${IDS.acmePan}.pdf`, webUrl: "https://sharepoint.example/doc-acme-pan", graphDriveId: "d", graphItemId: "i1", uploadedById: "u-priya", createdAt: d("2026-10-01") },
    { id: "doc-acme-bank", clientId: "c-acme", jobId: null, docType: "BANK", name: "Acme bank statement Oct 2026.pdf", webUrl: "https://sharepoint.example/doc-acme-bank", graphDriveId: "d", graphItemId: "i2", uploadedById: "u-priya", createdAt: d("2026-11-02") },
    { id: "doc-bsw-tb", clientId: "c-bharat", jobId: "lj-bsw-audit", docType: "SOURCE_DATA", name: "Trial balance FY 2025-26.xlsx", webUrl: "https://sharepoint.example/doc-bsw-tb", graphDriveId: "d", graphItemId: "i3", uploadedById: "u-arun", createdAt: d("2026-09-15") },
  ]);
  return w;
}
