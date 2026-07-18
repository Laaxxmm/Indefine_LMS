import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ArrowLeft, Trophy, TrendingUp, Receipt, PiggyBank, Wrench, RefreshCw } from "lucide-react";
import { canUseNeoCentra } from "@/lib/neo-centra/access";

export const dynamic = "force-dynamic";

// A friendly one-pager explaining the four-bucket incentive "race" to the partners.
// Pure static content — no Turia data — so it loads instantly and never breaks on a stale cookie.

const BUCKETS = [
  {
    icon: TrendingUp, emoji: "🎯", color: "#5B4BE6", tint: "#efeafe",
    n: "Bucket 1", title: "New business won",
    what: "The deal value of leads you brought in that actually closed.",
    counts: "Only converted (won) leads count — pipeline that's still “new lead” doesn't. Your figure also shows your share of the firm's total won business this quarter.",
    example: "You originated a lead worth ₹2L and it converted → ₹2L to your Bucket 1. If the firm won ₹10L in total, that's 20% of the firm's new business.",
    source: "Turia · Leads",
  },
  {
    icon: Receipt, emoji: "🧾", color: "#17b978", tint: "#e6f8f0",
    n: "Bucket 2", title: "Billing realized",
    what: "The revenue actually invoiced this quarter on tasks you worked on.",
    counts: "We take each invoice's subtotal and split it equally among the directors assigned to that task. Only invoices dated inside the quarter count.",
    example: "A ₹40,000 invoice on a task with 2 directors → ₹20,000 each in Bucket 2.",
    source: "Turia · Invoices + task team",
  },
  {
    icon: PiggyBank, emoji: "🐷", color: "#3aa0e8", tint: "#e8f4fd",
    n: "Bucket 3", title: "Profit — the finish line",
    what: "Billing minus the manpower cost of doing the work. The firm's real bottom line.",
    counts: "Manpower = each timesheet row's hours × rate on that task. Profit = your billing share − your cost share. This is the number that decides who leads the race.",
    example: "₹40,000 billed − ₹12,000 of logged time = ₹28,000 profit, split across the task's directors.",
    source: "Turia · Invoices − timesheets",
  },
  {
    icon: Wrench, emoji: "🔧", color: "#e8a13a", tint: "#fdf3e3",
    n: "Bucket 4", title: "Internal / firm-building",
    what: "Firm-building tasks tagged with the “Bucket 4” service category in Turia.",
    counts: "Tracks how many are completed (a %) and the hours spent versus the board-approved target. Go over the target and the hours turn red.",
    example: "6 of 8 Bucket-4 tasks done → 75%. Logged 50h against a 40h target → shown in red (over budget).",
    source: "Turia · “Bucket 4” category",
  },
] as const;

// Race-lane runners, furthest-right = leading on profit.
const LANES = [
  { bird: "🔴", pct: 92 },
  { bird: "🟡", pct: 74 },
  { bird: "🐦", pct: 61 },
  { bird: "🟢", pct: 43 },
  { bird: "⚫", pct: 28 },
];

