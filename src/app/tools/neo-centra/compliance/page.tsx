import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { fyStartYearFor } from "@/lib/neo-centra/compliance";
import { getComplianceForFy, summarize } from "@/lib/neo-centra/service";
import { ComplianceList, type Row } from "../_components/ComplianceList";
import { ArrowLeft, AlertTriangle, CalendarClock, CalendarRange, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

const fyLabel = (start: number) => `FY ${start}-${String(start + 1).slice(2)}`;

export default async function NeoCompliancePage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseNeoCentra(session.user)) redirect("/dashboard");

  const todayIso = new Date().toISOString();
  const currentFy = fyStartYearFor(todayIso.slice(0, 10));
  const sp = await searchParams;
  const fyStart = Number.isFinite(Number(sp.fy)) && sp.fy ? Number(sp.fy) : currentFy;

  const list = await getComplianceForFy(fyStart);
  const s = summarize(list, todayIso);
  const rows: Row[] = list.map((d) => ({ key: d.key, type: d.type, title: d.title, description: d.description, dueDate: d.dueDate, period: d.period, status: d.status, completedByName: d.completedByName }));

  const cards = [
    { label: "Overdue", value: s.overdue, icon: AlertTriangle, tone: "text-rose-600", bg: "bg-rose-50" },
    { label: "Due this month", value: s.dueThisMonth, icon: CalendarClock, tone: "text-amber-600", bg: "bg-amber-50" },
    { label: "Next 30 days", value: s.upcoming30, icon: CalendarRange, tone: "text-brand-600", bg: "bg-brand-50" },
    { label: "Filed", value: `${s.done}/${s.total}`, icon: CheckCircle2, tone: "text-emerald-600", bg: "bg-emerald-50" },
  ];

  return (
    <div>
      <Link href="/tools/neo-centra" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> Cockpit
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Neo Centra · Compliance</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-[28px] tracking-[-0.02em] mt-1">Compliance deadlines</h1>
          <p className="text-ink-mute text-[14px] mt-1">Statutory tax deadlines for the firm, {fyLabel(fyStart)}. Mark each one filed as it's completed.</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {[currentFy - 1, currentFy, currentFy + 1].map((y) => (
            <Link key={y} href={`/tools/neo-centra/compliance?fy=${y}`} className={`px-3 py-1.5 rounded-full text-[12px] font-bold transition ${y === fyStart ? "bg-brand-500 text-white shadow-pop" : "bg-card border border-border text-ink-mute hover:bg-muted"}`}>{fyLabel(y)}</Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl bg-card border border-border shadow-lift p-4">
            <div className={`w-9 h-9 rounded-[11px] grid place-items-center mb-2.5 ${c.bg} ${c.tone}`}><c.icon className="w-5 h-5" /></div>
            <div className="text-2xl font-display font-extrabold tracking-tight">{c.value}</div>
            <div className="text-[11.5px] text-ink-mute font-semibold">{c.label}</div>
          </div>
        ))}
      </div>

      <ComplianceList fyStart={fyStart} todayIso={todayIso} items={rows} />
    </div>
  );
}
