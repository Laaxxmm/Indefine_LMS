"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import { WORK_STATUS_LABELS } from "@/lib/work/core";
import { PlanForm, type PlanWork } from "../PlanForm";
import { btnDanger, btnGhost, btnPrimary, btnWarn, call, card, errorText, field, h2, type CallResult } from "@/components/ui";

export type Column = {
  user: { id: string; name: string };
  mine: boolean;
  plan: { id: string; title: string; status: WorkStatus }[];
  candidates: PlanWork[] | null; // only for my own column in the current week
  kept: number | null;
  shippedWeek: number;
  shippedMonth: number;
  stale: { id: string; title: string; days: number }[];
  reviewed: boolean;
};

export function WeekPanels({ columns, isCurrent, cap }: { columns: Column[]; isCurrent: boolean; cap: number }) {
  return (
    <div className={`grid grid-cols-1 ${columns.length > 1 ? "md:grid-cols-2" : ""} gap-4`}>
      {columns.map((c) => <PersonColumn key={c.user.id} c={c} isCurrent={isCurrent} cap={cap} />)}
    </div>
  );
}

// One person's plan and review. Decisions on stale work are only offered in the
// owner's own column, in the current week. "Review done" unlocks once nothing is stale.
function PersonColumn({ c, isCurrent, cap }: { c: Column; isCurrent: boolean; cap: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [continueId, setContinueId] = useState<string | null>(null);
  const [next, setNext] = useState("");

  async function run(fn: () => Promise<CallResult>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) setError(r.error);
    else router.refresh();
    return r.ok;
  }
  const pause = (id: string) => run(() => call(`/api/work/${id}`, { action: "pause" }, "PATCH"));
  async function obsolete(id: string, title: string) {
    const reason = window.prompt(`Why is "${title}" obsolete?`);
    if (!reason?.trim()) return;
    await run(() => call(`/api/work/${id}`, { action: "obsolete", reason: reason.trim() }, "PATCH"));
  }
  async function continueWork(id: string) {
    if (!next.trim()) return;
    const ok = await run(() => call(`/api/work/${id}/tasks`, { title: next, assigneeId: c.user.id }));
    if (ok) {
      setNext("");
      setContinueId(null);
    }
  }
  const reviewDone = () => run(() => call("/api/work/review"));

  const canDecide = c.mine && isCurrent;

  return (
    <div className="space-y-4">
      <div className={card}>
        <p className={h2}>{c.user.name} · plan</p>
        {c.candidates ? (
          (() => {
            const visible = new Set((c.candidates ?? []).map((w) => w.id));
            const selected = c.plan.map((p) => p.id).filter((id) => visible.has(id));
            return <PlanForm key={selected.join(",")} works={c.candidates} selected={selected} cap={cap} />;
          })()
        ) : c.plan.length === 0 ? (
          <p className="text-ink-mute text-[13px]">No plan.</p>
        ) : (
          <ul className="space-y-1.5">
            {c.plan.map((p) => (
              <li key={p.id} className="text-[14px]">
                <Link href={`/work/${p.id}`} className="font-semibold hover:text-brand-600">{p.title}</Link>
                <span className="text-[11px] uppercase text-ink-faint ml-2">{WORK_STATUS_LABELS[p.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={card}>
        <p className={h2}>{c.user.name} · review</p>
        {isCurrent && (
          <p className="text-[12.5px] text-ink-mute mb-3">
            Friday: read the three numbers, decide on every stale work below, then press <strong className="text-ink">Review done</strong>.
            Nothing stale means nothing to decide; press it anyway so the week counts as reviewed.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <Stat label="Kept promises" value={c.kept === null ? "—" : `${c.kept}%`} />
          <Stat label="Shipped this week" value={String(c.shippedWeek)} />
          <Stat label="Shipped this month" value={String(c.shippedMonth)} />
        </div>
        {isCurrent && (
          <div>
            <p className="text-[12px] font-bold text-ink-mute mb-2">Stale ({c.stale.length})</p>
            {c.stale.length === 0 ? (
              <p className="text-ink-mute text-[13px]">Nothing stale.</p>
            ) : (
              <ul className="space-y-2">
                {c.stale.map((s) => (
                  <li key={s.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-[14px] font-semibold">
                      <Link href={`/work/${s.id}`} className="hover:text-brand-600">{s.title}</Link>
                      <span className="text-[11px] text-amber-800 ml-2">{s.days}d untouched</span>
                    </p>
                    {canDecide && (
                      <div className="mt-2">
                        {continueId === s.id ? (
                          <div className="flex gap-2">
                            <input value={next} onChange={(e) => setNext(e.target.value)} maxLength={160} placeholder="Next task" aria-label="Next task" className={field} autoFocus />
                            <button type="button" disabled={busy || !next.trim()} onClick={() => continueWork(s.id)} className={btnPrimary}>Add</button>
                            <button type="button" onClick={() => setContinueId(null)} className={btnGhost}>Cancel</button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            <button type="button" disabled={busy} onClick={() => { setNext(""); setContinueId(s.id); }} className={btnPrimary}>Continue</button>
                            <button type="button" disabled={busy} onClick={() => pause(s.id)} className={btnWarn}>Pause</button>
                            <button type="button" disabled={busy} onClick={() => obsolete(s.id, s.title)} className={btnDanger}>Obsolete</button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canDecide ? (
              <div className="mt-4 flex items-center gap-3">
                {c.reviewed ? (
                  <span className="text-[12.5px] font-bold text-emerald-700">Review done</span>
                ) : (
                  <button type="button" disabled={busy || c.stale.length > 0} onClick={reviewDone} className={btnPrimary}>Review done</button>
                )}
                {c.stale.length > 0 && !c.reviewed && <span className="text-[12px] text-ink-mute">Decide on every stale work first.</span>}
              </div>
            ) : (
              c.reviewed && <p className="mt-3 text-[12.5px] font-bold text-emerald-700">Review done</p>
            )}
          </div>
        )}
        {error && <p className={`mt-3 ${errorText}`}>{error}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 border border-border px-3 py-2.5">
      <p className="text-[10.5px] uppercase tracking-wide text-ink-faint font-bold">{label}</p>
      <p className="font-display font-extrabold text-2xl mt-0.5">{value}</p>
    </div>
  );
}
