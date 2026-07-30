import { prisma } from "@/lib/prisma";

// Turia Practice Management client — calls Turia's internal API with the firm's
// session cookie (captured from a logged-in Turia tab, stored in NeoTuriaSession).
// Faithful port of Neo Centra's turia.service.ts (only the incentive-engine calls).

const TURIA_BASE = "https://practice.turia.in/api";

// Read strictly from env (no hardcoded fallback), but LAZILY — throwing at
// module load breaks the build, since the var isn't present then.
function orgId(): string {
  const id = process.env.NEO_TURIA_ORG_ID;
  if (!id) throw new Error("NEO_TURIA_ORG_ID is not set — configure it in the environment.");
  return id;
}

export class TuriaSessionError extends Error {}

export async function getTuriaCookie(): Promise<string | null> {
  const row = await prisma.neoTuriaSession.findUnique({ where: { id: 1 } });
  return row?.cookie ?? null;
}

export async function storeTuriaCookie(cookie: string, byId?: string, byName?: string): Promise<void> {
  await prisma.neoTuriaSession.upsert({
    where: { id: 1 },
    create: { id: 1, cookie, updatedById: byId, updatedByName: byName },
    update: { cookie, updatedById: byId, updatedByName: byName },
  });
}

export async function turiaStatus(): Promise<{ present: boolean; updatedAt: Date | null; updatedByName: string | null }> {
  const row = await prisma.neoTuriaSession.findUnique({ where: { id: 1 } });
  return { present: !!row?.cookie, updatedAt: row?.updatedAt ?? null, updatedByName: row?.updatedByName ?? null };
}

