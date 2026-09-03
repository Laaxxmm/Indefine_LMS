// Reports: one flat row per job, filtered in SQL, grouped in memory. A 16-person firm
// has a few thousand jobs at most — no aggregate queries needed.
import type { Department, EntityType, GrowthGoal, JobStatus, TurnoverBand } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEPARTMENTS, departmentLabel } from "@/lib/ca-firm";
import { ENTITY_TYPES, GROWTH_GOALS, JOB_STATUSES, TURNOVER_BANDS, isValidFy } from "./core";
import { istMonth } from "./workbook";

export type JobRow = {
  id: string; clientId: string; client: string; entityType: EntityType; city: string | null; fy: string; month: string;
  department: Department; service: string; serviceTypeId: string; handlerId: string; handler: string; status: JobStatus;
  dueOn: Date | null; fees: number | null; turnover: number; turnoverBand: TurnoverBand; growthGoal: GrowthGoal; createdAt: Date;
};

export type ReportFilters = {
  fy?: string; from?: Date; to?: Date; department?: Department; service?: string; handler?: string;
  band?: TurnoverBand; goal?: GrowthGoal; status?: JobStatus;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]): T | undefined =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

export function parseFilters(sp: Record<string, string | undefined>): ReportFilters {
  return {
    fy: sp.fy && isValidFy(sp.fy) ? sp.fy : undefined,
    from: sp.from && DAY.test(sp.from) ? new Date(`${sp.from}T00:00:00+05:30`) : undefined,
    to: sp.to && DAY.test(sp.to) ? new Date(`${sp.to}T23:59:59.999+05:30`) : undefined,
    department: pick(sp.department, DEPARTMENTS),
    service: sp.service || undefined,
    handler: sp.handler || undefined,
    band: pick(sp.band, Object.keys(TURNOVER_BANDS) as TurnoverBand[]),
    goal: pick(sp.goal, Object.keys(GROWTH_GOALS) as GrowthGoal[]),
    status: pick(sp.status, Object.keys(JOB_STATUSES) as JobStatus[]),
  };
}

// Back to a query string (for the export link and drill-down links).
export function filtersToQuery(sp: Record<string, string | undefined>, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams();
  for (const k of ["fy", "from", "to", "department", "service", "handler", "band", "goal", "status", "group"])
    if (sp[k]) q.set(k, sp[k]!);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

export async function loadJobRows(f: ReportFilters): Promise<JobRow[]> {
  const jobs = await prisma.job.findMany({
    where: {
      fy: f.fy,
      handlerId: f.handler,
      serviceTypeId: f.service,
      status: f.status,
      serviceType: f.department ? { department: f.department } : undefined,
      client: f.band || f.goal ? { turnoverBand: f.band, growthGoal: f.goal } : undefined,
      createdAt: f.from || f.to ? { gte: f.from, lte: f.to } : undefined,
    },
    include: {
      client: { select: { name: true, entityType: true, city: true, turnover: true, turnoverBand: true, growthGoal: true } },
      serviceType: { select: { department: true, name: true } },
      handler: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return jobs.map((j) => ({
    id: j.id, clientId: j.clientId, client: j.client.name, entityType: j.client.entityType, city: j.client.city, fy: j.fy,
    month: istMonth(j.createdAt), department: j.serviceType.department, service: j.serviceType.name, serviceTypeId: j.serviceTypeId,
    handlerId: j.handlerId, handler: j.handler.name ?? j.handler.email, status: j.status, dueOn: j.dueOn, fees: j.fees,
    turnover: j.client.turnover, turnoverBand: j.client.turnoverBand, growthGoal: j.client.growthGoal, createdAt: j.createdAt,
  }));
}

export const GROUP_KEYS = {
  fy: "Financial year", month: "Month", department: "Department", service: "Service", handler: "Handler",
  band: "Turnover band", goal: "Growth goal", entity: "Entity type", city: "City",
} as const;
export type GroupKey = keyof typeof GROUP_KEYS;

export function keyOf(r: JobRow, g: GroupKey): string {
  switch (g) {
    case "fy": return r.fy;
    case "month": return r.month;
    case "department": return departmentLabel(r.department);
    case "service": return r.service;
    case "handler": return r.handler;
    case "band": return TURNOVER_BANDS[r.turnoverBand];
    case "goal": return GROWTH_GOALS[r.growthGoal];
    case "entity": return ENTITY_TYPES[r.entityType];
    case "city": return r.city ?? "—";
  }
}

export const isDone = (s: JobStatus) => s === "DELIVERED" || s === "CLOSED";

// Turnover is a client attribute: count each client once however many jobs it has.
function clientTurnover(rows: JobRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.clientId, r.turnover);
  return m;
}
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

export function summarize(rows: JobRow[], now = new Date()) {
  const clients = clientTurnover(rows);
  return {
    clients: clients.size,
    jobs: rows.length,
    open: rows.filter((r) => !isDone(r.status)).length,
    overdue: rows.filter((r) => !isDone(r.status) && r.dueOn && r.dueOn < now).length,
    turnover: sum(clients),
  };
}

export type GroupRow = { key: string; jobs: number; clients: number; open: number; done: number; turnover: number };

// Order the turnover-band labels canonically (enum declaration order), since the group
// key is the display label, not the enum key itself.
const BAND_ORDER = Object.keys(TURNOVER_BANDS).map((k) => TURNOVER_BANDS[k as TurnoverBand]);

export function groupRows(rows: JobRow[], g: GroupKey): GroupRow[] {
  const groups = new Map<string, JobRow[]>();
  for (const r of rows) {
    const k = keyOf(r, g);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out = [...groups.entries()].map(([key, rs]) => {
    const clients = clientTurnover(rs);
    const done = rs.filter((r) => isDone(r.status)).length;
    return { key, jobs: rs.length, clients: clients.size, open: rs.length - done, done, turnover: sum(clients) };
  });
  // fy/month sort chronologically (both are "YYYY-.." strings, so lexical == chronological);
  // band sorts low-to-high turnover; everything else stays count-desc then alphabetical.
  if (g === "fy" || g === "month") return out.sort((a, b) => a.key.localeCompare(b.key));
  if (g === "band") return out.sort((a, b) => BAND_ORDER.indexOf(a.key) - BAND_ORDER.indexOf(b.key));
  return out.sort((a, b) => b.jobs - a.jobs || a.key.localeCompare(b.key));
}
