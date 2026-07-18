import { prisma } from "@/lib/prisma";
import { currentQuarter } from "./period";
import {
  fetchOrgUsers, fetchTuriaTaskList, fetchTaskTimesheets, fetchLeads, fetchTaskDetail, fetchAllInvoices,
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
export interface InternalTaskResult { taskId: string; identity: string; name: string; approvedHours: number | null; actualHours: number; withinApproved: boolean | null; contributors: Array<{ director: string; hours: number }> }
export interface DirectorLeadItem { id: string; identity: string; name: string; dealValue: number; stage: string; referredBy: string | null; converted: boolean }
export interface DirectorTaskDrill { taskId: string; identity: string; name: string; budget: number; billedPeriod: number; invoiceTotal: number; profit: number; hours: number | null; sharedWith: number; dueDate: number | null; flags: string[] }
export interface DirectorIncentive {
  directorId: string; name: string; turiaUserId: string | null; turiaUsername: string | null; resolved: boolean;
  buckets: {
    leadConversion: { available: boolean; originatedLeads: number; originatedValue: number; convertedLeads: number; convertedValue: number; conversionRate: number };
    billing: { available: boolean; billedInPeriod: number; taskCount: number };
    profitability: { available: boolean; profitInPeriod: number; taskCount: number };
    internalImprovement: { available: boolean; qualifyingTasks: number; totalContributedTasks: number; internalHours: number };
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
function isInternalTask(t: Task): boolean {
  const hay = `${t.taskname ?? ""} ${t.servicename ?? ""} ${t.categoryname ?? ""} ${t.clientname ?? ""}`.toLowerCase();
  return hay.includes("internal") || hay.includes("company development");
}
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

  const [tasks, leads, invoices] = await Promise.all([
    fetchTuriaTaskList(1, 2000),
    fetchLeads(),
    fetchAllInvoices(),
  ]);

  // Bucket 4: internal / company-dev tasks — per-task timesheets give hours + who logged.
  const internalTasks: InternalTaskResult[] = await mapPool(tasks.filter(isInternalTask), 6, async (t) => {
    const identity = String(t.uniqueidentity ?? "").replace("#", "");
    const budget = budgets.find((b) => (b.turiaTaskId && b.turiaTaskId === String(t.id)) || (b.taskIdentity && b.taskIdentity === identity));
    const approvedHours = budget ? budget.approvedHours : null;
    const rows = await fetchTaskTimesheets(String(t.id));
    const byDirector = new Map<string, number>();
    let actualHours = 0;
    for (const r of rows) {
      if (!(r.hours > 0)) continue;
      actualHours += r.hours;
      const dir = directorForUsername(r.username, directors);
      if (dir) byDirector.set(dir.name, (byDirector.get(dir.name) || 0) + r.hours);
    }
    return {
      taskId: String(t.id), identity, name: String(t.taskname ?? t.clientname ?? "Untitled"),
      approvedHours, actualHours: round1(actualHours),
      withinApproved: approvedHours === null ? null : actualHours <= approvedHours,
      contributors: [...byDirector.entries()].map(([director, hours]) => ({ director, hours: round1(hours) })).sort((a, b) => b.hours - a.hours),
    };
  });

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

  // Buckets 2 + 3: period billing + prorated profit per director (equal-split per task)
  const periodInvoices = invoices.filter((inv) => { const t = inv.createdOn ?? inv.invoiceDate; return t !== null && t >= fromMs && t <= toMs; });
  const periodBillingByTask = new Map<string, number>();
  for (const inv of periodInvoices) { if (!inv.taskId) continue; periodBillingByTask.set(inv.taskId, (periodBillingByTask.get(inv.taskId) || 0) + inv.subtotal); }

  // Per billed task: task/get for the director userlists, and the task's timesheets
  // for the manpower cost. Profit = period billing − manpower (Turia's formula, OP≈0).
  type MoneyStats = { billed: number; profit: number; taskIds: Set<string> };
  const moneyByDirector = new Map<string, MoneyStats>();
  const tasksByDirector = new Map<string, DirectorTaskDrill[]>();
  const perTask = await mapPool([...periodBillingByTask.keys()], 6, async (taskId) => {
    const [detail, tsRows] = await Promise.all([fetchTaskDetail(taskId), fetchTaskTimesheets(taskId)]);
    return { taskId, detail, tsRows };
  });
  for (const { taskId, detail, tsRows } of perTask) {
    const periodBilling = periodBillingByTask.get(taskId) ?? 0;
    if (!detail) continue;
    const taskDirectors: DirectorRow[] = [];
    for (const u of detail.users) { const dir = directorForName(u.name, directors); if (dir && !taskDirectors.some((td) => td.id === dir.id)) taskDirectors.push(dir); }
    if (taskDirectors.length === 0) continue;

    const manpower = tsRows.reduce((s, r) => s + r.amount, 0);
    const periodProfit = periodBilling - manpower; // OP expense treated as 0 (rarely set)
    const split = taskDirectors.length;
    const flags = periodProfit < 0 ? ["over-budget", ...taskFlags(detail).filter((f) => f !== "over-budget")] : taskFlags(detail).filter((f) => f !== "over-budget");
    const drill: DirectorTaskDrill = { taskId, identity: detail.identity, name: detail.name, budget: Math.round(detail.budgetAmount), billedPeriod: Math.round(periodBilling), invoiceTotal: Math.round(periodBilling), profit: Math.round(periodProfit), hours: parseTatHours(detail.tatHours), sharedWith: split, dueDate: detail.dueDate, flags };
    for (const td of taskDirectors) {
      const stats = moneyByDirector.get(td.id) || { billed: 0, profit: 0, taskIds: new Set<string>() };
      stats.billed += periodBilling / split; stats.profit += periodProfit / split; stats.taskIds.add(taskId);
      moneyByDirector.set(td.id, stats);
      tasksByDirector.set(td.id, [...(tasksByDirector.get(td.id) || []), drill]);
    }
  }

  const directorResults: DirectorIncentive[] = directors.map((d) => {
    const contributed = internalTasks.filter((it) => it.contributors.some((c) => c.director === d.name));
    const qualifying = contributed.filter((it) => it.withinApproved === true);
    const internalHours = contributed.reduce((sum, it) => sum + (it.contributors.find((c) => c.director === d.name)?.hours || 0), 0);
    const lead = leadStatsByDirector.get(d.id) || { orig: 0, origVal: 0, conv: 0, convVal: 0 };
    const money = moneyByDirector.get(d.id) || { billed: 0, profit: 0, taskIds: new Set<string>() };
    return {
      directorId: d.id, name: d.name, turiaUserId: d.turiaUserId, turiaUsername: d.turiaUsername, resolved: !!d.turiaUserId,
      buckets: {
        leadConversion: { available: true, originatedLeads: lead.orig, originatedValue: Math.round(lead.origVal), convertedLeads: lead.conv, convertedValue: Math.round(lead.convVal), conversionRate: lead.orig > 0 ? Math.round((lead.conv / lead.orig) * 1000) / 1000 : 0 },
        billing: { available: true, billedInPeriod: Math.round(money.billed), taskCount: money.taskIds.size },
        profitability: { available: true, profitInPeriod: Math.round(money.profit), taskCount: money.taskIds.size },
        internalImprovement: { available: true, qualifyingTasks: qualifying.length, totalContributedTasks: contributed.length, internalHours: round1(internalHours) },
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
  const active = b.leadConversion.convertedValue > 0 || b.billing.billedInPeriod > 0 || b.profitability.profitInPeriod > 0 || b.internalImprovement.qualifyingTasks > 0;
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
