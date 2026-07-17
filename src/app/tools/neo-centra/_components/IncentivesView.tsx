"use client";

import { useState } from "react";
import { Loader2, RefreshCw, AlertTriangle, Link2, ChevronDown, ChevronRight, TrendingUp, Receipt, PiggyBank, Wrench, CheckCircle2 } from "lucide-react";
import type { DirectorIncentive, IncentiveSummary } from "@/lib/neo-centra/incentive";

type Snapshot = (IncentiveSummary & { viewer?: { directorId: string | null; isAdmin: boolean } }) | null;

const inr = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};
const fmtWhen = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export function IncentivesView({
  period, snapshot: initial, turia, isAdmin, viewerId,
}: {
  period: { fromMs: number; toMs: number; label: string };
  snapshot: Snapshot;
  turia: { present: boolean; updatedAt: string | null; updatedByName: string | null };
  isAdmin: boolean;
  viewerId: string;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(turia.present);
  const [cookieOpen, setCookieOpen] = useState(!turia.present);
  const [cookie, setCookie] = useState("");
  const [savingCookie, setSavingCookie] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function sync() {
    setSyncing(true); setError(null);
    try {
      const res = await fetch(`/api/tools/neo-centra/incentives?from=${period.fromMs}&to=${period.toMs}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        if (data.turiaExpired) { setConnected(false); setCookieOpen(true); }
        throw new Error(data.error || "Sync failed");
      }
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

  return (
    <div>
      {/* Turia connection */}
      <div className="rounded-2xl bg-card border border-border shadow-lift p-4 mb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-[13px]">
            <Link2 className={`w-4 h-4 ${connected ? "text-emerald-600" : "text-ink-faint"}`} />
            {connected ? (
              <span className="text-ink-soft font-semibold">Turia connected{turia.updatedByName ? ` · cookie by ${turia.updatedByName}` : ""}{turia.updatedAt ? ` · ${fmtWhen(turia.updatedAt)}` : ""}</span>
            ) : (
              <span className="text-ink-mute">Turia not connected — paste a session cookie to pull live data.</span>
            )}
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
            <p className="text-[12px] text-ink-mute mb-2">Open Turia in a browser tab (logged in), copy the <code className="text-ink-soft">Cookie</code> request header, and paste it here. It&apos;s stored once and used to pull data until it expires.</p>
            <textarea value={cookie} onChange={(e) => setCookie(e.target.value)} rows={3} placeholder="userData=…; session=…" className="w-full rounded-lg border border-border bg-page/60 px-3 py-2 text-[12px] font-mono" />
            <button onClick={saveCookie} disabled={savingCookie} className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-ink-faint text-white text-[12px] font-bold transition">
              {savingCookie ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save cookie
            </button>
          </div>
        )}
        {error && <p className="mt-2 text-[12px] text-rose-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {error}</p>}
      </div>

      {!snapshot ? (
        <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
          <TrendingUp className="w-8 h-8 mx-auto text-ink-faint mb-2" />
          <p className="font-semibold">No snapshot for {period.label} yet</p>
          <p className="text-ink-mute text-sm mt-0.5">Connect Turia and hit Sync to compute the four buckets for this quarter.</p>
        </div>
      ) : snapshot.directors.length === 0 ? (
        <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
          <p className="font-semibold">No directors found</p>
          <p className="text-ink-mute text-sm mt-0.5">Directors are Partner-level users. Set the firm&apos;s directors to Partner in Admin → Team.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {snapshot.directors.map((d) => (
            <DirectorCard key={d.directorId} d={d} isSelf={d.directorId === viewerId} canDrill={isAdmin || d.directorId === viewerId} expanded={expanded === d.directorId} onToggle={() => setExpanded((x) => (x === d.directorId ? null : d.directorId))} />
          ))}
        </div>
      )}
    </div>
  );
}

function Bucket({ icon: Icon, label, value, sub, tone }: { icon: typeof TrendingUp; label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="flex-1 min-w-[130px]">
      <div className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wide uppercase text-ink-faint mb-1"><Icon className={`w-3.5 h-3.5 ${tone}`} /> {label}</div>
      <div className="text-lg font-display font-extrabold tracking-tight leading-none">{value}</div>
      <div className="text-[11px] text-ink-mute mt-0.5">{sub}</div>
    </div>
  );
}

function DirectorCard({ d, isSelf, canDrill, expanded, onToggle }: { d: DirectorIncentive; isSelf: boolean; canDrill: boolean; expanded: boolean; onToggle: () => void }) {
  const b = d.buckets;
  const hasDrill = canDrill && (d.leads.length > 0 || d.tasks.length > 0);
  return (
    <div className="rounded-2xl bg-card border border-border shadow-lift overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-display font-bold text-[15px]">{d.name}</span>
          {isSelf && <span className="text-[9.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">You</span>}
          {!d.resolved && <span className="text-[9.5px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700" title="Not matched to a Turia user yet — Sync to resolve">Unresolved</span>}
        </div>
        <div className="flex flex-wrap gap-4">
          <Bucket icon={TrendingUp} tone="text-brand-600" label="1 · Leads" value={inr(b.leadConversion.convertedValue)} sub={`${b.leadConversion.convertedLeads}/${b.leadConversion.originatedLeads} won · ${Math.round(b.leadConversion.conversionRate * 100)}%`} />
          <Bucket icon={Receipt} tone="text-emerald-600" label="2 · Billing" value={inr(b.billing.billedInPeriod)} sub={`${b.billing.taskCount} task${b.billing.taskCount === 1 ? "" : "s"}`} />
          <Bucket icon={PiggyBank} tone="text-sky-600" label="3 · Profit" value={inr(b.profitability.profitInPeriod)} sub={`${b.profitability.taskCount} task${b.profitability.taskCount === 1 ? "" : "s"}`} />
          <Bucket icon={Wrench} tone="text-amber-600" label="4 · Internal" value={`${b.internalImprovement.qualifyingTasks}/${b.internalImprovement.totalContributedTasks}`} sub={`${b.internalImprovement.internalHours}h within budget`} />
        </div>
      </div>
      {hasDrill && (
        <button onClick={onToggle} className="w-full flex items-center justify-center gap-1.5 border-t border-border py-2 text-[12px] font-bold text-ink-mute hover:bg-muted transition">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />} {expanded ? "Hide" : "Show"} detail ({d.leads.length} leads · {d.tasks.length} tasks)
        </button>
      )}
      {expanded && hasDrill && (
        <div className="border-t border-border bg-page/40 p-4 flex flex-col gap-4">
          {d.leads.length > 0 && (
            <div>
              <div className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2">Leads</div>
              <div className="flex flex-col gap-1">
                {d.leads.map((l) => (
                  <div key={l.id} className="flex items-center gap-2 text-[12.5px]">
                    <span className={`w-1.5 h-1.5 rounded-full ${l.converted ? "bg-emerald-500" : "bg-ink-faint"}`} />
                    <span className="text-ink-soft truncate flex-1">{l.name} <span className="text-ink-faint">· {l.stage}</span></span>
                    <span className="text-ink-mute whitespace-nowrap">{inr(l.dealValue)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {d.tasks.length > 0 && (
            <div>
              <div className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2">Tasks</div>
              <div className="flex flex-col gap-1.5">
                {d.tasks.map((t) => (
                  <div key={t.taskId} className="flex items-center gap-2 text-[12.5px]">
                    <span className="text-ink-soft truncate flex-1">{t.identity ? `${t.identity} · ` : ""}{t.name}{t.sharedWith > 1 ? <span className="text-ink-faint"> · shared ×{t.sharedWith}</span> : null}</span>
                    {t.flags.map((f) => <span key={f} className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600">{f}</span>)}
                    <span className="text-emerald-700 font-semibold whitespace-nowrap">{inr(t.billedPeriod)}</span>
                    <span className="text-sky-700 whitespace-nowrap">· {inr(t.profit)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