async function turiaPost(endpoint: string, action: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const cookie = await getTuriaCookie();
  if (!cookie) throw new TuriaSessionError("Turia session not available. Push a fresh Turia cookie first.");

  const res = await fetch(`${TURIA_BASE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ action, data: { ...data, organizationId: orgId() }, organizationId: orgId() }),
  });

  const STALE = new Set([401, 403, 451]);
  if (STALE.has(res.status)) throw new TuriaSessionError("Turia session expired. Refresh the Turia cookie.");
  if (!res.ok) throw new Error(`Turia API error: ${res.status} on ${endpoint}/${action}`);

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new TuriaSessionError("Turia session expired (non-JSON response). Refresh the Turia cookie.");
  }
  if (json && json.status != null && json.status !== "SUCCESS") {
    throw new Error(`Turia rejected ${endpoint}/${action}: ${(json.message as string) || json.status}`);
  }
  return json;
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface TuriaLead {
  id: string; identity: string; name: string; referredBy: string | null;
  stageName: string; statusName: string; sourceName: string | null; dealType: string | null;
  dealValue: number; owners: Array<{ id: string; name: string }>; createdOn: number | null; updatedOn: number | null;
}
export interface TuriaTaskUser { id: string; name: string; type: number; role: string }
export interface TuriaTaskDetail {
  id: string; identity: string; name: string; status: string | null;
  createdOn: number | null; completedOn: number | null; dueDate: number | null;
  budgetAmount: number; invoiceAmount: number; opAmount: number; profit: number;
  cost: number; // manpower + OP expense (Turia UI's cost side); used to derive profit
  tatHours: string | null; billable: boolean; department: string; users: TuriaTaskUser[];
}
export interface TuriaInvoice {
  id: string; uniqueNo: string; taskId: string | null; taskUniqueId: string | null;
  subtotal: number; total: number; status: number; paymentStatus: string; invoiceDate: number | null; createdOn: number | null;
}

// Tolerant number parse — strips currency symbols / thousands commas that Turia
// occasionally formats into its numeric strings (e.g. "₹3,262.29").
const numf = (v: unknown) => {
  const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const numi = (v: unknown) => (v ? parseInt(String(v), 10) : null);
// Date value → epoch ms. Handles ms/seconds epochs, ISO, dd-mm-yyyy.
function toEpochMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v > 1e12 ? v : v > 1e9 ? v * 1000 : null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return n > 1e12 ? n : n > 1e9 ? n * 1000 : null; }
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) return Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
// Work date of a timesheet row — explicit date fields first, createdon last.
function tsWorkDate(r: Record<string, unknown>): number | null {
  for (const k of ["date", "timesheetdate", "workdate", "logdate", "entrydate", "startdate", "startdatetime", "starttime", "createdon"]) {
    const ms = toEpochMs(r[k]);
    if (ms != null) return ms;
  }
  return null;
}
// First parseable value across candidate keys. Turia's completion-date key varies, and a
// silent null there zeroes every completion-gated metric — so try the known spellings.
const picki = (t: Record<string, unknown>, keys: string[]) => { for (const k of keys) { const n = numi(t[k]); if (n) return n; } return null; };
const COMPLETED_KEYS = ["completedon", "completeddate", "completed_on", "completiondate", "closedon", "closeddate", "finishedon", "completedat"];
// Turia's billable flag is inconsistent — boolean, 0/1, or a "Billable"/"Non Billable"
// status string under varying keys. Read defensively and DEFAULT TO BILLABLE when unknown,
// so a misread can never silently zero Bucket 2. Only a clear "non"/0/false marks it off.
function parseBillable(t: Record<string, unknown>): boolean {
  const name = String(t.billingstatusname ?? t.billingstatus ?? t.billing_status ?? "").toLowerCase().trim();
  if (name.includes("non")) return false;
  if (name === "billable") return true;
  const b = t.billable ?? t.isbillable ?? t.is_billable;
  if (typeof b === "boolean") return b;
  if (typeof b === "number") return b !== 0;
  if (typeof b === "string") { const s = b.toLowerCase().trim(); if (s.includes("non") || s === "0" || s === "false" || s === "no") return false; if (s === "billable" || s === "1" || s === "true" || s === "yes") return true; }
  return true;
}
// First present-and-nonzero value across candidate keys (Turia field names vary).
const pick = (t: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) { const n = numf(t[k]); if (n) return n; }
  return 0;
};

// ── Fetchers (the four-bucket engine's live sources) ──────────────────────────
export async function fetchOrgUsers(): Promise<Array<{ id: string; name: string; email: string; designation: string; department: string }>> {
  try {
    const json = await turiaPost("utilities", "organizationUserListNew", {});
    const users = (json.users || json.data || []) as Array<Record<string, unknown>>;
    if (Array.isArray(users) && users.length) {
      return users.map((u) => ({
        id: String(u.id ?? u.userId ?? ""),
        name: String(u.name ?? u.fullname ?? `${u.firstname ?? ""} ${u.lastname ?? ""}`).trim(),
        email: String(u.email ?? ""),
        designation: String(u.designation ?? u.designationname ?? ""),
        department: String(u.department ?? u.departmentname ?? ""),
      }));
    }
  } catch { /* fall through */ }
  // Fallback: harvest distinct {id,name} from task assignees/reviewers.
  const seen = new Map<string, { id: string; name: string }>();
  try {
    for (let page = 1; page <= 5; page++) {
      const rows = await fetchTuriaTaskList(page, 100);
      if (rows.length === 0) break;
      for (const t of rows) {
        for (const u of [...((t.assignee as Record<string, string>[]) || []), ...((t.reviewer as Record<string, string>[]) || [])]) {
          if (u?.id && u?.name && !seen.has(u.id)) seen.set(u.id, { id: u.id, name: u.name });
        }
      }
      if (rows.length < 100) break;
    }
  } catch { /* ignore */ }
  return [...seen.values()].map((u) => ({ ...u, email: "", designation: "", department: "" }));
}

export async function fetchTuriaTaskList(page = 1, perPage = 50): Promise<Array<Record<string, unknown>>> {
  const json = await turiaPost("task", "list", { page, perPage, sortColumn: "createdon", sort: "desc", q: "", dashboardFilter: null, userId: null, department: null, orguserid: "" });
  return ((json.tasks as Record<string, unknown>)?.tasks as Array<Record<string, unknown>>) || [];
}

// Reviewers per task, keyed by Turia's internal task id (same id invoices carry as
// `taskid`, so it matches billingByTask keys in the engine). task/get doesn't return the
// reviewer array, but task/list does (`t.reviewer`) — so a director who only *reviews* a
// task can still be credited Bucket 3 profit. Paginated; stops on a short page / over-page 404.
export async function fetchReviewersByTask(perPage = 100, maxPages = 20): Promise<Map<string, TuriaTaskUser[]>> {
  const map = new Map<string, TuriaTaskUser[]>();
  for (let page = 1; page <= maxPages; page++) {
    let rows: Array<Record<string, unknown>>;
    try { rows = await fetchTuriaTaskList(page, perPage); }
    catch (e) { if (page > 1 && e instanceof Error && /\b404\b/.test(e.message)) break; throw e; }
    if (rows.length === 0) break;
    for (const t of rows) {
      const id = String(t.id ?? "");
      const revs = Array.isArray(t.reviewer) ? (t.reviewer as Array<Record<string, unknown>>) : [];
      if (!id || revs.length === 0) continue;
      map.set(id, revs.map((u) => ({ id: String(u.id), name: String(u.name ?? ""), type: parseInt(String(u.type ?? "0"), 10), role: "reviewer" })));
    }
    if (rows.length < perPage) break;
  }
  return map;
}

export async function fetchLeads(perPage = 100, maxPages = 20): Promise<TuriaLead[]> {
  // leads/list is PAGINATED — the bare {} call only returned the first ~10, so a lead
  // behind the newest 10 (e.g. a Q1 lead converted this quarter) vanished from Bucket 1.
  // Page through, dedupe by id, and stop on a short page (Turia 404s a page past the last).
  const byId = new Map<string, Record<string, unknown>>();
  for (let page = 1; page <= maxPages; page++) {
    let json: Record<string, unknown>;
    try { json = await turiaPost("leads", "list", { page, perPage }); }
    catch (e) { if (page > 1 && e instanceof Error && /\b404\b/.test(e.message)) break; throw e; }
    const rows = (json.leads || []) as Array<Record<string, unknown>>;
    if (rows.length === 0) break;
    const before = byId.size;
    for (const l of rows) byId.set(String(l.id ?? ""), l);
    if (byId.size === before || rows.length < perPage) break;
  }
  const leads = [...byId.values()];
  return leads.map((l) => ({
    id: String(l.id ?? ""),
    identity: String(l.uniqueidentity ?? ""),
    name: String(l.name ?? ""),
    referredBy: (l.referredby as string) || null,
    stageName: String(l.stagename ?? ""),
    statusName: String(l.leadstatusname ?? ""),
    sourceName: (l.sourcename as string) || null,
    dealType: (l.dealtypename as string) || null,
    dealValue: numf(l.dealvalue),
    owners: Array.isArray(l.users) ? (l.users as Array<Record<string, unknown>>).map((u) => ({ id: String(u.id), name: String(u.name) })) : [],
    createdOn: numi(l.createdon),
    updatedOn: numi(l.updatedon),
  }));
}

// Assignees (`userlists`) + reviewers (Turia names the reviewer array differently across
// endpoints, so scan the likely keys) merged into one user list, deduped by id. Reviewers
// are tagged role "reviewer"; an assignee entry wins on collision.
function mergeTaskUsers(t: Record<string, unknown>): TuriaTaskUser[] {
  const byId = new Map<string, TuriaTaskUser>();
  const rows = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  for (const u of rows(t.userlists)) byId.set(String(u.id), { id: String(u.id), name: String(u.name ?? ""), type: parseInt(String(u.type ?? "0"), 10), role: String(u.role ?? "") });
  for (const k of ["reviewerlists", "reviewerlist", "reviewers", "reviewer"]) {
    for (const u of rows(t[k])) { const id = String(u.id); if (id && !byId.has(id)) byId.set(id, { id, name: String(u.name ?? ""), type: parseInt(String(u.type ?? "0"), 10), role: "reviewer" }); }
  }
  return [...byId.values()];
}

export async function fetchTaskDetail(taskId: string): Promise<TuriaTaskDetail | null> {
  try {
    const json = await turiaPost("task", "get", { taskId, id: taskId });
    const t = json.task as Record<string, unknown>;
    if (!t) return null;
    // Turia's task view profit = Revenue − Manpower − OP expense. The `profit`
    // field in task/get isn't always populated, so we also capture the cost side
    // (across likely field names) to derive it in the engine when profit is 0.
    const manpower = pick(t, ["manpowercost", "manpowerCost", "manpower", "opAmount", "opamount"]);
    const opExpense = pick(t, ["opexpense", "opExpense", "opexp", "otherexpense"]);
    return {
      id: String(t.id),
      identity: String(t.uniqueidentity ?? "").replace("#", ""),
      name: String(t.taskname ?? ""),
      status: t.taskstatus != null ? String(t.taskstatus) : null,
      createdOn: numi(t.createdon),
      completedOn: picki(t, COMPLETED_KEYS),
      dueDate: numi(t.targetduedate),
      budgetAmount: numf(t.budgetamount),
      invoiceAmount: pick(t, ["invoiceamount", "invoiceAmount", "revenue", "revenueamount"]),
      opAmount: numf(t.opAmount),
      profit: pick(t, ["profit", "profitamount", "netprofit", "taskprofit", "margin"]),
      cost: manpower + opExpense,
      tatHours: (t.tathours as string) || null,
      billable: parseBillable(t),
      department: String(t.departmentname ?? t.department ?? t.deptname ?? "").trim(),
      // Turia splits a task's people: `userlists` = assignees, a separate reviewer array =
      // reviewers. A director who only *reviews* must still earn Bucket 3 profit on the task
      // (non-ROC — the ROC gate lives in the engine), so fold reviewers in too, deduped by id.
      users: mergeTaskUsers(t),
    };
  } catch {
    return null;
  }
}

// Raw task/get payload — for the debug endpoint so we can see Turia's exact field
// names/values when a bucket looks wrong.
export async function rawTaskGet(taskId: string): Promise<unknown> {
  const json = await turiaPost("task", "get", { taskId, id: taskId });
  return (json.task as unknown) ?? json;
}

export async function fetchAllInvoices(perPage = 200, maxPages = 20): Promise<TuriaInvoice[]> {
  const out: TuriaInvoice[] = [];
  let page = 1;
  while (page <= maxPages) {
    let json: Record<string, unknown>;
    // Turia 404s a page PAST the last one (rather than returning an empty list), which
    // otherwise aborts the whole sync. Treat an over-page 404 as end-of-data.
    try { json = await turiaPost("invoice", "list", { page, perPage }); }
    catch (e) { if (page > 1 && e instanceof Error && /\b404\b/.test(e.message)) break; throw e; }
    const wrap = (json.taskinvoices as Record<string, unknown>) || {};
    const rows = ((wrap.taskinvoices as Array<Record<string, unknown>>) || []);
    if (rows.length === 0) break;
    for (const i of rows) {
      out.push({
        id: String(i.id),
        uniqueNo: String(i.uniqueno ?? ""),
        taskId: (i.taskid as string) || null,
        taskUniqueId: (i.taskuniqueid as string) || null,
        subtotal: numf(i.subtotalamount),
        total: numf(i.totalamount),
        status: parseInt(String(i.status ?? "0"), 10),
        paymentStatus: String(i.paymentstatus ?? ""),
        invoiceDate: numi(i.invoicedate),
        createdOn: numi(i.createdon),
      });
    }
    if (rows.length < perPage) break; // short page = last page (Turia gives no reliable total)
    const total = parseInt(String(wrap.total ?? "0"), 10);
    if (total > 0 && out.length >= total) break;
    page++;
  }
  return out;
}

// Per-task timesheet rows. `amount` = hours × hourlyrate = the manpower cost Turia
// uses for its Revenue − Manpower − OP profit. The bulk timesheet feed doesn't carry
// a task id, so cost/hours must be pulled per task.
export async function fetchTaskTimesheets(taskId: string, range?: { fromMs: number; toMs: number }): Promise<Array<{ username: string; hours: number; amount: number; date: number | null }>> {
  const json = await turiaPost("timesheet", "list", { taskId, taskid: taskId });
  const rows = (json.tasktimesheets as Array<Record<string, unknown>>) || [];
  const mapped = rows.map((r) => ({ username: String(r.username ?? ""), hours: numf(r.totalhours), amount: numf(r.amount), date: tsWorkDate(r) }));
  // Turia IGNORES fromDate/toDate on the per-task call, so scope CLIENT-side by each row's
  // work date. Undateable rows dropped when a range is asked (don't count year-old time).
  if (range) return mapped.filter((r) => r.date != null && r.date >= range.fromMs && r.date <= range.toMs);
  return mapped;
}
