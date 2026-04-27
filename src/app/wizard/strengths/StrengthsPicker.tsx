"use client";

import { useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { STRENGTHS, STRENGTH_PICK_COUNT } from "@/lib/wizard";

export default function StrengthsPicker({
  initial,
  action,
}: {
  initial: string[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [picked, setPicked] = useState<string[]>(initial);

  const toggle = (id: string) => {
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (p.length >= STRENGTH_PICK_COUNT) return p;
      return [...p, id];
    });
  };

  const remaining = STRENGTH_PICK_COUNT - picked.length;

  return (
    <div>
      <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
        What are your superpowers?
      </h1>
      <p className="text-ink-mute mb-6">
        Tap any {STRENGTH_PICK_COUNT} cards that describe you best. These shape
        the suggestions you&apos;ll see next.
      </p>

      <div className="sticky top-20 z-10 mb-5 bg-white/80 backdrop-blur rounded-xl border border-border shadow-soft px-4 py-3 flex items-center justify-between">
        <p className="text-sm">
          <span className="font-bold tabular-nums">
            {picked.length} / {STRENGTH_PICK_COUNT}
          </span>{" "}
          <span className="text-ink-mute">picked</span>
        </p>
        {remaining > 0 ? (
          <p className="text-xs text-ink-faint">
            Pick {remaining} more to continue
          </p>
        ) : (
          <p className="text-xs text-emerald-600 font-semibold">
            Looking good ✓
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        {STRENGTHS.map((s) => {
          const selected = picked.includes(s.id);
          const disabled = !selected && picked.length >= STRENGTH_PICK_COUNT;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggle(s.id)}
              disabled={disabled}
              className={`relative rounded-2xl border p-4 text-left transition ${
                selected
                  ? "border-brand-500 bg-brand-50 shadow-pop"
                  : disabled
                    ? "border-border bg-muted opacity-50 cursor-not-allowed"
                    : "border-border bg-white shadow-soft hover:border-brand-200 hover:shadow-lift"
              }`}
            >
              {selected && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-brand-500 text-white flex items-center justify-center">
                  <Check className="w-3.5 h-3.5" />
                </div>
              )}
              <div className="text-2xl mb-2">{s.emoji}</div>
              <p className="text-sm font-semibold leading-tight">{s.label}</p>
            </button>
          );
        })}
      </div>

      <form action={action} className="flex justify-end">
        <input type="hidden" name="strengths" value={JSON.stringify(picked)} />
        <button
          type="submit"
          disabled={picked.length < STRENGTH_PICK_COUNT}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-accent-violet text-white font-semibold shadow-pop hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
