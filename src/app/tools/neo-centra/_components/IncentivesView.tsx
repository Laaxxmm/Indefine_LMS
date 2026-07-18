"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, AlertTriangle, Link2, ChevronDown, ChevronRight, TrendingUp, Receipt, PiggyBank, Wrench, CheckCircle2, Flag, CalendarClock, Flame, Trophy } from "lucide-react";
import type { DirectorIncentive, IncentiveSummary, InternalTaskResult, DirectorTaskDrill } from "@/lib/neo-centra/incentive";

type Snapshot = (IncentiveSummary & { viewer?: { directorId: string | null; isAdmin: boolean } }) | null;
type Compliance = { overdue: number; dueThisMonth: number; filed: number; total: number; overdueList: { label: string; dueDate: string }[]; dueSoonList: { label: string; dueDate: string }[] };

const inr = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e7 ? `₹${(n / 1e7).toFixed(2)}Cr` : a >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : `₹${Math.round(n).toLocaleString("en-IN")}`;
  return s;
};
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
// Turia sends the literal string "NULL" for unnamed tasks; treat that (and blanks) as no name.
const cleanName = (s: string) => { const n = (s || "").trim(); return n && n.toUpperCase() !== "NULL" ? n : ""; };

// Angry-Birds-style runners; stable per director by their order in the snapshot.
const BIRDS = ["🔴", "🟡", "🐦", "⚫", "🥚", "🐷", "🟢", "🦅"];
const QUOTES = [
  "Take care of the effort and the score takes care of itself.",
  "Hard work beats talent when talent doesn't work hard.",
  "The bird that gets the worm is the one that shows up early.",
  "Winners focus on winning. The rest focus on the winners.",
  "Small daily wins compound into a runaway lead.",
  "Pressure is a privilege — it only comes to those who earn it.",
  "You miss 100% of the leads you don't chase.",
  "Don't watch the leaderboard. Be the reason others do.",
];

// The race ranks on realized profit — the firm's bottom line, not a mix of
// pipeline (lead value) + revenue + margin, which double-counts.
const score = (d: DirectorIncentive) => d.buckets.profitability.profitInPeriod;

// Bucket 4 fields, coerced — a snapshot cached before the Bucket 4 rewrite lacks
// them, which would render NaN/undefined until the next sync.
function b4of(im: DirectorIncentive["buckets"]["internalImprovement"]) {
  return {
    completionRate: Number(im.completionRate) || 0,
    completedTasks: Number(im.completedTasks) || 0,
    totalTasks: Number(im.totalTasks) || 0,
    hoursSpent: Number(im.hoursSpent) || 0,
    targetHours: Number(im.targetHours) || 0,
    overBudget: !!im.overBudget,
  };
}

const BUCKETS = [
  { color: "#5B4BE6", tint: "#efeafe", icon: TrendingUp, n: "Bucket 1", label: "Leads converted" },
  { color: "#17b978", tint: "#e6f8f0", icon: Receipt, n: "Bucket 2", label: "Billing" },
  { color: "#3aa0e8", tint: "#e8f4fd", icon: PiggyBank, n: "Bucket 3", label: "Profit" },
  { color: "#e8a13a", tint: "#fdf3e3", icon: Wrench, n: "Bucket 4", label: "Internal" },
] as const;

