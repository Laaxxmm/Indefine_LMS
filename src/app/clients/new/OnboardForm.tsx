"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Upload, X } from "lucide-react";
import type { ServiceType } from "@prisma/client";
import { departmentLabel } from "@/lib/ca-firm";
import { KYC_DOC_TYPES } from "@/lib/clients/core";
import type { Handler } from "@/lib/clients/services";
import { ClientFields, emptyClient, field, label, type ClientFormValue } from "../ClientFields";

type Props = { services: ServiceType[]; handlers: Handler[]; fys: string[]; meId: string };
type Pending = { file: File; docType: string };

export function OnboardForm({ services, handlers, fys, meId }: Props) {
  const router = useRouter();
  const [client, setClient] = useState<ClientFormValue>(() => emptyClient({ primaryHandlerId: meId }));
  const [job, setJob] = useState({ department: services[0]?.department ?? "TAX", serviceTypeId: services[0]?.id ?? "", fy: fys[0], handlerId: meId, dueOn: "", fees: "" });
  const [docType, setDocType] = useState<string>("PAN");
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; existingId?: string } | null>(null);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);

  const deptServices = services.filter((s) => s.department === job.department);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list).map((file) => ({ file, docType }))]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setUploadErrors([]);
    setBusy("Saving client…");
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client, job: { serviceTypeId: job.serviceTypeId, fy: job.fy, handlerId: job.handlerId, dueOn: job.dueOn, fees: job.fees } }),
      });
      const data = await res.json();
      if (!res.ok) { setError({ text: data.error || "Could not save", existingId: data.existingId }); return; }

      // Upload KYC files one doc type at a time; a failed file never blocks the others.
      const byType = new Map<string, File[]>();
      for (const p of files) byType.set(p.docType, [...(byType.get(p.docType) ?? []), p.file]);
      const failed: string[] = [];
      for (const [type, fs] of byType) {
        setBusy(`Uploading ${fs.length} file(s)…`);
        const fd = new FormData();
        fd.set("docType", type);
        for (const f of fs) fd.append("files", f);
        const up = await fetch(`/api/clients/${data.id}/documents`, { method: "POST", body: fd });
        const r = await up.json().catch(() => ({ failed: fs.map((f) => ({ name: f.name, error: "Upload failed" })) }));
        for (const f of r.failed ?? []) failed.push(`${f.name}: ${f.error}`);
      }
      if (failed.length) {
        setUploadErrors(failed);
        setBusy(null);
        setError({ text: "Client saved, but some files did not upload. Retry them from the client page.", existingId: data.id });
        return;
      }
      router.push(`/clients/${data.id}`);
    } catch (err) {
      setError({ text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6 max-w-3xl">
      <section className="rounded-2xl bg-card border border-border shadow-lift p-5">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-4">Client</h2>
        <ClientFields value={client} onChange={setClient} handlers={handlers} />
      </section>

      <section className="rounded-2xl bg-card border border-border shadow-lift p-5">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-4">First job</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1"><span className={label}>Department *</span>
            <select value={job.department} onChange={(e) => { const d = e.target.value as ServiceType["department"]; const first = services.find((s) => s.department === d); setJob({ ...job, department: d, serviceTypeId: first?.id ?? "" }); }} className={field}>
              {[...new Set(services.map((s) => s.department))].map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className={label}>Service *</span>
            <select required value={job.serviceTypeId} onChange={(e) => setJob({ ...job, serviceTypeId: e.target.value })} className={field}>
              {deptServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className={label}>Financial year *</span>
            <select value={job.fy} onChange={(e) => setJob({ ...job, fy: e.target.value })} className={field}>{fys.map((f) => <option key={f}>{f}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1"><span className={label}>Job handler *</span>
            <select required value={job.handlerId} onChange={(e) => setJob({ ...job, handlerId: e.target.value })} className={field}><option value="">Select…</option>{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1"><span className={label}>Due date</span><input type="date" value={job.dueOn} onChange={(e) => setJob({ ...job, dueOn: e.target.value })} className={field} /></label>
          <label className="flex flex-col gap-1"><span className={label}>Fees (₹)</span><input type="number" min={0} value={job.fees} onChange={(e) => setJob({ ...job, fees: e.target.value })} className={field} /></label>
        </div>
      </section>

      <section className="rounded-2xl bg-card border border-border shadow-lift p-5">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-1">KYC documents</h2>
        <p className="text-[12.5px] text-ink-mute mb-3">Saved to SharePoint under Clients / {client.name || "<client>"} / KYC. Pick a type, then attach files of that type. Up to 50 MB each.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-border bg-page/60 px-3 py-2 text-[13px]">
            {Object.entries(KYC_DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card text-[13px] font-semibold cursor-pointer hover:bg-muted">
            <Upload className="w-4 h-4" /> Attach files
            <input type="file" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {files.length > 0 && (
          <ul className="mt-3 divide-y divide-border text-[13px]">
            {files.map((p, i) => (
              <li key={i} className="py-2 flex items-center justify-between gap-3">
                <span><span className="font-semibold">{KYC_DOC_TYPES[p.docType as keyof typeof KYC_DOC_TYPES]}</span> · {p.file.name} <span className="text-ink-faint">({Math.ceil(p.file.size / 1024)} KB)</span></span>
                <button type="button" onClick={() => setFiles((f) => f.filter((_, j) => j !== i))} className="text-ink-faint hover:text-rose-600"><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-[13px]">
          {error.text}{" "}
          {error.existingId && <Link href={`/clients/${error.existingId}`} className="underline font-semibold">Open client</Link>}
          {uploadErrors.length > 0 && <ul className="mt-1 list-disc pl-5">{uploadErrors.map((u) => <li key={u}>{u}</li>)}</ul>}
        </div>
      )}

      <button type="submit" disabled={!!busy} className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-sm font-bold shadow-pop transition">
        {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {busy}</> : "Onboard client"}
      </button>
    </form>
  );
}
