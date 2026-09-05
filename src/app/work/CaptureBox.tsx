"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, call, field } from "@/components/ui";

// One line in, one Ideas card out. Present on every Today screen, including the gate steps,
// so a passing thought can be parked without breaking the gate.
export function CaptureBox() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setNote(null);
    const r = await call("/api/work", { title });
    setBusy(false);
    if (!r.ok) {
      setNote(r.error);
      return;
    }
    setTitle("");
    setNote("Saved to Ideas");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-dashed border-border bg-card/60 p-4">
      <label htmlFor="capture-idea" className="block text-[11px] font-bold text-ink-mute mb-1.5">Capture an idea</label>
      <div className="flex gap-2">
        <input
          id="capture-idea"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          placeholder="One line. It goes to Ideas and out of your way."
          className={field}
        />
        <button type="submit" disabled={busy || !title.trim()} className={btnPrimary}>Capture</button>
      </div>
      {note && <p className="mt-2 text-[12px] text-ink-mute">{note}</p>}
    </form>
  );
}
