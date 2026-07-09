import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Fingerprint } from "lucide-react";
import {
  attendancePct as calcPct,
  attendancePoints as calcPoints,
  periodMonthFromString,
  formatPeriodMonth,
} from "@/lib/attendance";
import { AttendanceImporter } from "./AttendanceImporter";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  return session;
}

async function saveAttendance(data: {
  periodMonth: string;
  rows: {
    userId: string;
    presentDays: number;
    workingDays: number;
    lateMarks: number;
    points: number;
  }[];
}): Promise<{ ok: boolean; error?: string; saved?: number }> {
  "use server";
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, error: "Unauthorized" };
  }
  const periodMonth = periodMonthFromString(data.periodMonth);
  if (!periodMonth) return { ok: false, error: "Pick a valid month." };
  if (!data.rows?.length) return { ok: false, error: "No rows to save." };

  const ids = [...new Set(data.rows.map((r) => r.userId))];
  const existing = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const valid = new Set(existing.map((u) => u.id));

  let saved = 0;
  for (const r of data.rows) {
    if (!valid.has(r.userId)) continue;
    const workingDays = Math.max(0, Number(r.workingDays) || 0);
    const presentDays = Math.max(0, Number(r.presentDays) || 0);
    const lateMarks = Math.max(0, Math.round(Number(r.lateMarks) || 0));
    const pct = calcPct(presentDays, workingDays);
    // Trust an explicit admin override, else compute; clamp either way.
    let points = Number(r.points);
    if (!Number.isFinite(points)) points = calcPoints(pct);
    points = Math.max(0, Math.min(100, Math.round(points)));

    await prisma.attendanceRecord.upsert({
      where: { userId_periodMonth: { userId: r.userId, periodMonth } },
      create: {
        userId: r.userId,
        periodMonth,
        workingDays,
        presentDays,
        lateMarks,
        attendancePct: pct,
        points,
        source: "greytHR",
        importedById: session.user.id,
      },
      update: { workingDays, presentDays, lateMarks, attendancePct: pct, points },
    });
    saved++;
  }
  revalidatePath("/admin/attendance");
  return { ok: true, saved };
}

async function deleteAttendanceRecord(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return;
  const id = String(formData.get("id"));
  await prisma.attendanceRecord.delete({ where: { id } }).catch(() => {});
  revalidatePath("/admin/attendance");
}

function currentMonthString(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function AdminAttendancePage() {
  await requireAdmin();

  const [users, records] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendanceRecord.findMany({
      include: { user: { select: { name: true, email: true } } },
      orderBy: [{ periodMonth: "desc" }, { points: "desc" }],
      take: 200,
    }),
  ]);

  // Group records by month for display.
  const byMonth = new Map<string, typeof records>();
  for (const r of records) {
    const key = r.periodMonth.toISOString().slice(0, 7);
    const list = byMonth.get(key) ?? [];
    list.push(r);
    byMonth.set(key, list);
  }

  return (
    <main className="px-6 py-8 max-w-5xl mx-auto">
      <div className="mb-8 flex items-start gap-3.5">
        <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
          <Fingerprint className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1">
            Admin · Attendance
          </p>
          <h1 className="font-display text-[30px] font-extrabold tracking-[-0.02em] leading-none">
            Attendance
          </h1>
          <p className="text-ink-mute mt-2 text-sm max-w-2xl">
            Import attendance from greytHR each month. Points feed the KRA leaderboard total.
          </p>
        </div>
      </div>

      <AttendanceImporter
        users={users.map((u) => ({ id: u.id, name: u.name ?? "", email: u.email }))}
        defaultMonth={currentMonthString()}
        saveAction={saveAttendance}
      />

      <section>
        <h2 className="font-display text-lg font-bold mb-4">Imported records</h2>
        {records.length === 0 ? (
          <div className="rounded-2xl bg-white border border-dashed border-border p-10 text-center text-ink-mute text-sm">
            No attendance imported yet. Upload a monthly CSV above to get started.
          </div>
        ) : (
          <div className="space-y-6">
            {[...byMonth.entries()].map(([key, list]) => {
              const monthLabel = formatPeriodMonth(list[0].periodMonth);
              const totalPts = list.reduce((s, r) => s + r.points, 0);
              return (
                <div key={key} className="rounded-2xl bg-white border border-border shadow-soft overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 bg-muted">
                    <h3 className="font-semibold">{monthLabel}</h3>
                    <span className="text-xs text-ink-mute">
                      {list.length} employee{list.length === 1 ? "" : "s"} · {totalPts} pts
                    </span>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-ink-mute">
                      <tr className="border-b border-border">
                        <th className="text-left px-5 py-2 font-medium">Employee</th>
                        <th className="text-right px-3 py-2 font-medium">Present</th>
                        <th className="text-right px-3 py-2 font-medium">Working</th>
                        <th className="text-right px-3 py-2 font-medium">%</th>
                        <th className="text-right px-3 py-2 font-medium">Late</th>
                        <th className="text-right px-3 py-2 font-medium">Pts</th>
                        <th className="px-5 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.id} className="border-b border-border last:border-0">
                          <td className="px-5 py-2">
                            <div className="font-medium">{r.user.name ?? r.user.email}</div>
                            <div className="text-xs text-ink-faint">{r.user.email}</div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.presentDays}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.workingDays}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.attendancePct}%</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.lateMarks}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{r.points}</td>
                          <td className="px-5 py-2 text-right">
                            <form action={deleteAttendanceRecord}>
                              <input type="hidden" name="id" value={r.id} />
                              <button className="text-xs text-rose-600 hover:text-rose-500">Delete</button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
