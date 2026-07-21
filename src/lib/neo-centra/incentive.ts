import { prisma } from "@/lib/prisma";
import { currentQuarter } from "./period";
import { profitPercents } from "./split";
import {
  fetchOrgUsers, fetchTuriaTaskList, fetchTaskTimesheets, fetchLeads, fetchTaskDetail, fetchAllInvoices, parseBillable, isCancelled,
  type TuriaLead, type TuriaTaskDetail,
} from "./turia";

// Director Incentive Engine — four buckets, sourced from Turia. Faithful port of
// Neo Centra's incentive.service.ts. Directors = the firm's Partner users; each is
// mapped to a Turia org user (NeoDirectorMapping) so timesheet/lead rows attribute.
//   1. Lead origination → conversion (originator credit)
//   2. Billing realized from invoices  (hours-logger credit, equal-split per task)
//   3. Task profitability / margin      (hours-logger credit, equal-split per task)
//   4. Internal / company-dev tasks within board-approved hours (hours-logger credit)

const CONVERTED_STAGE_PATTERNS = [/won/i, /converted/i, /closed.?won/i, /onboarded/i];
const OPEN_STATUSES = new Set(["1", "2", "6"]);
const LONG_PENDING_MS = 45 * 86400000;

function isLeadConverted(lead: TuriaLead): boolean {
  return CONVERTED_STAGE_PATTERNS.some((rx) => rx.test(`${lead.stageName} ${lead.statusName}`));
}
const round1 = (n: number) => Math.round(n * 10) / 10;
const normalize = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Bounded-concurrency map — the per-task Turia calls are the slow part; a small pool
// keeps a large firm's sync from timing out without hammering Turia.
async function mapPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return out;
}

// ── Types (identical to the source) ──────────────────────────────────────────
export interface DirectorRow { id: string; name: string; turiaUserId: string | null; turiaUsername: string | null; isActive: boolean; isAdmin: boolean }
// `contributors` carries each partner's OWN hours on the task plus their planned
// allocation (null = none set). Partners with an allocation but no logged hours are
// included too, so they still see the task and their 0/N. `budgetHours` = Turia's
// Budget Time for the task, shown as a reference when allocating.
export interface InternalTaskResult { taskId: string; identity: string; name: string; completed: boolean; approvedHours: number | null; budgetHours: number | null; actualHours: number; withinApproved: boolean | null; contributors: Array<{ director: string; directorId?: string; hours: number; planned?: number | null }> }
export interface DirectorLeadItem { id: string; identity: string; name: string; dealValue: number; stage: string; referredBy: string | null; converted: boolean }
export interface DirectorTaskDrill { taskId: string; identity: string; name: string; budget: number; billedPeriod: number; invoiceTotal: number; profit: number; hours: number | null; sharedWith: number; dueDate: number | null; flags: string[]; profitPartners?: Array<{ directorId: string; name: string; percent: number }>; completed?: boolean; profitPct?: number | null; billable?: boolean }
export interface DirectorIncentive {
  directorId: string; name: string; turiaUserId: string | null; turiaUsername: string | null; resolved: boolean;
  buckets: {
    leadConversion: { available: boolean; originatedLeads: number; originatedValue: number; convertedLeads: number; convertedValue: number; conversionRate: number };
    billing: { available: boolean; billedInPeriod: number; billedHours: number; taskCount: number };
    profitability: { available: boolean; profitInPeriod: number; taskCount: number; profitPct: number | null };
    internalImprovement: { available: boolean; completedTasks: number; totalTasks: number; completionRate: number; hoursSpent: number; targetHours: number; overBudget: boolean };
  };
  leads: DirectorLeadItem[];
  tasks: DirectorTaskDrill[];
}
export interface IncentiveSummary { periodStart: string; periodEnd: string; generatedAt: string; directors: DirectorIncentive[]; internalTasks: InternalTaskResult[] }
export interface InternalBudgetRow { id: string; turiaTaskId: string | null; taskIdentity: string | null; taskName: string; approvedHours: number; approvedBy: string | null; notes: string | null }

