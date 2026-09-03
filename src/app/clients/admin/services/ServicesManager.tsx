"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import type { ServiceType } from "@prisma/client";
import { DEPARTMENTS, departmentLabel } from "@/lib/ca-firm";

export function ServicesManager({ services }: { services: ServiceType[] }) {
  const router = useRouter();
  const [dept, setDept] = useState<ServiceType["department"]>("AUDIT");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(key: string, url: string, method: string, body: unknown) {
    setBusy(key);
    setError(null);
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(data.error || "Failed"); return false; }
    router.refresh();
    return true;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <form onSubmit={async (e) => { e.preventDefault(); if (await send("add", "/api/clients/services", "POST", { department: dept, name })) setName(""); }} className="rounded-2xl bg-card border border-border shadow-lift p-5 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1"><span className="text-[11px] font-bold text-ink-mute">Department</span>
          <select value={dept} onChange={(e) => setDept(e.target.value as ServiceType["department"])} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]">{DEPARTMENTS.filter((d) => d !== "GENERAL").map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[200px]"><span className="text-[11px] font-bold text-ink-mute">Service name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]" />
        </label>
        <button type="submit" disabled={!!busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-[13px] font-bold">{busy === "add" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add</button>
        {error && <p className="w-full text-[12.5px] text-rose-600">{error}</p>}
      </form>

      {DEPARTMENTS.filter((d) => services.some((s) => s.department === d)).map((d) => (
        <div key={d} className="rounded-2xl bg-card border border-border shadow-lift p-5">
          <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2">{departmentLabel(d)}</h2>
          <ul className="divide-y divide-border text-[13.5px]">
            {services.filter((s) => s.department === d).map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                <span className={s.active ? "" : "text-ink-faint line-through"}>{s.name}</span>
                <button onClick={() => send(s.id, `/api/clients/services/${s.id}`, "PATCH", { active: !s.active })} disabled={!!busy} className="text-[12.5px] font-semibold text-ink-mute hover:text-ink">{s.active ? "Deactivate" : "Reactivate"}</button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
