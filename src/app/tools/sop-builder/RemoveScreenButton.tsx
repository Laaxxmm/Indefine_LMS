"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { userMessage } from "@/lib/errors";

// "Remove this screen" (admins and partners, SOP review H1): blanks the screenshot in every version
// of the SOP and saves the versions' Word files in OneDrive again without it. Asks first.
export function RemoveScreenButton({ sopId, imageId }: { sopId: string; imageId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  async function remove() {
    if (!window.confirm("Remove this screen from every version of this SOP? Its picture is blanked for good and the Word files in OneDrive are saved again without it. This can't be undone.")) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/tools/sop-builder/sops/${sopId}/images/${imageId}/remove`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) setNote({ text: data.error || "The screen could not be removed. Try again in a minute.", bad: true });
      else {
        window.alert(data.message || "The screen is removed.");
        router.refresh();
      }
    } catch (e) {
      setNote({ text: userMessage(e), bad: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="block mt-1">
      <button onClick={remove} disabled={busy} className="inline-flex items-center gap-1 text-[12px] font-semibold text-rose-600 hover:underline disabled:text-ink-faint">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Remove this screen
      </button>
      {note && (
        <span role="alert" className="flex items-center justify-center gap-1 text-[12px] text-rose-600 mt-0.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {note.text}
        </span>
      )}
    </span>
  );
}