// ── Director registry = Partner users + Turia mapping ─────────────────────────
export async function getDirectors(): Promise<DirectorRow[]> {
  const [users, mappings] = await Promise.all([
    prisma.user.findMany({ where: { active: true, level: "PARTNER" }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
    prisma.neoDirectorMapping.findMany(),
  ]);
  const byUser = new Map(mappings.map((m) => [m.userId, m]));
  return users.map((u) => {
    const m = byUser.get(u.id);
    return { id: u.id, name: u.name ?? u.email, turiaUserId: m?.turiaUserId ?? null, turiaUsername: m?.turiaUsername ?? null, isActive: true, isAdmin: u.role === "ADMIN" };
  });
}

function bestUserMatch(directorName: string, users: Array<{ id: string; name: string }>): { id: string; name: string } | null {
  const target = normalize(directorName);
  const targetFirst = (directorName || "").toLowerCase().split(/\s+/)[0];
  let best: { id: string; name: string } | null = null;
  let bestScore = 0;
  for (const u of users) {
    if (!u.name) continue;
    const cand = normalize(u.name);
    const candFirst = u.name.toLowerCase().split(/\s+/)[0];
    let score = 0;
    if (cand === target) score = 100;
    else if (cand.includes(target) || target.includes(cand)) score = 70;
    else if (candFirst && targetFirst && candFirst === targetFirst) score = 50;
    else if (candFirst && targetFirst && (candFirst.startsWith(targetFirst) || targetFirst.startsWith(candFirst))) score = 30;
    if (score > bestScore) { bestScore = score; best = { id: u.id, name: u.name }; }
  }
  return bestScore >= 30 ? best : null;
}

// Resolve each Partner to a Turia org user (fuzzy name match), persist the mapping.
export async function resolveDirectors(): Promise<DirectorRow[]> {
  const directors = await getDirectors();
  const orgUsers = await fetchOrgUsers();
  for (const d of directors) {
    const match = bestUserMatch(d.name, orgUsers);
    if (match) {
      await prisma.neoDirectorMapping.upsert({
        where: { userId: d.id },
        create: { userId: d.id, turiaUserId: match.id, turiaUsername: match.name },
        update: { turiaUserId: match.id, turiaUsername: match.name },
      });
    }
  }
  return getDirectors();
}

export async function getInternalBudgets(): Promise<InternalBudgetRow[]> {
  const rows = await prisma.neoInternalBudget.findMany({ orderBy: { taskName: "asc" } });
  return rows.map((r) => ({ id: r.id, turiaTaskId: r.turiaTaskId, taskIdentity: r.taskIdentity, taskName: r.taskName, approvedHours: r.approvedHours, approvedBy: r.approvedBy, notes: r.notes }));
}

// Bucket 3 manual profit splits, keyed by Turia task. `splits` = { directorId: percent }.
export interface ProfitSplitRow { turiaTaskId: string | null; taskIdentity: string | null; splits: Record<string, number> }
export async function getProfitSplits(): Promise<ProfitSplitRow[]> {
  const rows = await prisma.neoProfitSplit.findMany();
  return rows.map((r) => ({ turiaTaskId: r.turiaTaskId, taskIdentity: r.taskIdentity, splits: (r.splits as Record<string, number>) ?? {} }));
}

// Bucket 4 planned-hours allocations, keyed by Turia task. `hours` = { directorId: hours }.
export interface HoursSplitRow { turiaTaskId: string | null; taskIdentity: string | null; hours: Record<string, number> }
export async function getHoursSplits(): Promise<HoursSplitRow[]> {
  const rows = await prisma.neoHoursSplit.findMany();
  return rows.map((r) => ({ turiaTaskId: r.turiaTaskId, taskIdentity: r.taskIdentity, hours: (r.hours as Record<string, number>) ?? {} }));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseTatHours(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/^(\d+):(\d+)$/);
  if (!m) { const f = parseFloat(s); return Number.isFinite(f) ? f : null; }
  const h = parseInt(m[1], 10), mm = parseInt(m[2], 10);
  return Math.round((mm > 59 ? h + mm / 100 : h + mm / 60) * 100) / 100;
}
function taskFlags(detail: TuriaTaskDetail): string[] {
  const flags: string[] = [];
  const open = detail.status != null && OPEN_STATUSES.has(detail.status);
  if (detail.profit < 0) flags.push("over-budget");
  if (open && detail.dueDate && detail.dueDate < Date.now()) flags.push("overdue");
  if (open && detail.createdOn && Date.now() - detail.createdOn > LONG_PENDING_MS) flags.push("long-pending");
  return flags;
}
type Task = Record<string, unknown>;
// Bucket 4 = tasks whose Turia service Category is "Bucket 4". Fall back to the
// service/task name convention (…Internal B4 / Firm Building) if the list row
// doesn't carry the category.
function isInternalTask(t: Task): boolean {
  const cat = String(t.categoryname ?? t.category ?? "").toLowerCase();
  if (cat.includes("bucket 4") || cat.includes("bucket4")) return true;
  const hay = `${t.servicename ?? ""} ${t.taskname ?? ""}`.toLowerCase();
  return hay.includes("bucket 4") || hay.includes("internal b4") || hay.includes("firm building");
}
const TASK_COMPLETED = "3"; // Turia taskstatus for a completed task
function directorForUsername(username: string, directors: DirectorRow[]): DirectorRow | null {
  const u = (username || "").trim().toLowerCase();
  if (!u) return null;
  const uFirst = u.split(/\s+/)[0];
  for (const d of directors) {
    for (const c of [d.turiaUsername, d.name].filter(Boolean) as string[]) {
      const cl = c.toLowerCase();
      if (cl === u) return d;
      if (cl.split(/\s+/)[0] === uFirst) return d;
      if (normalize(c) === normalize(username)) return d;
    }
  }
  return null;
}
const directorForName = directorForUsername;

// ── Orchestration ────────────────────────────────────────────────────────────
export async function computeIncentiveSummary(fromMs: number, toMs: number): Promise<IncentiveSummary> {
  const directors = (await getDirectors()).filter((d) => d.isActive);
  const budgets = await getInternalBudgets();
  const profitSplits = await getProfitSplits();
  const splitFor = (taskId: string, identity: string): Record<string, number> | null =>
    profitSplits.find((s) => (s.turiaTaskId && s.turiaTaskId === taskId) || (s.taskIdentity && s.taskIdentity === identity))?.splits ?? null;
  const hoursSplits = await getHoursSplits();
  const plannedFor = (taskId: string, identity: string): Record<string, number> =>
    hoursSplits.find((s) => (s.turiaTaskId && s.turiaTaskId === taskId) || (s.taskIdentity && s.taskIdentity === identity))?.hours ?? {};

  const [tasks, leads, invoices] = await Promise.all([
    fetchTuriaTaskList(1, 2000),
    fetchLeads(),
    fetchAllInvoices(),
  ]);

  // Bucket 4: internal / company-dev tasks, scoped to the quarter. A task counts as
  // "done" only if it was completed *within* the period (Turia completedOn), and only
  // hours logged *within* the period count (per-task timesheets fetched for the range).
  // Tasks with no in-quarter hours and no in-quarter completion drop out of the quarter.
  const internalTasks: InternalTaskResult[] = (await mapPool(tasks.filter(isInternalTask), 6, async (t) => {
    const identity = String(t.uniqueidentity ?? "").replace("#", "");
    const budget = budgets.find((b) => (b.turiaTaskId && b.turiaTaskId === String(t.id)) || (b.taskIdentity && b.taskIdentity === identity));
    const approvedHours = budget ? budget.approvedHours : null;
    const [detail, rows] = await Promise.all([
      fetchTaskDetail(String(t.id)),
      fetchTaskTimesheets(String(t.id), { fromMs, toMs }),
    ]);
    const completedOn = detail?.completedOn ?? null;
    // Same rule as B2/B3: status decides "done". If Turia gives no completion date, don't
    // drop it — the task is already scoped to the quarter by its in-quarter hours.
    const completedInPeriod = String(t.taskstatus ?? "") === TASK_COMPLETED
      && (completedOn == null || (completedOn >= fromMs && completedOn <= toMs));
    const planned = plannedFor(String(t.id), identity);
    const byDirector = new Map<string, number>(); // directorId → their OWN logged hours
    let actualHours = 0;
    for (const r of rows) {
      if (!(r.hours > 0)) continue;
      actualHours += r.hours;
      const dir = directorForUsername(r.username, directors);
      if (dir) byDirector.set(dir.id, (byDirector.get(dir.id) || 0) + r.hours);
    }
    // Partners on this task = those who logged hours ∪ those given a planned allocation,
    // so someone allocated 20h who hasn't started still sees the task at 0/20.
    const contributors = [...new Set<string>([...byDirector.keys(), ...Object.keys(planned)])]
      .map((id) => {
        const dir = directors.find((x) => x.id === id);
        if (!dir) return null;
        return { director: dir.name, directorId: id, hours: round1(byDirector.get(id) || 0), planned: typeof planned[id] === "number" ? planned[id] : null };
      })
      .filter((c): c is { director: string; directorId: string; hours: number; planned: number | null } => c !== null)
      .sort((a, b) => b.hours - a.hours);
    return {
      taskId: String(t.id), identity, name: String(t.taskname ?? t.clientname ?? "Untitled"),
      completed: completedInPeriod,
      approvedHours,
      budgetHours: parseTatHours(detail?.tatHours ?? null), // Turia's Budget Time, e.g. 99h
      actualHours: round1(actualHours),
      withinApproved: approvedHours === null ? null : actualHours <= approvedHours,
      contributors,
    };
  })).filter((it) => it.contributors.length > 0 || it.completed);

  // Bucket 1: lead origination + conversion
  type LeadStats = { orig: number; origVal: number; conv: number; convVal: number };
  const leadStatsByDirector = new Map<string, LeadStats>();
  const leadItemsByDirector = new Map<string, DirectorLeadItem[]>();
  for (const lead of leads) {
    const owner = lead.owners[0];
    if (!owner) continue;
    const dir = directorForName(owner.name, directors);
    if (!dir) continue;
    const stats = leadStatsByDirector.get(dir.id) || { orig: 0, origVal: 0, conv: 0, convVal: 0 };
    stats.orig++; stats.origVal += lead.dealValue;
    let converted = false;
    if (isLeadConverted(lead)) {
      const moment = lead.updatedOn ?? lead.createdOn;
      if (moment === null || (moment >= fromMs && moment <= toMs)) { stats.conv++; stats.convVal += lead.dealValue; converted = true; }
    }
    leadStatsByDirector.set(dir.id, stats);
    leadItemsByDirector.set(dir.id, [...(leadItemsByDirector.get(dir.id) || []), { id: lead.id, identity: lead.identity, name: lead.name, dealValue: Math.round(lead.dealValue), stage: lead.stageName, referredBy: lead.referredBy, converted }]);
  }

  // Buckets 2 + 3: a task's full billing + profit land in the quarter the *task was
  // completed* (Turia completedOn), NOT when it was invoiced — a May task invoiced in
  // July belongs to Q1. Sum every invoice per task; the earliest invoice date is only a
  // fallback for tasks Turia has no completion date for (e.g. still in progress).
  const billingByTask = new Map<string, { subtotal: number; invoiceDate: number | null }>();
  for (const inv of invoices) {
    if (!inv.taskId) continue;
    const cur = billingByTask.get(inv.taskId) ?? { subtotal: 0, invoiceDate: null };
    cur.subtotal += inv.subtotal;
    const d = inv.invoiceDate ?? inv.createdOn;
    if (d != null && (cur.invoiceDate == null || d < cur.invoiceDate)) cur.invoiceDate = d;
    billingByTask.set(inv.taskId, cur);
  }

  // Per billed task: task/get for the director userlists, and the task's timesheets
  // for the manpower cost. Profit = period billing − manpower (Turia's formula, OP≈0).
  // Billing (B2) and profit (B3) are attributed on *different* bases, so each keeps
  // its own task set: B2 credits whoever logged time; B3 credits assigned partners.
  type MoneyStats = { billed: number; billedHours: number; profit: number; invoiceValue: number; billedTaskIds: Set<string>; profitTaskIds: Set<string> };
  const moneyByDirector = new Map<string, MoneyStats>();
  const statsFor = (id: string) => {
    let s = moneyByDirector.get(id);
    if (!s) { s = { billed: 0, billedHours: 0, profit: 0, invoiceValue: 0, billedTaskIds: new Set<string>(), profitTaskIds: new Set<string>() }; moneyByDirector.set(id, s); }
    return s;
  };
  const tasksByDirector = new Map<string, DirectorTaskDrill[]>();
  // ponytail: fetches detail for every billed task, then gates by completion date. Fine
  // for this firm's history; if it grows huge, pre-filter by a task-list completion date.
  const perTask = await mapPool([...billingByTask.keys()], 6, async (taskId) => {
    const [detail, tsRows] = await Promise.all([fetchTaskDetail(taskId), fetchTaskTimesheets(taskId)]);
    return { taskId, detail, tsRows };
  });
  for (const { taskId, detail, tsRows } of perTask) {
    if (!detail || detail.cancelled) continue; // cancelled tasks earn nothing
    const bill = billingByTask.get(taskId)!;
    // Quarter = task completion date; fall back to invoice date only when Turia has no
    // completion date (task not finished). Outside the quarter → skip entirely.
    const effectiveDate = detail.completedOn ?? bill.invoiceDate;
    if (effectiveDate == null || effectiveDate < fromMs || effectiveDate > toMs) continue;
    const periodBilling = bill.subtotal;

    // Profit (B3 only) is booked ONLY once the task is actually finished, in the quarter
    // it finished. An invoiced but in-progress task — e.g. TSK03742: invoice raised, 0%
    // done, no timesheet — would otherwise post its entire invoice as pure profit, since
    // profit = billing − manpower and manpower is still 0. Billing (B2) is unaffected and
    // keeps accruing on invoiced work whether or not the task is complete.
    // "Done" is decided by STATUS, never by the presence of a completion date — Turia
    // doesn't reliably return one, and requiring it zeroed every partner's profit. The
    // date only decides *which* quarter; fall back to the invoice date when absent.
    const completionDate = detail.completedOn ?? bill.invoiceDate;
    const completedInPeriod = detail.status === TASK_COMPLETED && completionDate != null
      && completionDate >= fromMs && completionDate <= toMs;

    // Bucket 2 — a partner's billing = the cost of their OWN logged time on the task
    // (Turia's timesheet `amount` = their hours × their rate), counted ONLY on billable
    // tasks. We no longer split the invoice; each partner is credited exactly what their
    // own time cost, so 4h of work shows as 4h of value, not the whole invoice.
    const costByDir = new Map<string, number>();
    const hoursByDir = new Map<string, number>(); // partner's own hours, shown beside billing
    for (const r of tsRows) {
      const dir = directorForUsername(r.username, directors);
      if (dir) {
        costByDir.set(dir.id, (costByDir.get(dir.id) || 0) + r.amount);
        hoursByDir.set(dir.id, (hoursByDir.get(dir.id) || 0) + r.hours);
      }
    }

    // Bucket 3 — profit is split among the partners *assigned* to the task, regardless
    // of who logged time. A saved manual split (40/60 etc.) wins when it covers every
    // assigned partner; otherwise the profit is divided equally (the default).
    const assignedDirs: DirectorRow[] = [];
    for (const u of detail.users) { const dir = directorForName(u.name, directors); if (dir && !assignedDirs.some((td) => td.id === dir.id)) assignedDirs.push(dir); }
    const pcts = profitPercents(assignedDirs.map((d) => d.id), splitFor(taskId, detail.identity));
    const pctFor = (id: string) => pcts[id] ?? 0;
    const profitPartners = assignedDirs.length > 1 ? assignedDirs.map((d) => ({ directorId: d.id, name: d.name, percent: Math.round(pctFor(d.id)) })) : undefined;

    const manpower = tsRows.reduce((s, r) => s + r.amount, 0);
    const periodProfit = periodBilling - manpower; // OP expense treated as 0 (rarely set)
    const flags = periodProfit < 0 ? ["over-budget", ...taskFlags(detail).filter((f) => f !== "over-budget")] : taskFlags(detail).filter((f) => f !== "over-budget");

    const participantIds = new Set<string>([...costByDir.keys(), ...assignedDirs.map((d) => d.id)]);
    for (const id of participantIds) {
      const billShare = detail.billable ? (costByDir.get(id) || 0) : 0;
      const isAssigned = assignedDirs.some((d) => d.id === id);
      const profitShare = isAssigned && completedInPeriod ? periodProfit * (pctFor(id) / 100) : 0;
      const stats = statsFor(id);
      if (billShare > 0) { stats.billed += billShare; stats.billedHours += hoursByDir.get(id) || 0; stats.billedTaskIds.add(taskId); }
      // Track the invoice value behind each partner's profit share (same split %), so the
      // bucket margin is a value-weighted average of task margins, not a naive mean.
      if (isAssigned && completedInPeriod) { stats.profit += profitShare; stats.invoiceValue += periodBilling * (pctFor(id) / 100); stats.profitTaskIds.add(taskId); }
      const drill: DirectorTaskDrill = { taskId, identity: detail.identity, name: detail.name, budget: Math.round(detail.budgetAmount), billedPeriod: Math.round(billShare), invoiceTotal: Math.round(periodBilling), profit: Math.round(profitShare), hours: parseTatHours(detail.tatHours), sharedWith: participantIds.size, dueDate: detail.dueDate, flags, profitPartners, completed: completedInPeriod, profitPct: completedInPeriod && periodBilling > 0 ? Math.round((periodProfit / periodBilling) * 100) : null, billable: detail.billable };
      tasksByDirector.set(id, [...(tasksByDirector.get(id) || []), drill]);
    }
  }

  // Bucket 2, second pass — BILLABLE tasks that aren't invoiced yet. Billable work is
  // billable whether or not an invoice exists, so each partner's in-quarter timesheet
  // cost on it still counts toward billing. No invoice = no revenue = no profit, so we
  // don't touch Bucket 3 here (its price/profit is unknown until invoiced + completed).
  // ponytail: fetches timesheets for every billable un-invoiced task; if the firm's task
  // list grows huge, pre-filter to tasks a director is on before fetching.
  const invoicedIds = new Set(billingByTask.keys());
  const uninvoicedBillable = tasks.filter((t) => !invoicedIds.has(String(t.id)) && parseBillable(t, false) && !isCancelled(t));
  const uninvoicedRows = await mapPool(uninvoicedBillable, 6, async (t) => ({ t, rows: await fetchTaskTimesheets(String(t.id), { fromMs, toMs }) }));
  for (const { t, rows } of uninvoicedRows) {
    const costByDir = new Map<string, number>();
    const hoursByDir = new Map<string, number>();
    for (const r of rows) {
      const dir = directorForUsername(r.username, directors);
      if (dir) { costByDir.set(dir.id, (costByDir.get(dir.id) || 0) + r.amount); hoursByDir.set(dir.id, (hoursByDir.get(dir.id) || 0) + r.hours); }
    }
    const identity = String(t.uniqueidentity ?? "").replace("#", "");
    const name = String(t.taskname ?? t.clientname ?? "Untitled");
    for (const [id, cost] of costByDir) {
      if (!(cost > 0)) continue;
      const stats = statsFor(id);
      stats.billed += cost; stats.billedHours += hoursByDir.get(id) || 0; stats.billedTaskIds.add(String(t.id));
      const drill: DirectorTaskDrill = { taskId: String(t.id), identity, name, budget: 0, billedPeriod: Math.round(cost), invoiceTotal: 0, profit: 0, hours: null, sharedWith: costByDir.size, dueDate: null, flags: [], completed: false, profitPct: null, billable: true };
      tasksByDirector.set(id, [...(tasksByDirector.get(id) || []), drill]);
    }
  }

  const directorResults: DirectorIncentive[] = directors.map((d) => {
    const contributed = internalTasks.filter((it) => it.contributors.some((c) => c.director === d.name));
    const completedTasks = contributed.filter((it) => it.completed).length;
    const hoursSpent = contributed.reduce((sum, it) => sum + (it.contributors.find((c) => c.director === d.name)?.hours || 0), 0);
    // Target = this partner's OWN planned allocation across the tasks they're on — not
    // the whole task's budget (which would measure every partner against the full 99h).
    const targetHours = contributed.reduce((sum, it) => sum + (it.contributors.find((c) => c.director === d.name)?.planned ?? 0), 0);
    const lead = leadStatsByDirector.get(d.id) || { orig: 0, origVal: 0, conv: 0, convVal: 0 };
    const money = moneyByDirector.get(d.id) || { billed: 0, billedHours: 0, profit: 0, invoiceValue: 0, billedTaskIds: new Set<string>(), profitTaskIds: new Set<string>() };
    return {
      directorId: d.id, name: d.name, turiaUserId: d.turiaUserId, turiaUsername: d.turiaUsername, resolved: !!d.turiaUserId,
      buckets: {
        leadConversion: { available: true, originatedLeads: lead.orig, originatedValue: Math.round(lead.origVal), convertedLeads: lead.conv, convertedValue: Math.round(lead.convVal), conversionRate: lead.orig > 0 ? Math.round((lead.conv / lead.orig) * 1000) / 1000 : 0 },
        billing: { available: true, billedInPeriod: Math.round(money.billed), billedHours: round1(money.billedHours), taskCount: money.billedTaskIds.size },
        profitability: { available: true, profitInPeriod: Math.round(money.profit), taskCount: money.profitTaskIds.size, profitPct: money.invoiceValue > 0 ? Math.round((money.profit / money.invoiceValue) * 100) : null },
        internalImprovement: {
          available: true,
          completedTasks, totalTasks: contributed.length,
          completionRate: contributed.length > 0 ? Math.round((completedTasks / contributed.length) * 1000) / 1000 : 0,
          hoursSpent: round1(hoursSpent), targetHours: round1(targetHours),
          overBudget: targetHours > 0 && hoursSpent > targetHours,
        },
      },
      leads: (leadItemsByDirector.get(d.id) || []).sort((a, b) => b.dealValue - a.dealValue),
      tasks: (tasksByDirector.get(d.id) || []).sort((a, b) => b.billedPeriod - a.billedPeriod),
    };
  });

  return { periodStart: new Date(fromMs).toISOString(), periodEnd: new Date(toMs).toISOString(), generatedAt: new Date().toISOString(), directors: directorResults, internalTasks };
}

// ── Snapshots ────────────────────────────────────────────────────────────────
export async function saveSnapshot(fromMs: number, toMs: number): Promise<IncentiveSummary> {
  const summary = await computeIncentiveSummary(fromMs, toMs);
  await prisma.neoIncentiveSnapshot.create({ data: { periodStart: new Date(fromMs), periodEnd: new Date(toMs), generatedAt: new Date(summary.generatedAt), data: summary as unknown as object } });
  return summary;
}
export async function getSnapshotForPeriod(fromMs: number, toMs: number): Promise<IncentiveSummary | null> {
  const row = await prisma.neoIncentiveSnapshot.findFirst({ where: { periodStart: { gte: new Date(fromMs), lte: new Date(toMs) } }, orderBy: { generatedAt: "desc" } });
  return row ? (row.data as unknown as IncentiveSummary) : null;
}

// At-a-glance "on incentive track?" for the main dashboard, from the current
// quarter's latest snapshot. `none` = not synced yet; `review` = synced but no
// qualifying activity for this director; `on` = has activity in any bucket.
// (Rule is intentionally simple until real per-bucket targets are configured.)
export type TrackStatus = { state: "on" | "review" | "none"; label: string; quarter: string };
export async function incentiveTrackStatus(userId: string): Promise<TrackStatus> {
  const q = currentQuarter(Date.now());
  const snap = await getSnapshotForPeriod(q.fromMs, q.toMs);
  if (!snap) return { state: "none", label: "Not synced", quarter: q.label };
  const d = snap.directors.find((x) => x.directorId === userId);
  if (!d) return { state: "none", label: "No data", quarter: q.label };
  const b = d.buckets;
  const active = b.leadConversion.convertedValue > 0 || b.billing.billedInPeriod > 0 || b.profitability.profitInPeriod > 0 || b.internalImprovement.completedTasks > 0;
  return active ? { state: "on", label: "On incentive track", quarter: q.label } : { state: "review", label: "Needs attention", quarter: q.label };
}

// ── Viewer filtering ──────────────────────────────────────────────────────────
// Admin (ADMIN-role Partner) sees every director's detail. A director sees own
// detail + others' bucket totals only (drill-downs stripped).
export interface FilteredSummary extends IncentiveSummary { viewer: { directorId: string | null; isAdmin: boolean } }
export function filterSummaryForViewer(summary: IncentiveSummary, viewerId: string, isAdmin: boolean, viewerName: string): FilteredSummary {
  if (isAdmin) return { ...summary, viewer: { directorId: viewerId, isAdmin: true } };
  const directors = summary.directors.map((d) => (d.directorId === viewerId ? d : { ...d, tasks: [], leads: [] }));
  const internalTasks = summary.internalTasks.map((t) => ({ ...t, contributors: t.contributors.filter((c) => c.director === viewerName) }));
  return { ...summary, directors, internalTasks, viewer: { directorId: viewerId, isAdmin: false } };
}
