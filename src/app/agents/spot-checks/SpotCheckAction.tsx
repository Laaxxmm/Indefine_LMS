"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmPanel } from "@/components/firm-os";
import { call, errorText, field, labelText } from "@/components/ui";

export const NOTE_MAX = 500;
export const CHECK_CONSEQUENCE = "Records that you checked the task ref and the minutes in Turia. It cannot be undone; the job stays DONE either way.";

/**
 * "Checked in Turia" for one selected close. The first click opens an optional note and says what
 * confirming does (the shared confirm step); the second records it (partners only — the route
 * refuses anyone else).
 */
export function SpotCheckAction({ syncId, label }: { syncId: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = `spot-note-${syncId}`;

  async function confirm() {
    setBusy(true);
    setError(null);
    const r = await call(`/api/firm-os/spot-checks/${encodeURIComponent(syncId)}`, { note: note.trim() || null });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="success" onClick={() => setOpen(true)} aria-label={`Checked in Turia: ${label}`} className="whitespace-nowrap">
        Checked in Turia
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-2 min-w-[16rem]">
      <ConfirmPanel label={`Record spot check: ${label}`} consequence={CHECK_CONSEQUENCE} confirmLabel="Confirm check" confirmVariant="success" busy={busy} onCancel={() => setOpen(false)} onConfirm={confirm}>
        <label htmlFor={noteId} className={`self-stretch w-full flex flex-col gap-1 text-left ${labelText}`}>
          Note (optional)
          <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={NOTE_MAX} className={`${field} font-normal text-ink`} />
        </label>
      </ConfirmPanel>
      {error && (
        <span role="alert" className={errorText}>
          {error}
        </span>
      )}
    </div>
  );
}
