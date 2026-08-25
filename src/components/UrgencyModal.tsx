"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, X, ArrowRight, Clock } from "lucide-react";

export type UrgentItem = {
  title: string;
  targetVideoId: string | null;
  dueAt: string | null; // ISO string or null
};

// Shown once per day on the dashboard when the learner has unfinished assigned
// courses. Dismissible (non-blocking); "Remind me later" / X snoozes it until
// the next calendar day, tracked in localStorage.
const STORAGE_KEY = "indefine_urgency_dismissed";

function today(): string {
  // Local calendar day "YYYY-MM-DD".
  return new Date().toLocaleDateString("en-CA");
}

function dueLabel(iso: string | null): { text: string; tone: "red" | "amber" | "mute" } {
  if (!iso) return { text: "Assigned — not yet completed", tone: "mute" };
  const due = new Date(iso);
  const days = Math.round((due.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { text: `Overdue by ${-days} day${days === -1 ? "" : "s"}`, tone: "red" };
  if (days === 0) return { text: "Due today", tone: "red" };
  if (days <= 7) return { text: `Due in ${days} day${days === 1 ? "" : "s"}`, tone: "amber" };
  return { text: `Due ${due.toLocaleDateString()}`, tone: "mute" };
}

export function UrgencyModal({ items }: { items: UrgentItem[] }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (items.length === 0) return;
    if (localStorage.getItem(STORAGE_KEY) === today()) return;
    setShow(true);
  }, [items.length]);

  function snooze() {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, today());
    setShow(false);
  }

  if (!show) return null;

  const first = items.find((i) => i.targetVideoId);
  const toneClass = {
    red: "text-rose-600",
    amber: "text-amber-600",
    mute: "text-ink-mute",
  } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(15,23,42,0.62)" }}
        onClick={snooze}
      />
      <div className="relative rounded-2xl bg-white shadow-lift border border-border w-full max-w-md p-6 animate-fade-in">
        <button
          type="button"
          onClick={snooze}
          aria-label="Remind me later"
          className="absolute top-4 right-4 text-ink-faint hover:text-ink"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="w-12 h-12 rounded-[13px] grid place-items-center mb-3.5 bg-rose-50">
          <AlertTriangle className="w-6 h-6 text-rose-600" />
        </div>
        <h3 className="font-display text-xl font-bold mb-1">
          {items.length} course{items.length === 1 ? "" : "s"} still to finish
        </h3>
        <p className="text-sm text-ink-mute leading-relaxed mb-4">
          Please complete your assigned training. Finishing on time keeps your
          learning score up.
        </p>

        <div className="rounded-xl border border-border divide-y divide-border max-h-56 overflow-y-auto mb-5">
          {items.slice(0, 8).map((it, idx) => {
            const d = dueLabel(it.dueAt);
            return (
              <div key={idx} className="px-4 py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{it.title}</p>
                  <p className={`text-xs font-bold flex items-center gap-1 ${toneClass[d.tone]}`}>
                    <Clock className="w-3 h-3" />
                    {d.text}
                  </p>
                </div>
                {it.targetVideoId && (
                  <Link
                    href={`/video/${it.targetVideoId}`}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted font-bold shrink-0"
                    onClick={snooze}
                  >
                    Open
                  </Link>
                )}
              </div>
            );
          })}
          {items.length > 8 && (
            <div className="px-4 py-2 text-xs text-ink-faint font-semibold">
              + {items.length - 8} more
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={snooze}
            className="text-sm text-ink-faint hover:text-ink font-semibold"
          >
            Remind me later
          </button>
          {first?.targetVideoId && (
            <Link
              href={`/video/${first.targetVideoId}`}
              onClick={snooze}
              className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold transition"
            >
              Start now <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
