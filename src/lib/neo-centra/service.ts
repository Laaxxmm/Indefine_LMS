import { prisma } from "@/lib/prisma";
import { generateDeadlines, type Deadline } from "./compliance";

export type DeadlineWithStatus = Deadline & {
  status: "PENDING" | "DONE";
  completedAt: Date | null;
  completedByName: string | null;
};

// Compute the FY's deadlines and merge in any stored completion status.
export async function getComplianceForFy(fyStart: number): Promise<DeadlineWithStatus[]> {
  const deadlines = generateDeadlines(fyStart);
  const statuses = await prisma.neoComplianceStatus.findMany({ where: { fyStartYear: fyStart } });
  const byKey = new Map(statuses.map((s) => [s.key, s]));
  return deadlines.map((d) => {
    const s = byKey.get(d.key);
    return { ...d, status: s?.status === "DONE" ? "DONE" : "PENDING", completedAt: s?.completedAt ?? null, completedByName: s?.completedByName ?? null };
  });
}

export type ComplianceSummary = { total: number; done: number; pending: number; overdue: number; dueThisMonth: number; upcoming30: number };

// Roll a merged deadline list into headline numbers, relative to `todayIso`.
export function summarize(list: DeadlineWithStatus[], todayIso: string): ComplianceSummary {
  const today = todayIso.slice(0, 10);
  const month = today.slice(0, 7);
  const in30 = new Date(`${today}T00:00:00Z`);
  in30.setUTCDate(in30.getUTCDate() + 30);
  const in30Iso = in30.toISOString().slice(0, 10);

  let done = 0, overdue = 0, dueThisMonth = 0, upcoming30 = 0;
  for (const d of list) {
    if (d.status === "DONE") { done++; continue; }
    if (d.dueDate < today) overdue++;
    if (d.dueDate.slice(0, 7) === month) dueThisMonth++;
    if (d.dueDate >= today && d.dueDate <= in30Iso) upcoming30++;
  }
  return { total: list.length, done, pending: list.length - done, overdue, dueThisMonth, upcoming30 };
}
