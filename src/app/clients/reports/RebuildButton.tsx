"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

export function RebuildButton() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function rebuild() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/clients/workbook", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? "Workbook rebuilt on SharePoint." : `Rebuild failed: ${data.error ?? res.status}`);
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button onClick={rebuild} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-60">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Rebuild database workbook
      </button>
      {msg && <span className="text-[12.5px] text-ink-mute">{msg}</span>}
    </span>
  );
}