export default async function NeoHowItWorksPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseNeoCentra(session.user)) redirect("/dashboard");

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <Link href="/tools/neo-centra/incentives" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition">
          <ArrowLeft className="w-4 h-4" /> The Race
        </Link>
      </div>

      <div className="mb-6">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Neo Centra · How it works</p>
        <h1 className="font-display font-extrabold text-2xl sm:text-[30px] tracking-[-0.02em] mt-1">The Race, explained 🏁</h1>
        <p className="text-ink-mute text-[14px] mt-1 max-w-2xl">A friendly quarter-long sprint between the partners. Your standing is built from four &ldquo;buckets&rdquo; — every closed lead, every invoice, every hour logged nudges your bird down the track. Here&rsquo;s exactly how each one is counted.</p>
      </div>

      {/* Race-track hero */}
      <div className="rounded-3xl bg-gradient-to-br from-brand-50 to-white border border-border shadow-lift p-5 sm:p-6 mb-6 overflow-hidden">
        <div className="flex items-center gap-2 mb-4">
          <Trophy className="w-4 h-4 text-amber-500" />
          <span className="text-[12px] font-extrabold tracking-[0.1em] uppercase text-ink-mute">Furthest along = most profit</span>
        </div>
        <div className="space-y-2.5">
          {LANES.map((l, i) => (
            <div key={i} className="relative h-9 rounded-full bg-card border border-border overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${l.pct}%`, background: `linear-gradient(90deg, ${BUCKETS[2].tint}, ${BUCKETS[0].tint})` }} />
              <div className="absolute top-1/2 -translate-y-1/2 text-xl transition-all" style={{ left: `calc(${l.pct}% - 14px)` }}>{l.bird}</div>
              <div className="absolute top-1/2 -translate-y-1/2 right-3 text-[14px]">🏁</div>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-ink-faint mt-3">Every partner runs their own lane. The leaderboard sorts by <b className="text-ink-soft">Bucket&nbsp;3 profit</b> — the firm&rsquo;s actual bottom line — so the person turning work into the most real money leads.</p>
      </div>

      {/* Four buckets */}
      <div className="grid gap-4 sm:grid-cols-2 mb-6">
        {BUCKETS.map((b) => (
          <div key={b.n} className="rounded-2xl bg-card border border-border shadow-lift p-5 flex flex-col">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-11 h-11 rounded-2xl grid place-items-center text-2xl shrink-0" style={{ background: b.tint }}>{b.emoji}</div>
              <div className="min-w-0">
                <div className="text-[10.5px] font-extrabold tracking-[0.12em] uppercase" style={{ color: b.color }}>{b.n}</div>
                <div className="font-display font-extrabold text-[17px] tracking-[-0.01em] leading-tight flex items-center gap-1.5">
                  <b.icon className="w-4 h-4 shrink-0" style={{ color: b.color }} /> {b.title}
                </div>
              </div>
            </div>
            <p className="text-[13.5px] text-ink font-semibold mb-2">{b.what}</p>
            <p className="text-[13px] text-ink-mute mb-3 leading-relaxed">{b.counts}</p>
            <div className="mt-auto rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed" style={{ background: b.tint }}>
              <span className="font-bold" style={{ color: b.color }}>For example — </span>
              <span className="text-ink-soft">{b.example}</span>
            </div>
            <div className="text-[10.5px] font-bold tracking-[0.08em] uppercase text-ink-faint mt-3">Source · {b.source}</div>
          </div>
        ))}
      </div>

      {/* How rank is decided + data freshness */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-card border border-border shadow-lift p-5">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <h2 className="font-display font-extrabold text-[15px]">How your position is decided</h2>
          </div>
          <p className="text-[13px] text-ink-mute leading-relaxed">Buckets 1, 2 and 4 are your headline KPIs — new business, billing and firm-building. But the <b className="text-ink-soft">race ranking</b> is decided on <b className="text-ink-soft">Bucket 3 profit</b> alone. We don&rsquo;t add the buckets together (that would double-count the same rupee as a lead, then billing, then profit); profit is the single honest measure of value delivered.</p>
        </div>
        <div className="rounded-2xl bg-card border border-border shadow-lift p-5">
          <div className="flex items-center gap-2 mb-2">
            <RefreshCw className="w-4 h-4 text-brand-600" />
            <h2 className="font-display font-extrabold text-[15px]">Where the numbers come from</h2>
          </div>
          <p className="text-[13px] text-ink-mute leading-relaxed">Everything is pulled straight from <b className="text-ink-soft">Turia</b> — leads, invoices, timesheets and task categories. A small browser extension keeps your logged-in Turia session flowing to Neo Centra, and the figures <b className="text-ink-soft">refresh automatically every 5 minutes</b>. Nothing is typed in by hand, so the leaderboard is always live.</p>
        </div>
      </div>

      <p className="text-[12px] text-ink-faint text-center mt-6">Play fair, log your time, close your leads — the bird does the rest. 🐦💨</p>
    </div>
  );
}
