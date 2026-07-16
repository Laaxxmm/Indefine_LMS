"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle, FileDown } from "lucide-react";

export const inputCls =
  "w-full rounded-lg border border-border bg-page/60 px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400 transition";

export function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12.5px] font-bold text-ink-soft mb-1">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-ink-faint mt-1">{hint}</span>}
    </label>
  );
}

export function Text({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

export function Area({ value, onChange, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea className={inputCls} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

export function Num({ value, onChange, min, step, placeholder }: { value: number | ""; onChange: (v: number | "") => void; min?: number; step?: number; placeholder?: string }) {
  return (
    <input
      type="number"
      className={inputCls}
      value={value}
      min={min}
      step={step}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
    />
  );
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

export function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="date" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />;
}

function filenameFrom(disposition: string): string {
  const m = disposition.match(/filename="(.+?)"/);
  return m?.[1] || "document";
}

// POST a JSON payload and stream the returned file to a browser download.
async function download(kind: "doc" | "tax", tool: string, payload: unknown): Promise<void> {
  const res = await fetch(`/api/tools/office-tools/${kind}/${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || "Generation failed. Check the inputs and try again.");
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
}

// Shared page shell: back link, title, and a generate button wired to the download.
export function ToolShell({
  title,
  subtitle,
  buildPayload,
  tool,
  children,
}: {
  title: string;
  subtitle: string;
  tool: string;
  buildPayload: () => unknown;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function generate() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await download("doc", tool, buildPayload());
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <Link href="/tools/office-tools" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> All office tools
      </Link>
      <h1 className="font-display font-extrabold text-2xl sm:text-[28px] tracking-[-0.02em] mb-1">{title}</h1>
      <p className="text-ink-mute text-[14px] mb-6">{subtitle}</p>

      {children}

      <div className="mt-5 flex items-center gap-3 flex-wrap">
        <button
          onClick={generate}
          disabled={busy}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-sm font-bold shadow-pop transition"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
          Generate &amp; download
        </button>
        {error && <span className="text-[13px] text-rose-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</span>}
        {done && !error && <span className="text-[13px] text-emerald-600 font-semibold">Downloaded — check your browser downloads.</span>}
      </div>
      <p className="text-[11px] text-ink-faint mt-3">Prints on stamp paper — space is reserved at the top. Nothing is stored; each run is logged for audit.</p>
    </div>
  );
}

// A titled card section wrapping a grid of fields.
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-4">
      <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3.5">{title}</h2>
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">{children}</div>
    </section>
  );
}
