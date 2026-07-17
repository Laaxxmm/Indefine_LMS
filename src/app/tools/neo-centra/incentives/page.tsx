import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { canUseNeoCentra, isNeoCentraAdmin } from "@/lib/neo-centra/access";
import { getSnapshotForPeriod, filterSummaryForViewer } from "@/lib/neo-centra/incentive";
import { turiaStatus } from "@/lib/neo-centra/turia";
import { currentQuarter, quartersForFy, fyLabel, type Period } from "@/lib/neo-centra/period";
import { fyStartYearFor, TYPE_LABEL } from "@/lib/neo-centra/compliance";
import { getComplianceForFy, summarize } from "@/lib/neo-centra/service";
import { IncentivesView } from "../_components/IncentivesView";

export const dynamic = "force-dynamic";

export default async function NeoIncentivesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseNeoCentra(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const now = Date.now();
  const from = Number(sp.from), to = Number(sp.to);
  const period: Period = from > 0 && to > from
    ? (quartersForFy(new Date(from).getUTCMonth() >= 3 ? new Date(from).getUTCFullYear() : new Date(from).getUTCFullYear() - 1).find((q) => q.fromMs === from) ?? currentQuarter(now))
    : currentQuarter(now);
  const quarters = quartersForFy(period.fyStart);

  const raw = await getSnapshotForPeriod(period.fromMs, period.toMs);
  const admin = isNeoCentraAdmin(session.user);
  const snapshot = raw ? filterSummaryForViewer(raw, session.user.id, admin, session.user.name ?? "") : null;
  const turia = await turiaStatus();

  // Compliance action items for the "what needs doing" strip.
  const todayIso = new Date().toISOString();
  const today = todayIso.slice(0, 10);
  const cList = await getComplianceForFy(fyStartYearFor(today));
  const cs = summarize(cList, todayIso);
  const overdue = cList.filter((d) => d.status === "PENDING" && d.dueDate < today).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 6)
    .map((d) => ({ label: `${TYPE_LABEL[d.type]} · ${d.period}`, dueDate: d.dueDate }));
  const dueSoon = cList.filter((d) => d.status === "PENDING" && d.dueDate >= today).slice(0, 6)
    .map((d) => ({ label: `${TYPE_LABEL[d.type]} · ${d.period}`, dueDate: d.dueDate }));

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
        <Link href="/tools/neo-centra/compliance" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition">
          <ShieldCheck className="w-4 h-4" /> Compliance
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Neo Centra · Incentive race</p>
          <h1 className="font-display font-extrabold text-2xl sm:text-[30px] tracking-[-0.02em] mt-1">The Race · {period.label.split(" · ")[0]}</h1>
          <p className="text-ink-mute text-[14px] mt-1">Four-bucket director incentives from Turia · {fyLabel(period.fyStart)}. {admin ? "You see every partner's detail." : "You see your own detail; others show totals."}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          {quarters.map((q) => (
            <Link key={q.key} href={`/tools/neo-centra/incentives?from=${q.fromMs}&to=${q.toMs}`} className={`px-3 py-1.5 rounded-full text-[12px] font-bold transition ${q.fromMs === period.fromMs ? "bg-brand-500 text-white shadow-pop" : "bg-card border border-border text-ink-mute hover:bg-muted"}`}>{q.label.split(" · ")[0]}</Link>
          ))}
        </div>
      </div>

      <IncentivesView
        period={{ fromMs: period.fromMs, toMs: period.toMs, label: period.label }}
        snapshot={snapshot}
        turia={{ present: turia.present, updatedAt: turia.updatedAt?.toISOString() ?? null, updatedByName: turia.updatedByName }}
        isAdmin={admin}
        viewerId={session.user.id}
        viewerName={session.user.name ?? ""}
        compliance={{ overdue: cs.overdue, dueThisMonth: cs.dueThisMonth, filed: cs.done, total: cs.total, overdueList: overdue, dueSoonList: dueSoon }}
      />
    </div>
  );
}
