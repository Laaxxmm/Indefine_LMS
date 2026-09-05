"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WorkStatus } from "@prisma/client";
import { WORK_STATUS_LABELS, WORK_STATUS_ORDER, actionForMove, actionsFor, type WorkAction } from "@/lib/work/core";
import { call, errorText, firstName } from "@/components/ui";

export type Card = { id: string; title: string; status: WorkStatus; ownerId: string; owner: string; openTasks: number; days: number; stale: boolean };

// Text colour per verb; the buttons share one segmented strip at the foot of the card so
// they always sit in a single row whatever the column width.
const TONE: Record<WorkAction, string> = {
  activate: "text-brand-600 hover:bg-brand-50",
  finish: "text-emerald-700 hover:bg-emerald-50",
  pause: "text-amber-700 hover:bg-amber-50",
  obsolete: "text-rose-600 hover:bg-rose-50",
  reopen: "text-ink-mute hover:bg-muted",
};

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
      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {WORK_STATUS_ORDER.map((status) => {
          const inColumn = cards.filter((c) => c.status === status);
          return (
            <section
              key={status}
              onDragOver={(e) => { if (dragging && canMove(dragging)) e.preventDefault(); }}
              onDrop={() => drop(status)}
              className="rounded-[18px] bg-muted/50 border border-border/70 p-2.5 min-h-[260px]"
            >
              <div className="flex items-center justify-between px-1.5 pt-1 pb-2.5">
                <span className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-mute uppercase">{WORK_STATUS_LABELS[status]}</span>
                <span className="text-[10.5px] font-extrabold text-ink-faint tabular-nums">{inColumn.length}</span>
              </div>
              {inColumn.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border h-[72px] flex items-center justify-center text-[12px] text-ink-faint">Nothing here</div>
              ) : (
                <div className="space-y-2.5">
                  {inColumn.map((c) => {
                    const actions = canMove(c) ? actionsFor(c.status) : [];
                    return (
                      <article
                        key={c.id}
                        draggable={canMove(c)}
                        onDragStart={() => setDragging(c)}
                        onDragEnd={() => setDragging(null)}
                        className="rounded-[14px] bg-card border border-border shadow-soft hover:shadow-lift transition"
                      >
                        <div className="px-3.5 pt-3 pb-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <Link href={`/work/${c.id}`} className="font-semibold text-[14px] leading-[1.3] text-ink hover:text-brand-600">{c.title}</Link>
                            {c.stale && <span className="shrink-0 mt-[2px] px-1.5 py-[1px] rounded-md bg-amber-100 text-amber-800 font-bold uppercase text-[9.5px] tracking-wide">Stale</span>}
                          </div>
                          <p className="text-[12px] text-ink-mute mt-1.5 whitespace-nowrap overflow-hidden text-ellipsis">
                            {firstName(c.owner)}
                            <span className="text-ink-faint mx-1.5">·</span>
                            <span className="font-semibold text-ink-soft">{c.openTasks} open</span>
                            <span className="text-ink-faint mx-1.5">·</span>
                            {c.days === 0 ? "today" : `${c.days}d ago`}
                          </p>
                        </div>
                        {actions.length > 0 && (
                          <div
                            className="grid gap-px bg-border border-t border-border rounded-b-[14px] overflow-hidden"
                            style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}
                          >
                            {actions.map(([a, label]) => (
                              <button key={a} type="button" onClick={() => act(c, a)} className={`bg-card h-8 text-[12px] font-bold transition ${TONE[a]}`}>{label}</button>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
