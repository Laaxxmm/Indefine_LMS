"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PickGroup } from "@/lib/work/core";
import { btnPrimary, call, card, errorText, h2 } from "@/components/ui";

// Promise up to `remaining` tasks for today. Carried tasks come pre-checked.
export function PickForm({ groups, precheck, remaining }: { groups: PickGroup[]; precheck: string[]; remaining: number }) {
  const router = useRouter();
  const [ids, setIds] = useState<string[]>(precheck.slice(0, remaining));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  async function save() {
    setBusy(true);
    setError(null);
    const r = await call("/api/work/picks", { taskIds: ids });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className={card}>
      {groups.length === 0 && <p className="text-ink-mute text-[13.5px]">No open tasks in this week's plan.</p>}
      {groups.map((g) => (
        <div key={g.workId} className="mb-4 last:mb-0">
          <p className={h2}>{g.workTitle}</p>
          <ul className="space-y-1.5">
            {g.tasks.map((t) => {
              const on = ids.includes(t.id);
              const full = !on && ids.length >= remaining;
              return (
                <li key={t.id}>
                  <label className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${on ? "border-brand-500 bg-brand-50" : "border-border"} ${full ? "opacity-50" : "cursor-pointer"}`}>
                    <input type="checkbox" checked={on} disabled={full || busy} onChange={() => toggle(t.id)} className="w-4 h-4" />
                    <span className="text-[14px] flex-1">{t.title}</span>
                    {precheck.includes(t.id) && <span className="text-[10.5px] uppercase tracking-wide text-amber-700">carried</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="flex items-center gap-3 mt-4">
        <button type="button" onClick={save} disabled={busy || ids.length === 0} className={btnPrimary}>Promise these ({ids.length}/{remaining})</button>
        {error && <span className={errorText}>{error}</span>}
      </div>
    </div>
  );
}
