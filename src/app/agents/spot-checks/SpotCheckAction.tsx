"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btnGhost, btnSuccess, call, errorText, field } from "@/components/ui";
import { focusRing } from "../parts";

export const NOTE_MAX = 500;
export const CHECK_CONSEQUENCE = "Records that you checked the task ref and the minutes in Turia. It cannot be undone; the job stays DONE either way.";

/**
 * "Checked in Turia" for one selected close. The first click opens an optional note and says what
 * confirming does; the second records it (partners only — the route refuses anyone else).
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
      <button type="button" onClick={() => setOpen(true)} aria-label={`Checked in Turia: ${label}`} className={`${btnSuccess} ${focusRing} whitespace-nowrap`}>
        Checked in Turia
      </button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-2 min-w-[16rem]" role="group" aria-label={`Record spot check: ${label}`}>
      <label htmlFor={noteId} className="self-stretch text-[11px] font-bold text-ink-mute text-left">
        Note (optional)
        <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={NOTE_MAX} className={`${field} mt-1 font-normal text-ink ${focusRing}`} />
      </label>
      <p className="text-[12px] text-ink-soft max-w-xs text-right">{CHECK_CONSEQUENCE}</p>
      <span className="inline-flex items-center gap-2">
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className={`${btnGhost} ${focusRing}`}>
          Cancel
        </button>
        <button type="button" disabled={busy} onClick={confirm} className={`${btnSuccess} ${focusRing} inline-flex items-center gap-1.5`}>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {busy ? "Saving…" : "Confirm check"}
        </button>
      </span>
      {error && (
        <span role="alert" className={errorText}>
          {error}
        </span>
      )}
    </div>
  );
}
