import Link from "next/link";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { incentiveTrackStatus } from "@/lib/neo-centra/incentive";
import { CheckCircle2, AlertTriangle, TrendingUp, ChevronRight } from "lucide-react";

// Directors-only chip on the main dashboard: are we on the incentive track?
// Renders nothing for non-directors. Click-through goes to the Incentives page.
export async function NeoTrackChip() {
  const session = await auth();
  if (!canUseNeoCentra(session?.user)) return null;
  const track = await incentiveTrackStatus(session!.user.id);

  const styles = {
    on: { ring: "border-emerald-200 bg-emerald-50/60", dot: "text-emerald-600", Icon: CheckCircle2 },
    review: { ring: "border-amber-200 bg-amber-50/60", dot: "text-amber-600", Icon: AlertTriangle },
    none: { ring: "border-border bg-card", dot: "text-brand-600", Icon: TrendingUp },
  }[track.state];

  return (
    <Link
      href="/tools/neo-centra/incentives"
      className={`group flex items-center gap-3 rounded-2xl border ${styles.ring} shadow-lift px-4 py-3 transition hover:-translate-y-0.5`}
    >
      <span className={`w-9 h-9 rounded-[11px] grid place-items-center bg-white/70 ${styles.dot} shrink-0`}>
        <styles.Icon className="w-5 h-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Neo Centra · Incentives</span>
          <span className="text-[10px] font-bold text-ink-faint">· {track.quarter}</span>
        </div>
        <div className="font-display font-bold text-[15px] leading-tight mt-0.5">{track.label}</div>
      </div>
      <span className="text-[12px] font-bold text-ink-mute inline-flex items-center gap-1 shrink-0">
        {track.state === "none" ? "Check" : "View"} <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
      </span>
    </Link>
  );
}
