"use client";

// Client panels for the breach register: record an incident, and the steps on one incident
// (containment note, Board told, affected people told, details update, close). Each calls one
// /api/firm-os/privacy/breaches route with call() and shows the route's sentence on failure.
// Closing is final, so it asks for confirmation first (MistakeDecision pattern).
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btnDanger, btnGhost, btnPrimary, call, errorText, field } from "@/components/ui";
import { focusRing } from "@/app/agents/parts";

const labelText = "text-[11px] font-bold text-ink-mute";
const severities = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

function Spinner({ on }: { on: boolean }) {
  return on ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null;
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className={errorText}>
      {error}
    </p>
  ) : null;
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(url: string, body: unknown, after?: (data: Record<string, unknown>) => void) {
    setBusy(true);
    setError(null);
    const r = await call(url, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    after?.(r.data);
    router.refresh();
    return true;
  }
  return { busy, error, run };
}

const countValue = (s: string) => (s.trim() === "" ? null : Number(s));

export function NewBreachForm({ nowLocal }: { nowLocal: string }) {
  const uid = useId();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [f, setF] = useState({ detectedAt: nowLocal, summary: "", severity: "high", affectedCount: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run("/api/firm-os/privacy/breaches", { ...f, affectedCount: countValue(f.affectedCount) }, (data) => {
          if (typeof data.id === "string") router.push(`/admin/firm-os/breaches/${encodeURIComponent(data.id)}`);
        });
      }}
    >
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${uid}-at`} className={labelText}>
            Firm became aware at (IST)
          </label>
          <input id={`${uid}-at`} type="datetime-local" value={f.detectedAt} max={nowLocal} onChange={set("detectedAt")} className={`${field} mt-1 tabular-nums ${focusRing}`} />
        </div>
        <div>
          <label htmlFor={`${uid}-sev`} className={labelText}>
            Severity
          </label>
          <select id={`${uid}-sev`} value={f.severity} onChange={set("severity")} className={`${field} mt-1 ${focusRing}`}>
            {severities.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-n`} className={labelText}>
            People affected (if known)
          </label>
          <input id={`${uid}-n`} type="number" min={0} step={1} inputMode="numeric" value={f.affectedCount} onChange={set("affectedCount")} className={`${field} mt-1 tabular-nums ${focusRing}`} />
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-s`} className={labelText}>
          What happened (no personal details)
        </label>
        <textarea id={`${uid}-s`} value={f.summary} onChange={set("summary")} rows={2} maxLength={2000} className={`${field} mt-1 ${focusRing}`} />
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ErrorLine error={error} />
        <button type="submit" disabled={busy} className={`${btnPrimary} ${focusRing} inline-flex items-center gap-1.5 ml-auto`}>
          <Spinner on={busy} />
          {busy ? "Recording…" : "Record incident"}
        </button>
      </div>
    </form>
  );
}

type Step = "contain" | "board-notified" | "principals-notified" | "update" | "close";

/** Steps that can't be undone from the screen, with what confirming does. */
const FINAL: Partial<Record<Step, { consequence: string; confirm: string }>> = {
  "board-notified": { consequence: "This stops the Board clock at the time entered. It can't be changed afterwards.", confirm: "Confirm Board was told" },
  "principals-notified": { consequence: "This stops the affected-people clock at the time entered. It can't be changed afterwards.", confirm: "Confirm people were told" },
  close: { consequence: "The incident is closed for good; later events need a new incident.", confirm: "Confirm close" },
};

export function BreachActions({ id, nowLocal, boardDone, principalsDone, severity, affectedCount }: { id: string; nowLocal: string; boardDone: boolean; principalsDone: boolean; severity: string; affectedCount: number | null }) {
  const uid = useId();
  const { busy, error, run } = useAction();
  const steps: { value: Step; label: string }[] = [
    { value: "contain", label: "Add a containment step" },
    ...(!boardDone ? [{ value: "board-notified" as Step, label: "Record that the Board was told" }] : []),
    ...(!principalsDone ? [{ value: "principals-notified" as Step, label: "Record that affected people were told" }] : []),
    { value: "update", label: "Update severity or people affected" },
    { value: "close", label: "Close the incident" },
  ];
  const [step, setStep] = useState<Step>(steps[0].value);
  const [note, setNote] = useState("");
  const [at, setAt] = useState(nowLocal);
  const [sev, setSev] = useState(severity);
  const [count, setCount] = useState(affectedCount === null ? "" : String(affectedCount));
  const [confirming, setConfirming] = useState(false);

  function body(): Record<string, unknown> {
    if (step === "contain" || step === "close") return { action: step, note };
    if (step === "update") return { action: step, severity: sev, affectedCount: countValue(count) };
    return { action: step, at, note: note || null };
  }
  async function save() {
    if (await run(`/api/firm-os/privacy/breaches/${encodeURIComponent(id)}`, body())) {
      setNote("");
      setConfirming(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (FINAL[step] && !confirming) return setConfirming(true);
        void save();
      }}
    >
      <div>
        <label htmlFor={`${uid}-step`} className={labelText}>
          Step
        </label>
        <select
          id={`${uid}-step`}
          value={step}
          onChange={(e) => {
            setStep(e.target.value as Step);
            setConfirming(false);
          }}
          className={`${field} mt-1 ${focusRing}`}
        >
          {steps.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {(step === "board-notified" || step === "principals-notified") && (
        <div>
          <label htmlFor={`${uid}-at`} className={labelText}>
            Notice sent at (IST)
          </label>
          <input id={`${uid}-at`} type="datetime-local" value={at} max={nowLocal} onChange={(e) => setAt(e.target.value)} className={`${field} mt-1 tabular-nums ${focusRing}`} />
        </div>
      )}
      {step === "update" ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}-sev`} className={labelText}>
              Severity
            </label>
            <select id={`${uid}-sev`} value={sev} onChange={(e) => setSev(e.target.value)} className={`${field} mt-1 ${focusRing}`}>
              {severities.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-n`} className={labelText}>
              People affected
            </label>
            <input id={`${uid}-n`} type="number" min={0} step={1} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} className={`${field} mt-1 tabular-nums ${focusRing}`} />
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor={`${uid}-note`} className={labelText}>
            {step === "contain" ? "What was done to contain it" : step === "close" ? "Closing note: what happened, what was done, what changes" : "Note (optional; reference of the notice)"}
          </label>
          <textarea id={`${uid}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className={`${field} mt-1 ${focusRing}`} />
        </div>
      )}
      <ErrorLine error={error} />
      {confirming && FINAL[step] ? (
        <div className="flex items-center gap-2 flex-wrap justify-end" role="group" aria-label={`Confirm: ${steps.find((s) => s.value === step)?.label ?? step}`}>
          <span className="text-[12px] text-ink-soft max-w-md text-right">{FINAL[step]!.consequence}</span>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={`${btnGhost} ${focusRing}`}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={`${step === "close" ? btnDanger : btnPrimary} ${focusRing} inline-flex items-center gap-1.5`}>
            <Spinner on={busy} />
            {busy ? "Saving…" : FINAL[step]!.confirm}
          </button>
        </div>
      ) : (
        <div className="flex justify-end">
          <button type="submit" disabled={busy} className={`${step === "close" ? btnDanger : btnPrimary} ${focusRing} inline-flex items-center gap-1.5`}>
            <Spinner on={busy} />
            {busy ? "Saving…" : step === "close" ? "Close incident…" : FINAL[step] ? "Record notice…" : "Save step"}
          </button>
        </div>
      )}
    </form>
  );
}
