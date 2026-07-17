import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { fyStartYearFor, TYPE_LABEL } from "@/lib/neo-centra/compliance";
import { getComplianceForFy, summarize } from "@/lib/neo-centra/service";
import { ShieldCheck, ArrowRight, AlertTriangle, CalendarClock, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });

export default async function NeoCentraCockpit() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseNeoCentra(session.user)) redirect("/dashboard");

  const todayIso = new Date().toISOString();
  const fyStart = fyStartYearFor(todayIso.slice(0, 10));
  const list = await getComplianceForFy(fyStart);
  const s = summarize(list, todayIso);
  const today = todayIso.slice(0, 10);
  const nextUp = list.filter((d) => d.status === "PENDING" && d.dueDate >= today).slice(0, 4);

  const name = (session.user.name ?? "Director").split(" ")[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const modules = [
    { title: "Compliance", blurb: "Statutory tax deadlines with filing status.", href: "/tools/neo-centra/compliance", icon: ShieldCheck, accent: "#5B4BE6", live: true },
    { title: "Incentives", blurb: "Four-bucket director incentive breakdown from Turia.", href: "/tools/neo-centra/incentives", icon: Trophy, accent: "#e8a13a", live: true },
  ];

  return (
    <div>
      <div className="mb-7">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Neo Centra · Directors</p>
        <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">{greet}, {name}</h1>
        <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">Your directors&apos; cockpit. Compliance is live; more modules are on the way.</p>
      </div>

      {/* Compliance summary */}
      <Link href="/tools/neo-centra/compliance" className="group block rounded-[22px] bg-card border border-border shadow-lift p-6 mb-6 hover:-translate-y-0.5 transition">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-9 h-9 rounded-[11px] grid place-items-center bg-brand-50 text-brand-600"><ShieldCheck className="w-5 h-5" /></div>
              <h2 className="font-display font-bold text-xl">Compliance</h2>
            </div>
            <p className="text-[13px] text-ink-mute">Statutory tax deadlines · FY {fyStart}-{String(fyStart + 1).slice(2)}</p>
          </div>
          <div className="flex items-center gap-5">
            <Stat value={s.overdue} label="Overdue" tone={s.overdue > 0 ? "text-rose-600" : "text-ink"} />
            <Stat value={s.dueThisMonth} label="This month" tone="text-amber-600" />
            <Stat value={`${s.done}/${s.total}`} label="Filed" tone="text-emerald-600" />
          </div>
        </div>

        {nextUp.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <div className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2.5">Coming up</div>
            <div className="flex flex-col gap-1.5">
              {nextUp.map((d) => {
                const overdue = d.dueDate < today;
                return (
                  <div key={d.key} className="flex items-center gap-2 text-[13px]">
                    {overdue ? <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" /> : <CalendarClock className="w-3.5 h-3.5 text-ink-faint shrink-0" />}
                    <span className="text-ink-soft truncate flex-1">{TYPE_LABEL[d.type]} · {d.period}</span>
                    <span className="text-ink-faint whitespace-nowrap">{fmtDate(d.dueDate)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-brand-600">Open compliance <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" /></div>
      </Link>

      {/* Modules */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((m) => (
          <Link key={m.title} href={m.href} className="group bg-card border border-border rounded-[18px] p-5 shadow-lift hover:-translate-y-0.5 transition block">
            <div className="w-11 h-11 rounded-[13px] grid place-items-center mb-3" style={{ background: `${m.accent}18`, color: m.accent }}><m.icon className="w-5 h-5" /></div>
            <div className="font-display font-bold text-lg leading-tight">{m.title}</div>
            <p className="text-[13px] text-ink-mute leading-relaxed mt-1">{m.blurb}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number | string; label: string; tone: string }) {
  return (
    <div className="text-center">
      <div className={`text-2xl font-display font-extrabold tracking-tight ${tone}`}>{value}</div>
      <div className="text-[10.5px] text-ink-mute font-semibold uppercase tracking-wide">{label}</div>
    </div>
  );
}
