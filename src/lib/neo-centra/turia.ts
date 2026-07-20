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
  tatHours: string | null; billable: boolean; users: TuriaTaskUser[];
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
// First parseable value across candidate keys. Turia's completion-date key varies, and a
// silent null there zeroes every completion-gated metric — so try the known spellings.
const picki = (t: Record<string, unknown>, keys: string[]) => { for (const k of keys) { const n = numi(t[k]); if (n) return n; } return null; };
const COMPLETED_KEYS = ["completedon", "completeddate", "completed_on", "completiondate", "closedon", "closeddate", "finishedon", "completedat"];
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

export async function fetchLeads(): Promise<TuriaLead[]> {
  const json = await turiaPost("leads", "list", {});
  const leads = (json.leads || []) as Array<Record<string, unknown>>;
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
      billable: !!t.billable,
      users: Array.isArray(t.userlists) ? (t.userlists as Array<Record<string, unknown>>).map((u) => ({ id: String(u.id), name: String(u.name ?? ""), type: parseInt(String(u.type ?? "0"), 10), role: String(u.role ?? "") })) : [],
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
    const json = await turiaPost("invoice", "list", { page, perPage });
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
    const total = parseInt(String(wrap.total ?? "0"), 10);
    if (total > 0 && out.length >= total) break;
    page++;
  }
  return out;
}

// Per-task timesheet rows. `amount` = hours × hourlyrate = the manpower cost Turia
// uses for its Revenue − Manpower − OP profit. The bulk timesheet feed doesn't carry
// a task id, so cost/hours must be pulled per task.
export async function fetchTaskTimesheets(taskId: string, range?: { fromMs: number; toMs: number }): Promise<Array<{ username: string; hours: number; amount: number }>> {
  // Passing fromDate/toDate scopes the rows to a period server-side — Bucket 4 wants only
  // hours logged *in the quarter*. Omit it for Buckets 2 & 3, whose profit subtracts the
  // task's full manpower regardless of when it was logged.
  const data: Record<string, unknown> = { taskId, taskid: taskId };
  if (range) { data.fromDate = range.fromMs; data.toDate = range.toMs; }
  const json = await turiaPost("timesheet", "list", data);
  const rows = (json.tasktimesheets as Array<Record<string, unknown>>) || [];
  return rows.map((r) => ({ username: String(r.username ?? ""), hours: numf(r.totalhours), amount: numf(r.amount) }));
}
