"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

const PROMPTS = [
  "Lead a major audit engagement",
  "Become the go-to expert in IFRS",
  "Mentor 3 junior associates",
  "Switch into the advisory practice",
  "Build the firm's data analytics capability",
  "Earn a Senior Manager promotion",
];

export default function AspirationForm({
  initial,
  action,
}: {
  initial: string;
  action: (formData: FormData) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  return (
    <form action={action}>
      <textarea
        ref={ref}
        name="aspiration"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="By next year I want to..."
        className="w-full bg-white border border-border shadow-soft rounded-xl p-4 text-base resize-none focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
        autoFocus
      />

      <div className="mt-4">
        <p className="text-xs uppercase tracking-wider font-bold text-ink-faint mb-2">
          Need inspiration?
        </p>
        <div className="flex flex-wrap gap-2">
          {PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setText(p);
                ref.current?.focus();
              }}
              className="text-xs px-3 py-1.5 rounded-full bg-white border border-border hover:border-brand-200 hover:bg-brand-50 transition"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-between mt-8">
        <Link
          href="/wizard/strengths"
          className="px-4 py-2.5 rounded-xl bg-white hover:bg-muted border border-border shadow-soft text-sm font-medium inline-flex items-center gap-2 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <button
          type="submit"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-accent-violet text-white font-semibold shadow-pop hover:opacity-95 transition"
        >
          Continue
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </form>
  );
}
