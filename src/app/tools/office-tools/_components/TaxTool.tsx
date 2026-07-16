"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle, FileDown, Upload, FileText, X } from "lucide-react";

function filenameFrom(disposition: string): string {
  const m = disposition.match(/filename="(.+?)"/);
  return m?.[1] || "export.xlsx";
}

export function TaxTool({ tool, title, subtitle }: { tool: string; title: string; subtitle: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const pdfs = Array.from(list).filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    setFiles((prev) => [...prev, ...pdfs]);
    setDone(null);
  };
  const removeAt = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  async function process() {
    if (files.length === 0) {
      setError("Add at least one PDF.");
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append("files", f));
      const res = await fetch(`/api/tools/office-tools/tax/${tool}`, { method: "POST", body: fd });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Processing failed.");
      }
      const blob = await res.blob();
      const name = filenameFrom(res.headers.get("Content-Disposition") || "");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone(`Processed ${files.length} file${files.length === 1 ? "" : "s"} — check your downloads.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Link href="/tools/office-tools" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> All office tools
      </Link>
      <h1 className="font-display font-extrabold text-2xl sm:text-[28px] tracking-[-0.02em] mb-1">{title}</h1>
      <p className="text-ink-mute text-[14px] mb-6">{subtitle}</p>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className="rounded-2xl border-2 border-dashed border-border bg-card hover:bg-muted/40 transition cursor-pointer p-10 text-center"
      >
        <Upload className="w-8 h-8 mx-auto text-ink-faint mb-2" />
        <p className="font-semibold text-[15px]">Drop PDF files here or click to browse</p>
        <p className="text-ink-mute text-[13px] mt-0.5">Multiple files supported. Nothing is uploaded until you process.</p>
        <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
      </div>

      {files.length > 0 && (
        <div className="mt-4 rounded-2xl bg-card border border-border shadow-lift p-4">
          <div className="text-[11px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-2.5">{files.length} file{files.length === 1 ? "" : "s"} selected</div>
          <ul className="flex flex-col gap-1.5">
            {files.map((f, idx) => (
              <li key={idx} className="flex items-center gap-2 text-[13px] text-ink-soft">
                <FileText className="w-4 h-4 text-ink-faint shrink-0" />
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-[11px] text-ink-faint whitespace-nowrap">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => removeAt(idx)} className="text-ink-faint hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <button onClick={process} disabled={busy || files.length === 0} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-sm font-bold shadow-pop transition">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          Process &amp; download Excel
        </button>
        {error && <span className="text-[13px] text-rose-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</span>}
        {done && !error && <span className="text-[13px] text-emerald-600 font-semibold">{done}</span>}
      </div>
      <p className="text-[11px] text-ink-faint mt-3">Files are parsed in memory and never stored; each run is logged for audit.</p>
    </div>
  );
}
