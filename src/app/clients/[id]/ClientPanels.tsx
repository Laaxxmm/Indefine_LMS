"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import type { ClientDocType, JobStatus, ServiceType } from "@prisma/client";
import { departmentLabel } from "@/lib/ca-firm";
import { DOC_TYPES, JOB_DOC_TYPES, JOB_STATUSES, KYC_DOC_TYPES, keysOf } from "@/lib/clients/core";
import type { Handler } from "@/lib/clients/services";

export type JobView = { id: string; fy: string; department: ServiceType["department"]; service: string; handlerId: string; status: JobStatus; dueOn: string; fees: string; notes: string; folderStatus: string; docCount: number };
export type DocView = { id: string; jobId: string | null; docType: ClientDocType; name: string; webUrl: string; uploadedBy: string; createdAt: string };

type Props = {
  clientId: string; folderStatus: string; jobs: JobView[]; documents: DocView[]; services: ServiceType[]; handlers: Handler[];
  fys: string[]; canManage: boolean; meId: string;
};

const field = "rounded-lg border border-border bg-page/60 px-2.5 py-1.5 text-[13px]";
const card = "rounded-2xl bg-card border border-border shadow-lift p-5";
const h2 = "text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3";

async function call(url: string, init: RequestInit): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}
const json = (body: unknown, method = "POST"): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function ClientPanels({ clientId, folderStatus, jobs, documents, services, handlers, fys, canManage, meId }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<{ ok: boolean; data: Record<string, unknown> }>) {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(String(r.data.error ?? "Failed"));
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  // --- add job ---
  const [nj, setNj] = useState({ department: services[0]?.department ?? "TAX", serviceTypeId: services[0]?.id ?? "", fy: fys[0], handlerId: meId, dueOn: "", fees: "" });
  const deptServices = services.filter((s) => s.department === nj.department);

  // --- upload ---
  const [target, setTarget] = useState<string>("KYC"); // "KYC" or a job id
  const [docType, setDocType] = useState<string>("PAN");
  const [uploadReport, setUploadReport] = useState<string[]>([]);
  const typeOptions = target === "KYC" ? KYC_DOC_TYPES : JOB_DOC_TYPES;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const fd = new FormData();
    fd.set("docType", docType);
    if (target !== "KYC") fd.set("jobId", target);
    for (const f of Array.from(files)) fd.append("files", f);
    setUploadReport([]);
    await run("upload", async () => {
      const r = await call(`/api/clients/${clientId}/documents`, { method: "POST", body: fd });
      const failed = (r.data.failed as Array<{ name: string; error: string }> | undefined) ?? [];
      setUploadReport(failed.map((f) => `${f.name}: ${f.error}`));
      return { ok: r.ok, data: { error: "None of the files uploaded — see the list below" } };
    });
  }

  const pendingJobs = jobs.filter((j) => j.folderStatus !== "READY").length;
  const kycDocs = documents.filter((d) => !d.jobId);

  return (
    <div className="space-y-6">
      {(folderStatus !== "READY" || pendingJobs > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-[13px] flex items-center justify-between gap-3">
          <span>SharePoint folders not created yet ({folderStatus !== "READY" ? "client" : ""}{folderStatus !== "READY" && pendingJobs ? " + " : ""}{pendingJobs ? `${pendingJobs} job(s)` : ""}). Uploads will fail until this is fixed.</span>
          <button onClick={() => run("folders", () => call(`/api/clients/${clientId}/folders`, { method: "POST" }))} disabled={!!busy} className="inline-flex items-center gap-1.5 font-bold"><RefreshCw className={`w-4 h-4 ${busy === "folders" ? "animate-spin" : ""}`} /> Retry</button>
        </div>
      )}
      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-[13px]">{error}</div>}

      <section className={card}>
        <h2 className={h2}>Jobs ({jobs.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left">
              <tr><th className="py-2 pr-3">FY</th><th className="py-2 pr-3">Department</th><th className="py-2 pr-3">Service</th><th className="py-2 pr-3">Handler</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Due</th><th className="py-2 pr-3">Notes</th><th className="py-2 pr-3">Docs</th><th /></tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-border">
                  <td className="py-2 pr-3 font-semibold">{j.fy}</td>
                  <td className="py-2 pr-3">{departmentLabel(j.department)}</td>
                  <td className="py-2 pr-3">{j.service}</td>
                  <td className="py-2 pr-3"><select value={j.handlerId} onChange={(e) => run(j.id, () => call(`/api/clients/jobs/${j.id}`, json({ handlerId: e.target.value }, "PATCH")))} className={field}>{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></td>
                  <td className="py-2 pr-3"><select value={j.status} onChange={(e) => run(j.id, () => call(`/api/clients/jobs/${j.id}`, json({ status: e.target.value }, "PATCH")))} className={field}>{keysOf(JOB_STATUSES).map((s) => <option key={s} value={s}>{JOB_STATUSES[s]}</option>)}</select></td>
                  <td className="py-2 pr-3"><input type="date" defaultValue={j.dueOn} onBlur={(e) => { if (e.target.value !== j.dueOn) run(j.id, () => call(`/api/clients/jobs/${j.id}`, json({ dueOn: e.target.value }, "PATCH"))); }} className={field} /></td>
                  <td className="py-2 pr-3"><input defaultValue={j.notes} placeholder="Notes" onBlur={(e) => { if (e.target.value !== j.notes) run(j.id, () => call(`/api/clients/jobs/${j.id}`, json({ notes: e.target.value }, "PATCH"))); }} className={`${field} w-40`} /></td>
                  <td className="py-2 pr-3">{j.docCount}</td>
                  <td className="py-2 text-right">{canManage && j.docCount === 0 && <button title="Remove job" onClick={() => { if (confirm("Remove this job record?")) run(j.id, () => call(`/api/clients/jobs/${j.id}`, { method: "DELETE" })); }} className="text-ink-faint hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run("newjob", () => call(`/api/clients/${clientId}/jobs`, json({ serviceTypeId: nj.serviceTypeId, fy: nj.fy, handlerId: nj.handlerId, dueOn: nj.dueOn, fees: nj.fees }))); }}>
          <select value={nj.department} onChange={(e) => { const d = e.target.value as ServiceType["department"]; setNj({ ...nj, department: d, serviceTypeId: services.find((s) => s.department === d)?.id ?? "" }); }} className={field}>{[...new Set(services.map((s) => s.department))].map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}</select>
          <select value={nj.serviceTypeId} onChange={(e) => setNj({ ...nj, serviceTypeId: e.target.value })} className={field}>{deptServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select value={nj.fy} onChange={(e) => setNj({ ...nj, fy: e.target.value })} className={field}>{fys.map((f) => <option key={f}>{f}</option>)}</select>
          <select value={nj.handlerId} onChange={(e) => setNj({ ...nj, handlerId: e.target.value })} className={field}>{handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
          <input type="date" value={nj.dueOn} onChange={(e) => setNj({ ...nj, dueOn: e.target.value })} className={field} title="Due date" />
          <input type="number" min={0} placeholder="Fees ₹" value={nj.fees} onChange={(e) => setNj({ ...nj, fees: e.target.value })} className={`${field} w-28`} />
          <button type="submit" disabled={!!busy || !nj.serviceTypeId} className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-[13px] font-bold">{busy === "newjob" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add job</button>
        </form>
      </section>

      <section className={card}>
        <h2 className={h2}>Documents ({documents.length})</h2>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <select value={target} onChange={(e) => { setTarget(e.target.value); setDocType(e.target.value === "KYC" ? "PAN" : "SOURCE_DATA"); }} className={field}>
            <option value="KYC">KYC (client-level)</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.fy} · {j.service}</option>)}
          </select>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={field}>{Object.entries(typeOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <label className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg border border-border bg-card text-[13px] font-semibold cursor-pointer hover:bg-muted">
            {busy === "upload" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload files
            <input type="file" multiple className="hidden" disabled={!!busy} onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
        {uploadReport.length > 0 && <ul className="mb-3 text-[12.5px] text-rose-600 list-disc pl-5">{uploadReport.map((u) => <li key={u}>{u}</li>)}</ul>}

        <DocGroup title="KYC" docs={kycDocs} canManage={canManage} onDelete={(id) => run(id, () => call(`/api/clients/documents/${id}`, { method: "DELETE" }))} />
        {jobs.map((j) => (
          <DocGroup key={j.id} title={`${j.fy} · ${departmentLabel(j.department)} · ${j.service}`} docs={documents.filter((d) => d.jobId === j.id)} canManage={canManage} onDelete={(id) => run(id, () => call(`/api/clients/documents/${id}`, { method: "DELETE" }))} />
        ))}
      </section>
    </div>
  );
}

function DocGroup({ title, docs, canManage, onDelete }: { title: string; docs: DocView[]; canManage: boolean; onDelete: (id: string) => void }) {
  if (docs.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="text-[12px] font-bold text-ink-mute mb-1">{title}</div>
      <ul className="divide-y divide-border text-[13px]">
        {docs.map((d) => (
          <li key={d.id} className="py-2 flex items-center justify-between gap-3">
            <span><span className="font-semibold">{DOC_TYPES[d.docType]}</span> · {d.name} <span className="text-ink-faint">· {d.uploadedBy} · {d.createdAt}</span></span>
            <span className="flex items-center gap-3">
              <a href={d.webUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 font-semibold"><ExternalLink className="w-4 h-4" /> Open</a>
              {canManage && <button title="Unlink record (file stays on SharePoint)" onClick={() => { if (confirm("Remove this document record? The file stays on SharePoint.")) onDelete(d.id); }} className="text-ink-faint hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
