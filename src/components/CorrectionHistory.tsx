"use client";

// "History" link for any record the corrections service covers (client, Firm OS client, job,
// engagement, comms draft). Opens a panel with the record's corrections — who, when, field,
// before → after, reason — and, for people allowed to correct it, a small form to correct one
// allow-listed field with a reason. Values of client personal data arrive masked from the API.
//
// Mount it on a record page with one line, e.g. <HistoryLink entity="JobTask" id={job.id} />.
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2 } from "lucide-react";
import { btnGhost, btnPrimary, call, card, errorText, field } from "@/components/ui";

export type HistoryEntity = "FirmClient" | "Client" | "JobTask" | "Engagement" | "CommsDraft";

type Entry = { id: string; atLabel: string; actorName: string; label: string; before: string; after: string; reason: string };
type Editable = { field: string; label: string; input: "text" | "textarea" | "date" | "number" | "select" | "user"; options?: { value: string; label: string }[] };
type View = { noun: string; entries: Entry[]; editable: Editable[]; people: { id: string; name: string }[] };

const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";
const labelText = "text-[11px] font-bold text-ink-mute";

export function HistoryLink({ entity, id, label = "History" }: { entity: HistoryEntity; id: string; label?: string }) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fieldName, setFieldName] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const r = await call(`/api/firm-os/corrections/history?entity=${encodeURIComponent(entity)}&id=${encodeURIComponent(id)}`, undefined, "GET");
    setLoading(false);
    if (!r.ok) return setError(r.error);
    const v = r.data as unknown as View;
    setView(v);
    setFieldName((f) => f || v.editable[0]?.field || "");
  }

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    await load();
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    const r = await call("/api/firm-os/corrections", { entity, id, field: fieldName, newValue: value, reason });
    setSaving(false);
    if (!r.ok) return setSaveError(r.error);
    const note = typeof r.data.note === "string" ? ` ${r.data.note}` : "";
    setSaved(`Correction saved.${note}`);
    setValue("");
    setReason("");
    await load();
    router.refresh();
  }

  const chosen = view?.editable.find((f) => f.field === fieldName) ?? null;
  const panelId = `${uid}-panel`;

  function valueInput(f: Editable) {
    const common = { id: `${uid}-value`, value, onChange: (e: { target: { value: string } }) => setValue(e.target.value), className: `${field} mt-1 ${focusRing}` };
    if (f.input === "textarea") return <textarea {...common} rows={3} maxLength={5000} />;
    if (f.input === "date") return <input {...common} type="date" className={`${common.className} tabular-nums`} />;
    if (f.input === "number") return <input {...common} type="number" min={0} step="any" inputMode="decimal" className={`${common.className} tabular-nums`} />;
    if (f.input === "select" || f.input === "user") {
      const options = f.input === "user" ? (view?.people ?? []).map((p) => ({ value: p.id, label: p.name })) : (f.options ?? []);
      return (
        <select {...common}>
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    return <input {...common} type="text" maxLength={200} />;
  }

  return (
    <div className="inline-block w-full max-w-2xl align-top">
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId} className={`${btnGhost} ${focusRing} inline-flex items-center gap-1.5`}>
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <History className="w-3.5 h-3.5" aria-hidden="true" />}
        {label}
      </button>
      {open && (
        <section id={panelId} aria-label={`Correction history of this ${view?.noun ?? "record"}`} className={`${card} mt-2`}>
          {error && (
            <p role="alert" className={errorText}>
              {error}
            </p>
          )}
          {view && (
            <>
              <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-mute uppercase mb-3">Corrections</h2>
              {view.entries.length === 0 ? (
                <p className="text-[13px] text-ink-mute">No corrections to this {view.noun} yet.</p>
              ) : (
                <ol className="space-y-3">
                  {view.entries.map((e) => (
                    <li key={e.id} className="text-[13px]">
                      <p className="text-[11.5px] text-ink-mute tabular-nums">
                        {e.actorName} · {e.atLabel} IST
                      </p>
                      <p>
                        <span className="font-semibold">{e.label[0].toUpperCase() + e.label.slice(1)}</span>: {e.before} <span aria-hidden="true">→</span>
                        <span className="sr-only"> changed to </span> {e.after}
                      </p>
                      {e.reason && <p className="text-ink-soft whitespace-pre-wrap">Reason: {e.reason}</p>}
                    </li>
                  ))}
                </ol>
              )}

              {view.editable.length > 0 && (
                <form
                  className="mt-4 pt-4 border-t border-border space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                  }}
                >
                  <h3 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-mute uppercase">Correct a wrong entry</h3>
                  <div>
                    <label htmlFor={`${uid}-field`} className={labelText}>
                      Field
                    </label>
                    <select
                      id={`${uid}-field`}
                      value={fieldName}
                      onChange={(e) => {
                        setFieldName(e.target.value);
                        setValue("");
                      }}
                      className={`${field} mt-1 ${focusRing}`}
                    >
                      {view.editable.map((f) => (
                        <option key={f.field} value={f.field}>
                          {f.label[0].toUpperCase() + f.label.slice(1)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {chosen && (
                    <div>
                      <label htmlFor={`${uid}-value`} className={labelText}>
                        Correct value
                      </label>
                      {valueInput(chosen)}
                    </div>
                  )}
                  <div>
                    <label htmlFor={`${uid}-reason`} className={labelText}>
                      Why was it wrong?
                    </label>
                    <textarea id={`${uid}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className={`${field} mt-1 ${focusRing}`} />
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div aria-live="polite">
                      {saveError ? (
                        <p role="alert" className={errorText}>
                          {saveError}
                        </p>
                      ) : saved ? (
                        <p className="text-[12.5px] text-emerald-800">{saved}</p>
                      ) : null}
                    </div>
                    <button type="submit" disabled={saving || !fieldName || reason.trim().length < 5} className={`${btnPrimary} ${focusRing} inline-flex items-center gap-1.5`}>
                      {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                      {saving ? "Saving…" : "Save correction"}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
