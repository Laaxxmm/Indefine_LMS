"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { call } from "@/components/ui";
import type { Handler } from "@/lib/clients/services";
import { EDIT_PRIVATE_FIELDS } from "@/lib/clients/pii";
import { ClientFields, type ClientFormValue } from "../ClientFields";

// The page sends the client's personal fields (PAN, GSTIN, contact details, referral, growth note)
// blank: their full values are loaded only when the form is opened, through the audited reveal
// route ({ purpose: "edit" }, one AuditEvent per opening), so a page load hands out none of them.
export function EditClient({ client, handlers }: { client: ClientFormValue & { id: string; active: boolean }; handlers: Handler[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState<ClientFormValue>(client);
  const [active, setActive] = useState(client.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openForm() {
    setLoading(true);
    setError(null);
    try {
      const r = await call(`/api/clients/${encodeURIComponent(client.id)}/reveal`, { purpose: "edit" });
      if (!r.ok) return setError(r.error);
      const loaded = (r.data.values ?? {}) as Record<string, unknown>;
      const full: ClientFormValue = { ...client };
      for (const f of EDIT_PRIVATE_FIELDS) full[f] = typeof loaded[f] === "string" ? (loaded[f] as string) : "";
      setValue(full);
      setActive(client.active);
      setOpen(true);
    } catch {
      setError("The client's details could not be loaded for editing. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/clients/${client.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...value, active }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(data.error || "Could not save"); return; }
    setOpen(false);
    setValue(client);
    router.refresh();
  }

  if (!open) {
    return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <button onClick={() => void openForm()} disabled={loading} aria-busy={loading} title="Opening the form loads the client's full details, and this is recorded." className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-60">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />} Edit
        </button>
        {error && <span role="alert" className="text-[12.5px] text-rose-600">{error}</span>}
      </span>
    );
  }

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
