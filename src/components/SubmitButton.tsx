"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Check } from "lucide-react";

// Drop-in submit button that gives real feedback for server-action forms:
//   idle → shows its label
//   submitting → "Saving…" + spinner, disabled (prevents double-submit)
//   just finished → "Saved ✓" for a couple of seconds
//
// Works with any <form action={serverAction}> with no changes to the action,
// because useFormStatus() tracks the enclosing form's submission lifecycle.
// Must be rendered INSIDE the <form>.
export function SubmitButton({
  children,
  className,
  savingLabel = "Saving…",
  savedLabel = "Saved",
}: {
  children: React.ReactNode;
  className?: string;
  savingLabel?: string;
  savedLabel?: string;
}) {
  const { pending } = useFormStatus();
  const [justSaved, setJustSaved] = useState(false);
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      setJustSaved(true);
      const t = setTimeout(() => setJustSaved(false), 2200);
      wasPending.current = pending;
      return () => clearTimeout(t);
    }
    wasPending.current = pending;
  }, [pending]);

  return (
    <button
      type="submit"
      disabled={pending}
      aria-live="polite"
      className={`inline-flex items-center justify-center gap-2 transition disabled:opacity-70 disabled:cursor-not-allowed ${
        justSaved ? "!bg-emerald-500 !border-emerald-500 !text-white" : ""
      } ${className ?? ""}`}
    >
      {pending ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          {savingLabel}
        </>
      ) : justSaved ? (
        <>
          <Check className="w-4 h-4" />
          {savedLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
