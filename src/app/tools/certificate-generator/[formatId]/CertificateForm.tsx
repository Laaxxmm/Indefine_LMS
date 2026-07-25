"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Plus, Trash2, AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import type { CertificateTemplate, FieldDef } from "@/lib/certificates/types";
import { compose, isTotalRow, PlaceholderLeakError, type Block } from "@/lib/certificates/render/compose";
import { resolveValues, CertificateValidationError } from "@/lib/certificates/render/values";
import { isSuggestible } from "@/lib/certificates/suggestible";
import { FieldCombobox, type FieldOption } from "./FieldCombobox";

type Payload = Record<string, unknown>;

// Fields the user actually edits: not derived (deriveFrom), and not auto-conditional blocks.
function visibleFields(t: CertificateTemplate): FieldDef[] {
  return t.fields.filter((f) => !f.deriveFrom && f.type !== "computed" && !(f.type === "optionalBlock" && f.enabledWhen));
}

function fieldByKey(t: CertificateTemplate): Map<string, FieldDef> {
  const m = new Map<string, FieldDef>();
  for (const f of t.fields) {
    m.set(f.key, f);
    for (const sf of f.subFields ?? []) m.set(sf.key, sf);
  }
  return m;
}

function initialPayload(t: CertificateTemplate): Payload {
  const p: Payload = {};
  for (const f of t.fields) {
    if (f.deriveFrom || f.type === "computed") continue;
    if (f.type === "table" && f.table) {
      const nCols = f.table.columns.length;
      if (f.table.dynamicRows) p[f.key] = [Array(nCols).fill("")];
      else p[f.key] = f.table.rowLabels.map(() => Array(nCols).fill(""));
    } else if (f.type === "boolToggle") p[f.key] = false;
    else if (f.type === "optionalBlock") p[f.key] = false;
    else p[f.key] = "";
  }
  return p;
}

