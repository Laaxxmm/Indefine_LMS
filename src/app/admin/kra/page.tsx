import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { computeKraScores } from "@/lib/kra";

export const dynamic = "force-dynamic";

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function defaultRange() {
  // Default: current financial year (Apr 1 → Mar 31, India default)
  const now = new Date();
  const y = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
  return {
    from: new Date(y, 3, 1).toISOString().slice(0, 10),
    to: new Date(y + 1, 2, 31).toISOString().slice(0, 10),
  };
}

export default async function KraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const sp = await searchParams;
  const def = defaultRange();
  const fromStr = sp.from ?? def.from;
  const toStr = sp.to ?? def.to;
  const from = parseDate(fromStr);
  const to = parseDate(toStr);
  // Make `to` inclusive of the whole day
  const toEnd = to ? new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined;

  const rows = await computeKraScores({ from, to: toEnd });

  const exportHref = `/api/admin/kra/export?from=${fromStr}&to=${toStr}`;

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">KRA report</h1>
        <Link href="/admin" className="text-sm text-ink-mute hover:text-ink">
          ← Admin
        </Link>
      </div>

      <form
        method="GET"
        className="rounded-2xl bg-white border border-border shadow-soft p-5 mb-6 flex flex-wrap items-end gap-4"
      >
        <label className="text-sm">
          <span className="block text-ink-mute mb-1">From</span>
          <input
            type="date"
            name="from"
            defaultValue={fromStr}
            className="bg-white border border-border rounded px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="block text-ink-mute mb-1">To</span>
          <input
            type="date"
            name="to"
            defaultValue={toStr}
            className="bg-white border border-border rounded px-3 py-2"
          />
        </label>
        <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white">
          Apply
        </button>
        <a
          href={exportHref}
          className="px-4 py-2 rounded-lg bg-muted hover:bg-border text-sm"
        >
          Download CSV
        </a>
      </form>

      <p className="text-sm text-ink-mute mb-3">
        {rows.length} employees • Deadlines included: those with due dates between{" "}
        {fromStr} and {toStr}
      </p>

      <div className="rounded-2xl bg-white border border-border shadow-soft overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-ink-mute">
            <tr>
              <th className="text-left p-3">#</th>
              <th className="text-left p-3">Employee</th>
              <th className="text-right p-3">Videos</th>
              <th className="text-right p-3">Quiz pts</th>
              <th className="text-right p-3">Deadline pts</th>
              <th className="text-right p-3">Assignment pts</th>
              <th className="text-right p-3">Total</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.userId} className="border-t border-border">
                <td className="p-3 text-ink-mute">{i + 1}</td>
                <td className="p-3">
                  <div>{r.name}</div>
                  <div className="text-xs text-ink-faint">{r.email}</div>
                </td>
                <td className="p-3 text-right">
                  {r.videosCompleted} / {r.videosTotal}
                </td>
                <td className="p-3 text-right">{r.bestQuizPoints}</td>
                <td className="p-3 text-right">{r.deadlinePoints}</td>
                <td className="p-3 text-right font-semibold">{r.totalScore}</td>
                <td className="p-3 text-right">
                  <Link
                    href={`/admin/kra/${r.userId}?from=${fromStr}&to=${toStr}`}
                    className="text-xs px-2 py-1 rounded bg-muted hover:bg-border"
                  >
                    Detail
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
