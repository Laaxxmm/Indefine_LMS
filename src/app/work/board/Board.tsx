"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import { WORK_STATUS_LABELS, WORK_STATUS_ORDER, actionForMove, actionsFor, type WorkAction } from "@/lib/work/core";
import { btnSm, call, errorText, firstName, workActionClass } from "@/components/ui";

export type Card = { id: string; title: string; status: WorkStatus; ownerId: string; owner: string; openTasks: number; days: number; stale: boolean };

// Five columns in status order. Buttons and native HTML5 drag both call the same PATCH.
// Owner or lead may move a card; the server enforces this too.
export function Board({ cards, isLead, meId }: { cards: Card[]; isLead: boolean; meId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<Card | null>(null);
  const canMove = (c: Card) => isLead || c.ownerId === meId;

  async function act(card: Card, action: WorkAction) {
    let reason: string | undefined;
    if (action === "obsolete") {
      const r = window.prompt(`Why is "${card.title}" obsolete?`);
      if (!r?.trim()) return;
      reason = r.trim();
    }
    setError(null);
    const r = await call(`/api/work/${card.id}`, { action, reason }, "PATCH");
    if (!r.ok) setError(r.error);
    else router.refresh();
  }

  function drop(to: WorkStatus) {
    if (!dragging) return;
    const from = dragging;
    setDragging(null);
    const action = actionForMove(from.status, to);
    if (!action) {
      setError(`Cannot move from ${WORK_STATUS_LABELS[from.status]} to ${WORK_STATUS_LABELS[to]}`);
      return;
    }
    void act(from, action);
  }

  return (
    <div>
      {error && <p className={`mb-3 ${errorText}`}>{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {WORK_STATUS_ORDER.map((status) => {
          const inColumn = cards.filter((c) => c.status === status);
          return (
            <div
              key={status}
              onDragOver={(e) => { if (dragging && canMove(dragging)) e.preventDefault(); }}
              onDrop={() => drop(status)}
              className="rounded-2xl bg-muted/40 border border-border p-2.5 min-h-[220px] min-w-[224px] flex-1"
            >
              <p className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2.5 px-0.5">{WORK_STATUS_LABELS[status]} · {inColumn.length}</p>
              <div className="space-y-2">
                {inColumn.map((c) => (
                  <div
                    key={c.id}
                    draggable={canMove(c)}
                    onDragStart={() => setDragging(c)}
                    onDragEnd={() => setDragging(null)}
                    className="rounded-xl bg-card border border-border shadow-lift p-2.5"
                  >
                    <Link href={`/work/${c.id}`} className="font-semibold text-[13.5px] leading-snug hover:text-brand-600 block">{c.title}</Link>
                    <p className="text-[11px] text-ink-mute mt-1 whitespace-nowrap overflow-hidden text-ellipsis">
                      {firstName(c.owner)} · {c.openTasks} open · {c.days === 0 ? "today" : `${c.days}d ago`}
                      {c.stale && <span className="ml-1.5 px-1 py-0.5 rounded bg-amber-100 text-amber-800 font-bold uppercase text-[9.5px]">Stale</span>}
                    </p>
                    {canMove(c) && (
                      <div className="flex flex-nowrap gap-1 mt-2">
                        {actionsFor(c.status).map(([a, label]) => (
                          <button key={a} type="button" onClick={() => act(c, a)} className={`${workActionClass(a)} ${btnSm}`}>{label}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
