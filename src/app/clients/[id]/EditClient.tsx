"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import type { Handler } from "@/lib/clients/services";
import { ClientFields, type ClientFormValue } from "../ClientFields";

export function EditClient({ client, handlers }: { client: ClientFormValue & { id: string; active: boolean }; handlers: Handler[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<ClientFormValue>(client);
  const [active, setActive] = useState(client.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/clients/${client.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...value, active }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error || "Could not save"); return; }
    setOpen(false);
    router.refresh();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm font-semibold hover:bg-muted"><Pencil className="w-4 h-4" /> Edit</button>;

  return (
    <form onSubmit={save} className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-6">
      <ClientFields value={value} onChange={setValue} handlers={handlers} />
      <label className="mt-4 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active client</label>
      {error && <p className="text-[12.5px] text-rose-600 mt-2">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-[13px] font-bold">{busy && <Loader2 className="w-4 h-4 animate-spin" />} Save</button>
        <button type="button" onClick={() => { setOpen(false); setValue(client); }} className="px-4 py-2 rounded-lg text-[13px] font-semibold text-ink-mute hover:bg-muted">Cancel</button>
      </div>
    </form>
  );
}
