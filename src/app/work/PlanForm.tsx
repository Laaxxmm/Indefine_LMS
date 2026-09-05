"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import { WORK_STATUS_LABELS } from "@/lib/work/core";
import { btnPrimary, call, card, errorText } from "@/components/ui";

export type PlanWork = { id: string; title: string; status: WorkStatus; owner: string };

// Choose up to `cap` works for the current week. PUT replaces the whole plan.
export function PlanForm({ works, selected, cap }: { works: PlanWork[]; selected: string[]; cap: number }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>(selected);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function save() {
    setBusy(true);
    setError(null);
    const r = await call("/api/work/week", { workIds: ids }, "PUT");
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className={card}>
      {works.length === 0 ? (
        <p className="text-ink-mute text-[13.5px]">Nothing to plan yet. Only Working items can be planned; they are started from the board.</p>
      ) : (
        <ul className="space-y-2">
          {works.map((w) => {
            const on = ids.includes(w.id);
            const full = !on && ids.length >= cap;
            return (
              <li key={w.id}>
                <label className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${on ? "border-brand-500 bg-brand-50" : "border-border"} ${full ? "opacity-50" : "cursor-pointer"}`}>
                  <input type="checkbox" checked={on} disabled={full || busy} onChange={() => toggle(w.id)} className="w-4 h-4" />
                  <span className="font-semibold text-[14px] flex-1">{w.title}</span>
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">{WORK_STATUS_LABELS[w.status]} · {w.owner}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-3 mt-4">
        <button type="button" onClick={save} disabled={busy || ids.length === 0} className={btnPrimary}>Save plan ({ids.length}/{cap})</button>
        {error && <span className={errorText}>{error}</span>}
      </div>
    </div>
  );
}