export function IncentivesView({
  period, snapshot: initial, turia, isAdmin, viewerId, viewerName, compliance,
}: {
  period: { fromMs: number; toMs: number; label: string };
  snapshot: Snapshot;
  turia: { present: boolean; updatedAt: string | null; updatedByName: string | null };
  isAdmin: boolean;
  viewerId: string;
  viewerName: string;
  compliance: Compliance;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(turia.present);
  const [cookieOpen, setCookieOpen] = useState(!turia.present);
  const [cookie, setCookie] = useState("");
  const [savingCookie, setSavingCookie] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);

  const birdFor = useMemo(() => {
    const m = new Map<string, string>();
    (snapshot?.directors ?? []).forEach((d, i) => m.set(d.directorId, BIRDS[i % BIRDS.length]));
    return m;
  }, [snapshot]);
  const internalFor = (name: string) => (snapshot?.internalTasks ?? []).filter((t) => t.contributors.some((c) => c.director === name));

  async function sync() {
    setSyncing(true); setError(null);
    try {
      const res = await fetch(`/api/tools/neo-centra/incentives?from=${period.fromMs}&to=${period.toMs}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { if (data.turiaExpired) { setConnected(false); setCookieOpen(true); } throw new Error(data.error || "Sync failed"); }
      setSnapshot(data.snapshot);
    } catch (e) { setError((e as Error).message); } finally { setSyncing(false); }
  }
  async function saveCookie() {
    if (cookie.trim().length < 10) { setError("Paste the full Turia cookie."); return; }
    setSavingCookie(true); setError(null);
    try {
      const res = await fetch("/api/tools/neo-centra/turia-cookie", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cookie: cookie.trim() }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not save cookie");
      setConnected(true); setCookieOpen(false); setCookie("");
    } catch (e) { setError((e as Error).message); } finally { setSavingCookie(false); }
  }

  // Auto-sync every 5 minutes while the tab is visible (skips if a fresh snapshot
  // already exists, so it doesn't re-run right after a manual/other sync).
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      const age = snapshot?.generatedAt ? Date.now() - Date.parse(snapshot.generatedAt) : Infinity;
      if (age > 4.5 * 60 * 1000 && !syncing) void sync();
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, syncing]);

  const ranked = useMemo(() => [...(snapshot?.directors ?? [])].sort((a, b) => score(b) - score(a)), [snapshot]);
  const maxScore = Math.max(1, ...ranked.map(score));
  const me = snapshot?.directors.find((d) => d.directorId === viewerId) ?? null;
  const others = ranked.filter((d) => d.directorId !== viewerId);
  const myRank = ranked.findIndex((d) => d.directorId === viewerId) + 1;
  const maxes = useMemo(() => {
    const ds = snapshot?.directors ?? [];
    return {
      b2: Math.max(1, ...ds.map((d) => d.buckets.billing.billedInPeriod)),
      b3: Math.max(1, ...ds.map((d) => d.buckets.profitability.profitInPeriod)),
    };
  }, [snapshot]);
  // New business = business actually WON (converted leads), not pipeline. Bucket 1
  // is each partner's share of the firm's total converted deal value.
  const totalConverted = useMemo(() => Math.max(1, (snapshot?.directors ?? []).reduce((s, d) => s + d.buckets.leadConversion.convertedValue, 0)), [snapshot]);
  const pctOf = (v: number, total: number) => Math.round((v / total) * 100);

  return (
    <div>
      {/* Turia connection */}
      <div className="rounded-2xl bg-card border border-border shadow-lift p-4 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[13px]">
            <Link2 className={`w-4 h-4 ${connected ? "text-emerald-600" : "text-ink-faint"}`} />
            {connected ? <span className="text-ink-soft font-semibold">Turia connected{turia.updatedByName ? ` · ${turia.updatedByName}` : ""}{turia.updatedAt ? ` · ${fmtWhen(turia.updatedAt)}` : ""}</span> : <span className="text-ink-mute">Turia not connected — paste a session cookie.</span>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCookieOpen((v) => !v)} className="text-[12px] font-bold text-brand-600 hover:text-brand-700">{cookieOpen ? "Cancel" : connected ? "Refresh cookie" : "Connect Turia"}</button>
            <button onClick={sync} disabled={syncing} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-[13px] font-bold transition">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync {period.label.split(" · ")[0]}
            </button>
          </div>
        </div>
        {cookieOpen && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-[12px] text-ink-mute mb-2">Paste your Turia <code className="text-ink-soft">Cookie</code> header (or use the extension). Stored once, used until it expires.</p>
            <textarea value={cookie} onChange={(e) => setCookie(e.target.value)} rows={3} placeholder="userData=…; accessToken=…" className="w-full rounded-lg border border-border bg-page/60 px-3 py-2 text-[12px] font-mono" />
            <button onClick={saveCookie} disabled={savingCookie} className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-ink-faint text-white text-[12px] font-bold transition">
              {savingCookie ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save cookie
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-[12px] text-rose-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {error}</p>}
        <p className="mt-2 text-[11px] text-ink-faint">Auto-syncs every 5 minutes while this tab is open · keep a logged-in Turia tab (or the extension) running so the cookie stays fresh.</p>
      </div>

      {/* Motivating quote */}
      <div className="rounded-2xl bg-gradient-to-r from-brand-500 to-accent-violet text-white shadow-pop px-5 py-3.5 mb-4 flex items-center gap-3">
        <Flame className="w-5 h-5 shrink-0" />
        <p className="font-display font-bold text-[15px] leading-snug">&ldquo;{quote}&rdquo;</p>
      </div>

      {!snapshot ? (
        <EmptyState title={`No snapshot for ${period.label} yet`} sub="Connect Turia and hit Sync to run the race for this quarter." />
      ) : snapshot.directors.length === 0 ? (
        <EmptyState title="No partners found" sub="Directors are Partner-level users. Set the firm's partners in Admin → Team." />
      ) : (
        <>
          {/* The race */}
          <section className="rounded-[22px] bg-card border border-border shadow-lift p-5 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="w-5 h-5 text-amber-500" />
              <h2 className="font-display font-extrabold text-lg">The Race</h2>
              <span className="text-[11px] text-ink-faint font-semibold">· by profit</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {ranked.map((d, i) => {
                const pct = Math.max(3, Math.min(100, (score(d) / maxScore) * 100));
                const leader = i === 0 && score(d) > 0;
                return (
                  <div key={d.directorId} className="flex items-center gap-3">
                    <div className="w-6 text-center text-[13px] font-extrabold text-ink-faint">{i + 1}</div>
                    <div className="w-40 sm:w-52 shrink-0 truncate">
                      <span className={`font-bold text-[13.5px] ${d.directorId === viewerId ? "text-brand-700" : "text-ink"}`}>{d.name}</span>
                      {d.directorId === viewerId && <span className="ml-1 text-[9px] font-extrabold uppercase text-brand-500">you</span>}
                    </div>
                    <div className="relative flex-1 h-7 rounded-full bg-page border border-border overflow-visible">
                      <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-brand-100 to-brand-300 transition-all" style={{ width: `${pct}%` }} />
                      <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-[18px] leading-none transition-all" style={{ left: `${pct}%` }}>{birdFor.get(d.directorId)}</div>
                      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[12px]">🏁</div>
                    </div>
                    <div className="w-20 text-right text-[13px] font-extrabold tabular-nums">{inr(score(d))}</div>
                    {leader && <span className="text-[15px]" title="Leading">👑</span>}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Your scorecard */}
          {me && (() => {
            const b = me.buckets;
            const im4 = b4of(b.internalImprovement);
            const b1pct = pctOf(b.leadConversion.convertedValue, totalConverted);
            const leaderPct = (v: number, max: number) => (v >= max && v > 0 ? { standingPct: 100, standingLabel: "Leading 👑" } : { standingPct: Math.max(0, Math.min(100, Math.round((v / max) * 100))), standingLabel: `${Math.max(0, Math.round((v / max) * 100))}% of leader` });
            const cards = [
              { ...BUCKETS[0], value: inr(b.leadConversion.convertedValue), label: "New business won", sub: `${b.leadConversion.convertedLeads}/${b.leadConversion.originatedLeads} converted · ${Math.round(b.leadConversion.conversionRate * 100)}%`, negative: false, standingPct: b1pct, standingLabel: `${b1pct}% of firm's new business` },
              { ...BUCKETS[1], value: inr(b.billing.billedInPeriod), sub: `${b.billing.taskCount} task${b.billing.taskCount === 1 ? "" : "s"}`, negative: false, ...leaderPct(b.billing.billedInPeriod, maxes.b2) },
              { ...BUCKETS[2], value: inr(b.profitability.profitInPeriod), sub: `${b.profitability.taskCount} task${b.profitability.taskCount === 1 ? "" : "s"}`, negative: b.profitability.profitInPeriod < 0, ...leaderPct(b.profitability.profitInPeriod, maxes.b3) },
              { ...BUCKETS[3], value: `${Math.round(im4.completionRate * 100)}%`, label: "Bucket 4 complete", sub: `${im4.completedTasks}/${im4.totalTasks} tasks done`, negative: false, standingPct: Math.round(im4.completionRate * 100), standingLabel: `${im4.hoursSpent}h${im4.targetHours ? ` / ${im4.targetHours}h target` : " logged"}`, standingRed: im4.overBudget },
            ];
            return (
              <section className="mb-4">
                <div className="flex items-center gap-2.5 mb-3 flex-wrap">
                  <h2 className="font-display font-extrabold text-xl">{me.name}</h2>
                  <span className="text-[10px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">You</span>
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-extrabold px-3 py-1.5 rounded-full bg-ink text-white">
                    {myRank === 1 ? "🥇 Leading the race" : `${myRank === 2 ? "🥈" : myRank === 3 ? "🥉" : "🏁"} Rank #${myRank} of ${ranked.length}`}
                  </span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {cards.map((c) => <Kpi key={c.n} {...c} />)}
                </div>
                {(me.tasks.length > 0 || me.leads.length > 0 || internalFor(me.name).length > 0) && (
                  <div className="mt-3">
                    <button onClick={() => setExpanded((x) => (x === "me" ? null : "me"))} className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-brand-600 hover:text-brand-700">
                      {expanded === "me" ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} {expanded === "me" ? "Hide" : "See"} my tasks &amp; leads
                    </button>
                    {expanded === "me" && (
                      <div className="mt-2 rounded-2xl bg-card border border-border shadow-lift p-4">
                        <Drill d={me} it={internalFor(me.name)} isAdmin={isAdmin} />
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })()}

          {/* Action needed */}
          <ActionStrip me={me} compliance={compliance} />

          {/* Other partners table */}
          {others.length > 0 && (
            <section className="rounded-2xl bg-card border border-border shadow-lift overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border bg-muted/40">
                <h2 className="font-display font-bold text-sm">Other partners</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-ink-faint border-b border-border">
                      <th className="font-bold px-4 py-3">Partner</th>
                      <th className="font-bold px-3 py-3 text-right">Bucket 1 · New business</th>
                      <th className="font-bold px-3 py-3 text-right">Bucket 2 · Billing</th>
                      <th className="font-bold px-3 py-3 text-right">Bucket 3 · Profit</th>
                      <th className="font-bold px-3 py-3 text-right">Bucket 4 · Complete</th>
                      <th className="px-2 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {others.map((d) => {
                      const it = internalFor(d.name);
                      const canDrill = isAdmin && (d.leads.length > 0 || d.tasks.length > 0 || it.length > 0);
                      const open = expanded === d.directorId;
                      return (
                        <FragmentRow key={d.directorId} d={d} it={it} totalConverted={totalConverted} canDrill={canDrill} isAdmin={isAdmin} open={open} onToggle={() => setExpanded((x) => (x === d.directorId ? null : d.directorId))} />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, color, tint, n, label, value, sub, negative, standingPct, standingLabel, standingRed }: { icon: typeof TrendingUp; color: string; tint: string; n: string; label: string; value: string; sub: string; negative: boolean; standingPct: number; standingLabel: string; standingRed?: boolean }) {
  const pct = Math.max(0, Math.min(100, standingPct));
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border shadow-lift p-4" style={{ background: `linear-gradient(155deg, ${tint} 0%, #ffffff 60%)` }}>
      <div className="absolute top-0 left-0 right-0 h-1" style={{ background: color }} />
      <div className="flex items-center justify-between mb-3 mt-1">
        <span className="w-10 h-10 rounded-[13px] grid place-items-center text-white" style={{ background: color, boxShadow: `0 6px 16px -6px ${color}` }}><Icon className="w-5 h-5" /></span>
        <span className="text-[10px] font-extrabold tracking-wider uppercase" style={{ color }}>{n}</span>
      </div>
      <div className="text-[26px] font-display font-extrabold tracking-tight leading-none" style={{ color: negative ? "#e11d48" : "#1c1c28" }}>{value}</div>
      <div className="text-[12px] font-bold text-ink-soft mt-1">{label}</div>
      <div className="text-[11px] text-ink-mute mt-0.5">{sub}</div>
      <div className="mt-3">
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `${color}22` }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
        </div>
        <div className="text-[10px] font-bold mt-1" style={{ color: standingRed ? "#e11d48" : color }}>{standingRed ? `⚠ ${standingLabel} — over target` : standingLabel}</div>
      </div>
    </div>
  );
}

function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
      <Trophy className="w-8 h-8 mx-auto text-ink-faint mb-2" />
      <p className="font-semibold">{title}</p>
      <p className="text-ink-mute text-sm mt-0.5">{sub}</p>
    </div>
  );
}

function ActionStrip({ me, compliance }: { me: DirectorIncentive | null; compliance: Compliance }) {
  const [dlOpen, setDlOpen] = useState(false);
  const lossMaking = (me?.tasks ?? []).filter((t) => t.flags.includes("over-budget"));
  const fastAction = (me?.tasks ?? []).filter((t) => t.flags.includes("overdue") || t.flags.includes("long-pending"));

  return (
    <div className="grid md:grid-cols-3 gap-3 mb-4">
      {/* Deadlines — list hidden until the card is clicked */}
      <div className="rounded-2xl bg-card border border-border shadow-lift p-4">
        <button onClick={() => setDlOpen((v) => !v)} className="w-full text-left">
          <div className="flex items-center justify-between mb-2.5">
            <span className="flex items-center gap-1.5 text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase"><CalendarClock className="w-3.5 h-3.5" /> Deadlines</span>
            {dlOpen ? <ChevronDown className="w-4 h-4 text-ink-faint" /> : <ChevronRight className="w-4 h-4 text-ink-faint" />}
          </div>
          <div className="flex items-center gap-4">
            <Mini value={compliance.overdue} label="Overdue" tone={compliance.overdue > 0 ? "text-rose-600" : "text-ink"} />
            <Mini value={compliance.dueThisMonth} label="This month" tone="text-amber-600" />
            <Mini value={`${compliance.filed}/${compliance.total}`} label="Filed" tone="text-emerald-600" />
          </div>
        </button>
        {dlOpen && (
          <ul className="flex flex-col gap-1 mt-3 border-t border-border pt-3">
            {compliance.overdueList.map((d) => (
              <li key={d.label} className="flex items-center gap-1.5 text-[11.5px]"><AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" /><span className="text-rose-700 truncate flex-1">{d.label}</span><span className="text-ink-faint">{fmtDate(d.dueDate)}</span></li>
            ))}
            {compliance.dueSoonList.slice(0, compliance.overdueList.length ? 3 : 6).map((d) => (
              <li key={d.label} className="flex items-center gap-1.5 text-[11.5px]"><CalendarClock className="w-3 h-3 text-ink-faint shrink-0" /><span className="text-ink-soft truncate flex-1">{d.label}</span><span className="text-ink-faint">{fmtDate(d.dueDate)}</span></li>
            ))}
          </ul>
        )}
      </div>

      {/* Loss-making — show task name, not id */}
      <div className="rounded-2xl bg-card border border-border shadow-lift p-4">
        <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2.5"><PiggyBank className="w-3.5 h-3.5" /> Loss-making tasks</div>
        <div className="text-2xl font-display font-extrabold text-rose-600 leading-none mb-2">{lossMaking.length}</div>
        <ul className="flex flex-col gap-1">
          {lossMaking.slice(0, 4).map((t) => (
            <li key={t.taskId} className="flex items-center gap-1.5 text-[11.5px]"><span className="text-ink-soft truncate flex-1">{t.name || t.identity}</span><span className="text-rose-600 font-semibold whitespace-nowrap">{inr(t.profit)}</span></li>
          ))}
          {lossMaking.length === 0 && <li className="text-[11.5px] text-ink-faint">None — every task is in the black. 🎉</li>}
        </ul>
      </div>

      {/* Fast action — show task name, not id */}
      <div className="rounded-2xl bg-card border border-border shadow-lift p-4">
        <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2.5"><Flag className="w-3.5 h-3.5" /> Fast action needed</div>
        <div className="text-2xl font-display font-extrabold text-amber-600 leading-none mb-2">{fastAction.length}</div>
        <ul className="flex flex-col gap-1">
          {fastAction.slice(0, 4).map((t) => (
            <li key={t.taskId} className="flex items-center gap-1.5 text-[11.5px]"><span className="text-ink-soft truncate flex-1">{t.name || t.identity}</span>{t.flags.map((f) => <span key={f} className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-amber-50 text-amber-700">{f === "long-pending" ? "stale" : f}</span>)}</li>
          ))}
          {fastAction.length === 0 && <li className="text-[11.5px] text-ink-faint">Nothing overdue or stale. 👏</li>}
        </ul>
      </div>
    </div>
  );
}

function Mini({ value, label, tone }: { value: number | string; label: string; tone: string }) {
  return <div><div className={`text-lg font-display font-extrabold leading-none ${tone}`}>{value}</div><div className="text-[9.5px] font-semibold uppercase tracking-wide text-ink-mute mt-0.5">{label}</div></div>;
}

function FragmentRow({ d, it, totalConverted, canDrill, isAdmin, open, onToggle }: { d: DirectorIncentive; it: InternalTaskResult[]; totalConverted: number; canDrill: boolean; isAdmin: boolean; open: boolean; onToggle: () => void }) {
  const b = d.buckets;
  const im4 = b4of(b.internalImprovement);
  const b1pct = Math.round((b.leadConversion.convertedValue / totalConverted) * 100);
  return (
    <>
      <tr className={`border-b border-border/60 ${canDrill ? "cursor-pointer hover:bg-muted/40" : ""} transition`} onClick={canDrill ? onToggle : undefined}>
        <td className="px-4 py-3 font-bold text-ink">{d.name}</td>
        <td className="px-3 py-3 text-right"><div className="font-semibold">{inr(b.leadConversion.convertedValue)}</div><div className="text-[10.5px] text-ink-faint">{b1pct}% of business · {b.leadConversion.convertedLeads} won</div></td>
        <td className="px-3 py-3 text-right"><div className="font-semibold">{inr(b.billing.billedInPeriod)}</div><div className="text-[10.5px] text-ink-faint">{b.billing.taskCount} tasks</div></td>
        <td className="px-3 py-3 text-right"><div className={`font-semibold ${b.profitability.profitInPeriod < 0 ? "text-rose-600" : ""}`}>{inr(b.profitability.profitInPeriod)}</div><div className="text-[10.5px] text-ink-faint">{b.profitability.taskCount} tasks</div></td>
        <td className="px-3 py-3 text-right"><div className="font-semibold">{Math.round(im4.completionRate * 100)}%</div><div className={`text-[10.5px] ${im4.overBudget ? "text-rose-600 font-semibold" : "text-ink-faint"}`}>{im4.completedTasks}/{im4.totalTasks} · {im4.hoursSpent}h{im4.targetHours ? `/${im4.targetHours}h` : ""}</div></td>
        <td className="px-2 py-3 text-ink-faint">{canDrill ? (open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : null}</td>
      </tr>
      {open && canDrill && (
        <tr><td colSpan={6} className="bg-page/40 px-4 py-3"><Drill d={d} it={it} isAdmin={isAdmin} /></td></tr>
      )}
    </>
  );
}

function Drill({ d, it, isAdmin }: { d: DirectorIncentive; it: InternalTaskResult[]; isAdmin: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {d.tasks.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] font-extrabold tracking-[0.12em] text-emerald-600 uppercase">Buckets 2 &amp; 3 · Client tasks</span>
            <span className="text-[9px] font-bold uppercase tracking-wide text-ink-faint">Billed · Profit</span>
          </div>
          <div className="flex flex-col">
            {d.tasks.map((t) => (
              <div key={t.taskId} className="py-1.5 border-b border-border/40 last:border-0">
                <div className="flex items-start gap-2.5 text-[12px]">
                  <span className="font-mono text-[10px] text-ink-faint pt-[3px] shrink-0 w-[76px] truncate" title={t.identity}>{t.identity || "—"}</span>
                  <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap pt-[1px]">
                    <span className="text-ink-soft font-medium truncate">{cleanName(t.name) || "Untitled task"}</span>
                    {t.sharedWith > 1 && <span className="text-[9px] font-bold text-ink-faint">×{t.sharedWith}</span>}
                    {t.flags.map((f) => <span key={f} className="text-[8.5px] font-bold uppercase px-1 py-0.5 rounded bg-rose-50 text-rose-600">{f}</span>)}
                  </div>
                  <div className="shrink-0 text-right tabular-nums leading-tight">
                    <div className="text-emerald-700 font-semibold">{inr(t.billedPeriod)}</div>
                    <div className={`text-[11px] ${t.profit < 0 ? "text-rose-600" : "text-sky-700"}`}>{inr(t.profit)}</div>
                  </div>
                </div>
                {t.profitPartners && t.profitPartners.length > 1 && <ProfitSplitEditor task={t} isAdmin={isAdmin} />}
              </div>
            ))}
          </div>
        </div>
      )}
      {it.length > 0 && (
        <div>
          <div className="text-[10px] font-extrabold tracking-[0.12em] text-amber-600 uppercase mb-1.5">Bucket 4 · Internal tasks</div>
          {it.map((t) => { const mine = t.contributors.find((c) => c.director === d.name)?.hours ?? 0; const over = t.withinApproved === false; return (
            <div key={t.taskId} className="flex items-center gap-2 text-[12px] py-1 border-b border-border/40 last:border-0">
              <span className="font-mono text-[10px] text-ink-faint shrink-0 w-[76px] truncate" title={t.identity}>{t.identity || "—"}</span>
              <span className="text-ink-soft truncate flex-1">{cleanName(t.name) || "Untitled task"}</span>
              <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded ${t.completed ? "bg-emerald-50 text-emerald-700" : "bg-muted text-ink-faint"}`}>{t.completed ? "done" : "wip"}</span>
              <span className={over ? "text-rose-600 font-semibold" : "text-ink-mute"}>{Number(t.actualHours) || 0}h{t.approvedHours != null ? ` / ${t.approvedHours}h` : ""}</span>
              {over ? <span className="text-[9px] font-bold uppercase px-1 py-0.5 rounded bg-rose-50 text-rose-600">over</span> : null}
            </div>
          ); })}
        </div>
      )}
      {d.leads.length > 0 && (
        <div>
          <div className="text-[10px] font-extrabold tracking-[0.12em] text-brand-600 uppercase mb-1.5">Bucket 1 · Leads (new business)</div>
          {d.leads.map((l) => (
            <div key={l.id} className="flex items-center gap-2 text-[12px] py-0.5"><span className={`w-1.5 h-1.5 rounded-full ${l.converted ? "bg-emerald-500" : "bg-ink-faint"}`} /><span className="text-ink-soft truncate flex-1">{l.name} · {l.stage}{l.converted ? " · won" : ""}</span><span className="text-ink-mute">{inr(l.dealValue)}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

// Bucket 3 profit split for a task shared by 2+ partners. Admins edit the %; everyone
// else sees it read-only. Saved splits apply on the next Sync.
function ProfitSplitEditor({ task, isAdmin }: { task: DirectorTaskDrill; isAdmin: boolean }) {
  const partners = task.profitPartners ?? [];
  const [pct, setPct] = useState<Record<string, number>>(() => Object.fromEntries(partners.map((p) => [p.directorId, p.percent])));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const sum = partners.reduce((s, p) => s + (Number(pct[p.directorId]) || 0), 0);
  const balanced = sum >= 99 && sum <= 101;

  if (!isAdmin) {
    return (
      <div className="ml-[86px] mt-1 inline-flex items-center gap-1.5 text-[10.5px] rounded-md bg-amber-50/70 border border-amber-100 px-2 py-1">
        <span className="text-[8.5px] font-extrabold uppercase tracking-wide text-amber-600">Profit split</span>
        {partners.map((p) => <span key={p.directorId} className="text-ink-soft">{p.name.split(" ")[0]} <b className="tabular-nums">{p.percent}%</b></span>)}
      </div>
    );
  }
  async function save() {
    setSaving(true); setMsg(null);
    try {
      const res = await fetch("/api/tools/neo-centra/profit-splits", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskName: task.name, taskIdentity: task.identity, turiaTaskId: task.taskId, splits: pct }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Save failed");
      setMsg("Saved · hit Sync to apply");
    } catch (e) { setMsg((e as Error).message); } finally { setSaving(false); }
  }
  return (
    <div className="ml-[86px] mt-1.5 rounded-lg bg-amber-50/60 border border-amber-100 px-2.5 py-2 flex items-center flex-wrap gap-x-3 gap-y-1.5 text-[11px]">
      <span className="text-[8.5px] font-extrabold uppercase tracking-wide text-amber-600">Profit split</span>
      {partners.map((p) => (
        <label key={p.directorId} className="inline-flex items-center gap-1.5 text-ink-soft">
          <span className="truncate max-w-[90px]">{p.name.split(" ")[0]}</span>
          <span className="inline-flex items-center rounded border border-amber-200 bg-card overflow-hidden">
            <input type="number" min={0} max={100} value={pct[p.directorId] ?? 0}
              onChange={(e) => setPct((s) => ({ ...s, [p.directorId]: Math.max(0, Math.min(100, Number(e.target.value))) }))}
              className="w-11 bg-transparent px-1.5 py-0.5 text-[11px] tabular-nums text-right focus:outline-none" />
            <span className="px-1 text-ink-faint bg-amber-50/80 border-l border-amber-200">%</span>
          </span>
        </label>
      ))}
      <span className={`tabular-nums font-bold ${balanced ? "text-emerald-600" : "text-rose-600"}`}>= {Math.round(sum)}%</span>
      <button onClick={save} disabled={saving || !balanced} className="px-3 py-1 rounded-md bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-[11px] font-bold transition">{saving ? "Saving…" : "Save"}</button>
      {msg && <span className={`text-[10.5px] ${msg.startsWith("Saved") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</span>}
    </div>
  );
}
