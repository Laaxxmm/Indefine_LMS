"use client";

// The confirm step for anything that cannot be undone from the screen: the first click shows what
// confirming does, with Cancel beside the confirm button; the second click sends it (busy while it
// runs). ConfirmPanel is the group on its own, for screens that keep the state themselves (two
// decisions on one row, a step chosen from a form); ConfirmStep is trigger + panel in one.
import { useId, useState } from "react";
import { errorText } from "@/components/ui";
import { Button, type ButtonVariant } from "./Button";
import { userMessage } from "@/lib/errors";

export function ConfirmPanel({
  label,
  consequence,
  confirmLabel,
  confirmVariant = "primary",
  busy = false,
  busyLabel = "Saving…",
  disabled = false,
  align = "end",
  size = "md",
  onCancel,
  onConfirm,
  children,
}: {
  /** What is being confirmed, for the group's accessible name ("Confirm: Approve rule …"). */
  label: string;
  consequence: React.ReactNode;
  confirmLabel: React.ReactNode;
  confirmVariant?: ButtonVariant;
  busy?: boolean;
  busyLabel?: React.ReactNode;
  disabled?: boolean;
  align?: "start" | "end";
  size?: "md" | "sm";
  onCancel: () => void;
  onConfirm: () => void;
  /** Anything the confirmation needs first (a note box), shown before the consequence. */
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <div role="group" aria-label={`Confirm: ${label}`} className={`flex items-center gap-2 flex-wrap ${align === "end" ? "justify-end" : ""}`}>
      {children}
      <p id={`${id}-consequence`} className={`text-[12px] leading-4 text-ink-soft max-w-md ${align === "end" ? "text-right" : ""}`}>
        {consequence}
      </p>
      <Button size={size} disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
      <Button size={size} variant={confirmVariant} busy={busy} busyLabel={busyLabel} disabled={disabled} onClick={onConfirm} aria-describedby={`${id}-consequence`}>
        {confirmLabel}
      </Button>
    </div>
  );
}

type Outcome = boolean | { ok: boolean; error?: string | null };

export function ConfirmStep({
  label,
  triggerLabel,
  triggerAriaLabel,
  triggerVariant = "secondary",
  confirmLabel,
  confirmVariant,
  busyLabel,
  consequence,
  disabled = false,
  align = "end",
  size = "md",
  onConfirm,
}: {
  label: string;
  /** The first button ("Revoke"); defaults to the label. */
  triggerLabel?: React.ReactNode;
  triggerAriaLabel?: string;
  triggerVariant?: ButtonVariant;
  confirmLabel: React.ReactNode;
  /** Defaults to the trigger's variant (a danger action stays red when confirmed). */
  confirmVariant?: ButtonVariant;
  /** What the confirm button says while it runs (default "Saving…"). */
  busyLabel?: React.ReactNode;
  consequence: React.ReactNode;
  disabled?: boolean;
  align?: "start" | "end";
  size?: "md" | "sm";
  /** Runs the action. true / { ok: true } closes the step; false / { ok: false, error } keeps it open. */
  onConfirm: () => Promise<Outcome>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    let r: Outcome;
    try {
      r = await onConfirm();
    } catch (e) {
      r = { ok: false, error: userMessage(e) };
    }
    setBusy(false);
    const ok = typeof r === "boolean" ? r : r.ok;
    if (ok) return setOpen(false);
    if (typeof r !== "boolean" && r.error) setError(r.error);
  }

  return (
    <div className={`inline-flex flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}>
      {open ? (
        <ConfirmPanel
          label={label}
          consequence={consequence}
          confirmLabel={confirmLabel}
          confirmVariant={confirmVariant ?? triggerVariant}
          busy={busy}
          busyLabel={busyLabel}
          align={align}
          size={size}
          onCancel={() => {
            setOpen(false);
            setError(null);
          }}
          onConfirm={confirm}
        />
      ) : (
        <Button size={size} variant={triggerVariant} disabled={disabled} aria-label={triggerAriaLabel} onClick={() => setOpen(true)}>
          {triggerLabel ?? label}
        </Button>
      )}
      {error && (
        <p role="alert" className={errorText}>
          {error}
        </p>
      )}
    </div>
  );
}