export function CertificateForm({ template }: { template: CertificateTemplate }) {
  const [payload, setPayload] = useState<Payload>(() => initialPayload(template));
  const [clientName, setClientName] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);

  const byKey = useMemo(() => fieldByKey(template), [template]);
  const set = (key: string, value: unknown) => {
    setPayload((p) => ({ ...p, [key]: value }));
    setDoneId(null);
  };

  // Firm-wide saved values for the reusable signing fields (pick / add / remove).
  const [options, setOptions] = useState<Record<string, FieldOption[]>>({});
  useEffect(() => {
    let alive = true;
    fetch("/api/tools/certificate-generator/field-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.options) setOptions(d.options); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const addOption = async (fieldKey: string, value: string) => {
    setPayload((p) => ({ ...p, [fieldKey]: value }));
    setOptions((prev) => {
      const list = prev[fieldKey] ?? [];
      if (list.some((o) => o.value === value)) return prev;
      return { ...prev, [fieldKey]: [...list, { id: `tmp-${value}`, value }].sort((a, b) => a.value.localeCompare(b.value)) };
    });
    try {
      const r = await fetch("/api/tools/certificate-generator/field-options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fieldKey, value }) });
      if (r.ok) {
        const d = await r.json();
        setOptions((prev) => ({ ...prev, [fieldKey]: (prev[fieldKey] ?? []).map((o) => (o.value === value ? d.option : o)) }));
      }
    } catch {}
  };
  const deleteOption = (fieldKey: string, id: string) => {
    setOptions((prev) => ({ ...prev, [fieldKey]: (prev[fieldKey] ?? []).filter((o) => o.id !== id) }));
    if (!id.startsWith("tmp-")) fetch(`/api/tools/certificate-generator/field-options/${id}`, { method: "DELETE" }).catch(() => {});
  };
  const suggestFor = (f: FieldDef) =>
    isSuggestible(f.key) && f.type === "text"
      ? { options: options[f.key] ?? [], onAdd: (v: string) => addOption(f.key, v), onDelete: (id: string) => deleteOption(f.key, id) }
      : undefined;

  // Live preview — the SAME walk that produces the DOCX, rendered as React elements.
  // Throws until every required field is filled and no placeholder remains (§0.4).
  const preview = useMemo(() => {
    try {
      return { blocks: compose(template, resolveValues(template, payload)), errors: [] as string[] };
    } catch (e) {
      if (e instanceof CertificateValidationError) {
        // Only surface fields the user actually edits — derived conjugations (deriveFrom,
        // e.g. sg_iwe) resolve automatically from their driver ("Signing as") and must not
        // appear in the banner.
        const labels = e.fieldErrors
          .map((fe) => byKey.get(fe.key.replace(/\[.*$/, "")))
          .filter((f): f is FieldDef => !!f && !f.deriveFrom && !!f.label)
          .map((f) => f.label);
        return { blocks: null, errors: Array.from(new Set(labels)) };
      }
      if (e instanceof PlaceholderLeakError) return { blocks: null, errors: [e.message] };
      return { blocks: null, errors: [(e as Error).message] };
    }
  }, [template, payload, byKey]);

  const canDownload = preview.blocks !== null && clientName.trim() !== "" && acknowledged && !busy;

  async function download() {
    setBusy(true);
    setServerError(null);
    try {
      const res = await fetch("/api/tools/certificate-generator/issue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ formatId: template.id, clientName, acknowledged, payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setServerError(body.error || `Request failed (${res.status})`);
        return;
      }
      const issueId = res.headers.get("X-Issue-Id");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.headers.get("X-Filename") || `${template.id}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDoneId(issueId || "ok");
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const fields = visibleFields(template);
  const inlineFields = fields.filter((f) => f.type !== "table" && f.type !== "optionalBlock");
  const tableFields = fields.filter((f) => f.type === "table");
  const blockFields = fields.filter((f) => f.type === "optionalBlock");

  return (
    <div>
      <Link href="/tools/certificate-generator" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> All formats
      </Link>
      <div className="flex items-center gap-2.5 mb-6">
        <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-700 grid place-items-center font-display font-extrabold uppercase shrink-0">
          {template.romanNo}
        </span>
        <div>
          <h1 className="font-display font-extrabold text-2xl sm:text-[26px] tracking-[-0.02em] leading-tight">{template.title}</h1>
          <p className="text-xs text-ink-faint font-bold mt-0.5">
            v{template.version} · verified {template.verifiedAt} by {template.verifiedBy}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-6 items-start">
        {/* ---- Form ---- */}
        <div className="flex flex-col gap-4">
          <Section title="For whom">
            <TextInput
              label="Client / entity name"
              help="Appears in your history; identifies who this certificate is for."
              value={clientName}
              onChange={setClientName}
              required
            />
          </Section>

          <Section title="Certificate details">
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
              {inlineFields.map((f) => (
                <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                  <InlineField field={f} value={payload[f.key]} onChange={(v) => set(f.key, v)} suggest={suggestFor(f)} />
                </div>
              ))}
            </div>
          </Section>

          {tableFields.map((f) => (
            <Section key={f.key} title={f.label}>
              <TableField field={f} value={(payload[f.key] as string[][]) ?? []} onChange={(v) => set(f.key, v)} />
            </Section>
          ))}

          {blockFields.length > 0 && (
            <Section title="Optional notes">
              {blockFields.map((f) => (
                <OptionalBlockField key={f.key} field={f} enabled={payload[f.key] === true} onToggle={(v) => set(f.key, v)} sub={payload} onSub={set} />
              ))}
            </Section>
          )}
        </div>

        {/* ---- Preview + issue ---- */}
        <div className="lg:sticky lg:top-20 flex flex-col gap-3">
          {preview.errors.length > 0 && (
            <div className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
              <div className="text-[13px] text-rose-800">
                <p className="font-bold mb-0.5">Fill these before you can download:</p>
                <p className="leading-relaxed">{preview.errors.join(" · ")}</p>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-card border border-border shadow-lift overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/60 text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase">
              Live preview
            </div>
            <div className="cert-doc max-h-[62vh] overflow-auto p-6 text-[13px] leading-relaxed text-ink">
              {preview.blocks ? (
                <Preview blocks={preview.blocks} />
              ) : (
                <p className="text-ink-faint italic">Complete the required fields to see the certificate preview.</p>
              )}
            </div>
          </div>

          <label className="flex items-start gap-2.5 rounded-2xl bg-card border border-border px-4 py-3 cursor-pointer">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 w-4 h-4 accent-brand-500" />
            <span className="text-[13px] text-ink-soft leading-relaxed">
              These are ICAI illustrative formats; I remain professionally responsible for the issued certificate.
            </span>
          </label>

          {serverError && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-[13px] text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {serverError}
            </div>
          )}
          {doneId && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-2.5 text-[13px] text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Downloaded.{" "}
              <Link href="/tools/certificate-generator/history" className="font-bold underline">View in history</Link>
            </div>
          )}

          <button
            type="button"
            onClick={download}
            disabled={!canDownload}
            className="w-full inline-flex items-center justify-center gap-2 font-bold text-[15px] text-white bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint disabled:cursor-not-allowed transition px-6 py-3.5 rounded-[14px] shadow-pop"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download Word
          </button>
          <p className="flex items-center gap-1.5 text-[11px] text-ink-faint justify-center">
            <ShieldCheck className="w-3.5 h-3.5" /> Deterministic — no AI. Regenerable from your history.
          </p>
        </div>
      </div>

      <style>{`
        .cert-doc p { margin: 0 0 0.7em; }
        .cert-doc .cert-title { font-size: 14.5px; margin-top: 0.3em; line-height: 1.35; }
        .cert-doc .cert-title strong { font-weight: 800; }
        .cert-doc .cert-heading { margin-top: 0.9em; }
        .cert-doc .cert-subheading { text-align: center; margin-top: 0.85em; }
        .cert-doc table { border-collapse: collapse; width: 100%; margin: 0.7em 0; font-size: 11.5px; }
        .cert-doc th, .cert-doc td { border: 1px solid #ececf3; padding: 4px 7px; text-align: left; vertical-align: top; }
        .cert-doc thead th { background: #f5f5fb; font-weight: 700; }
        .cert-doc tr.cert-total td, .cert-doc tr.cert-total th { font-weight: 700; background: #faf9ff; }
      `}</style>
    </div>
  );
}

// Preview renders compose() blocks as React elements — no raw HTML, React escapes text.
function Preview({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "para") {
          const cls = b.lines.some((l) => l.style === "subheading")
            ? "cert-subheading"
            : b.lines.some((l) => l.style === "title")
              ? "cert-title"
              : b.lines.some((l) => l.style === "heading")
                ? "cert-heading"
                : undefined;
          return (
            <p key={i} className={cls}>
              {b.lines.map((l, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  {l.style ? <strong>{l.text}</strong> : l.runs ? l.runs.map((r, k) => (r.bold ? <strong key={k}>{r.text}</strong> : <span key={k}>{r.text}</span>)) : l.text}
                </span>
              ))}
            </p>
          );
        }
        return (
          <table key={i}>
            <thead>
              <tr>
                {!b.table.dynamic && <th />}
                {b.table.columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.table.cells.map((row, r) => (
                <tr key={r} className={!b.table.dynamic && isTotalRow(b.table.rowLabels[r]) ? "cert-total" : undefined}>
                  {!b.table.dynamic && <th scope="row">{b.table.rowLabels[r]}</th>}
                  {row.map((v, c) => (
                    <td key={c}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        );
      })}
    </>
  );
}

/* ---------------- controls ---------------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card border border-border shadow-lift p-5">
      <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3.5">{title}</h2>
      {children}
    </section>
  );
}

function FieldShell({ label, help, required, children }: { label: string; help?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12.5px] font-bold text-ink-soft mb-1">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
      {help && <span className="block text-[11px] text-ink-faint mt-1">{help}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-page/60 px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400 transition";

function TextInput({ label, help, value, onChange, required }: { label: string; help?: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <FieldShell label={label} help={help} required={required}>
      <input className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
    </FieldShell>
  );
}

function InlineField({ field, value, onChange, suggest }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; suggest?: { options: FieldOption[]; onAdd: (v: string) => void; onDelete: (id: string) => void } }) {
  const v = (value ?? "") as string;
  switch (field.type) {
    case "textarea":
      return (
        <FieldShell label={field.label} help={field.help} required={field.required}>
          <textarea className={inputCls} rows={2} value={v} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );
    case "date":
      return (
        <FieldShell label={field.label} help={field.help} required={field.required}>
          <input type="date" className={inputCls} value={v} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );
    case "year":
      return (
        <FieldShell label={field.label} help={field.help} required={field.required}>
          <input inputMode="numeric" maxLength={4} className={inputCls} value={v} placeholder="2025" onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))} />
        </FieldShell>
      );
    case "number":
      return (
        <FieldShell label={field.label} help={field.help} required={field.required}>
          <input inputMode="decimal" className={inputCls} value={v} onChange={(e) => onChange(e.target.value)} />
        </FieldShell>
      );
    case "udin": {
      const ok = /^[0-9A-Z]{18}$/.test(v);
      return (
        <FieldShell label={field.label} required={field.required} help="18 chars — paste from the ICAI portal; this tool never generates a UDIN.">
          <input
            className={`${inputCls} font-mono tracking-wide ${v && !ok ? "border-rose-300" : ""}`}
            value={v}
            maxLength={18}
            placeholder="25ABCDE1234567890Z"
            onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 18))}
          />
          {v.length > 0 && (
            <span className={`block text-[11px] mt-1 ${ok ? "text-emerald-600" : "text-rose-500"}`}>{ok ? "Valid format" : `${v.length}/18 — must be 18 letters/digits`}</span>
          )}
        </FieldShell>
      );
    }
    case "enumToggle":
      return (
        <FieldShell label={field.label} help={field.help} required={field.required}>
          <div className="flex flex-wrap gap-1.5">
            {field.options?.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(o.value)}
                className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border transition ${
                  value === o.value ? "bg-brand-500 border-brand-500 text-white" : "bg-page/60 border-border text-ink-soft hover:bg-muted"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </FieldShell>
      );
    case "boolToggle":
      return (
        <FieldShell label={field.label} help={field.help} required={field.required}>
          <div className="flex gap-1.5">
            {[{ v: true, l: "Yes" }, { v: false, l: "No" }].map((o) => (
              <button
                key={o.l}
                type="button"
                onClick={() => onChange(o.v)}
                className={`px-4 py-1.5 rounded-lg text-[12.5px] font-semibold border transition ${
                  value === o.v ? "bg-brand-500 border-brand-500 text-white" : "bg-page/60 border-border text-ink-soft hover:bg-muted"
                }`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </FieldShell>
      );
    default: // text
      return suggest ? (
        <FieldCombobox label={field.label} help={field.help} required={field.required} value={v} onChange={onChange as (s: string) => void} options={suggest.options} onAdd={suggest.onAdd} onDelete={suggest.onDelete} />
      ) : (
        <TextInput label={field.label} help={field.help} value={v} onChange={onChange as (s: string) => void} required={field.required} />
      );
  }
}

function TableField({ field, value, onChange }: { field: FieldDef; value: string[][]; onChange: (v: string[][]) => void }) {
  const spec = field.table!;
  const dynamic = spec.dynamicRows === true;
  const computed = new Set((spec.computedRows ?? []).map((c) => c.rowIndex));

  const setCell = (r: number, c: number, val: string) => {
    const next = value.map((row) => [...row]);
    next[r][c] = val;
    onChange(next);
  };
  const addRow = () => onChange([...value, Array(spec.columns.length).fill("")]);
  const removeRow = (r: number) => onChange(value.filter((_, i) => i !== r));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr>
            {!dynamic && <th className="text-left font-bold text-ink-mute px-2 py-1.5 w-[38%]" />}
            {spec.columns.map((c) => (
              <th key={c.key} className="text-left font-bold text-ink-mute px-2 py-1.5">{c.label}</th>
            ))}
            {dynamic && <th className="w-8" />}
          </tr>
        </thead>
        <tbody>
          {value.map((row, r) => {
            const isComputed = !dynamic && computed.has(r);
            return (
              <tr key={r} className="border-t border-border">
                {!dynamic && <td className="px-2 py-1 font-semibold text-ink-soft align-top">{spec.rowLabels[r]}</td>}
                {row.map((cell, c) => (
                  <td key={c} className="px-1 py-1">
                    <input
                      className={`w-full rounded border border-border bg-page/60 px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-brand-300 ${isComputed ? "bg-muted text-ink-faint" : ""}`}
                      value={cell}
                      disabled={isComputed}
                      placeholder={isComputed ? "auto" : ""}
                      onChange={(e) => setCell(r, c, e.target.value)}
                    />
                  </td>
                ))}
                {dynamic && (
                  <td className="px-1">
                    <button type="button" onClick={() => removeRow(r)} className="text-ink-faint hover:text-rose-500 transition" aria-label="Remove row">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {dynamic && (
        <button type="button" onClick={addRow} className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-brand-600 hover:text-brand-700 transition">
          <Plus className="w-4 h-4" /> Add row
        </button>
      )}
    </div>
  );
}

function OptionalBlockField({ field, enabled, onToggle, sub, onSub }: { field: FieldDef; enabled: boolean; onToggle: (v: boolean) => void; sub: Payload; onSub: (k: string, v: unknown) => void }) {
  return (
    <div>
      <label className="flex items-center gap-2.5 cursor-pointer mb-2">
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.target.checked)} className="w-4 h-4 accent-brand-500" />
        <span className="text-[13px] font-semibold text-ink-soft">Include: {field.label}</span>
      </label>
      {enabled && (
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3 pl-6 pt-1">
          {(field.subFields ?? []).map((sf) => (
            <InlineField key={sf.key} field={sf} value={sub[sf.key]} onChange={(v) => onSub(sf.key, v)} />
          ))}
        </div>
      )}
    </div>
  );
}
