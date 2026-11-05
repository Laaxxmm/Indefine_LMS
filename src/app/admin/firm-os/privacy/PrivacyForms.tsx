"use client";

// Client panels for the privacy register: log a request, verify identity, close / refuse, record a
// nominee, restrict processing, confirm an erasure. Each calls one /api/firm-os/privacy route with
// call() (src/components/ui.ts), shows the route's sentence on failure and refreshes on success.
// Irreversible steps use the confirm pattern from MistakeDecision: the first click says what will
// happen, the second does it.
import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btnDanger, btnGhost, btnPrimary, call, errorText, field } from "@/components/ui";
import { focusRing, linkText } from "@/app/agents/parts";

const labelText = "text-[11px] font-bold text-ink-mute";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(url: string, body?: unknown, after?: (data: Record<string, unknown>) => void) {
    setBusy(true);
    setError(null);
    const r = await call(url, body ?? {});
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    after?.(r.data);
    router.refresh();
    return true;
  }
  return { busy, error, setError, run };
}

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

const req = (id: string, step: string) => `/api/firm-os/privacy/requests/${encodeURIComponent(id)}/${step}`;

// ------------------------------------------------------------------ new request

export function NewRequestForm({ kinds, today }: { kinds: { value: string; label: string }[]; today: string }) {
  const uid = useId();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [f, setF] = useState({ kind: kinds[0]?.value ?? "access", pan: "", gstin: "", email: "", phone: "", receivedOn: today, channel: "", notes: "" });
  const [notes, setNotes] = useState<string[]>([]);
  const [loggedId, setLoggedId] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    setNotes([]);
    setLoggedId(null);
    const body = {
      kind: f.kind,
      identifiers: { pan: f.pan || null, gstin: f.gstin || null, email: f.email || null, phone: f.phone || null },
      receivedOn: f.receivedOn || null,
      channel: f.channel || null,
      notes: f.notes || null,
    };
    await run("/api/firm-os/privacy/requests", body, (data) => {
      const id = typeof data.id === "string" ? data.id : null;
      const n = Array.isArray(data.notes) ? data.notes.map(String) : [];
      if (id && !n.length) return router.push(`/admin/firm-os/privacy/${encodeURIComponent(id)}`);
      // Logged, with something to read first: clear the form so a second click can't log it twice.
      setNotes(n);
      setLoggedId(id);
      setF({ ...f, pan: "", gstin: "", email: "", phone: "", channel: "", notes: "" });
    });
  }

  const input = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <div>
      <label htmlFor={`${uid}-${k}`} className={labelText}>
        {label}
      </label>
      <input id={`${uid}-${k}`} value={f[k]} onChange={set(k)} className={`${field} mt-1 ${focusRing}`} {...props} />
    </div>
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label htmlFor={`${uid}-kind`} className={labelText}>
            Kind of request
          </label>
          <select id={`${uid}-kind`} value={f.kind} onChange={set("kind")} className={`${field} mt-1 ${focusRing}`}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        {input("receivedOn", "Received on", { type: "date", max: today, className: `${field} mt-1 tabular-nums ${focusRing}` })}
        {input("channel", "How it arrived", { placeholder: "Email, letter, in person", maxLength: 40 })}
      </div>
      <fieldset>
        <legend className={labelText}>Identify the person (at least one; matched exactly, never stored as typed)</legend>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-1">
          {input("pan", "PAN", { autoComplete: "off", maxLength: 10, spellCheck: false })}
          {input("gstin", "GSTIN", { autoComplete: "off", maxLength: 15, spellCheck: false })}
          {input("email", "Email", { type: "email", autoComplete: "off" })}
          {input("phone", "Phone", { type: "tel", autoComplete: "off", inputMode: "tel" })}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${uid}-notes`} className={labelText}>
          Notes (what the person asked for; identifiers are masked when saved)
        </label>
        <textarea id={`${uid}-notes`} value={f.notes} onChange={set("notes")} rows={2} maxLength={2000} className={`${field} mt-1 ${focusRing}`} />
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div aria-live="polite" className="space-y-1">
          <ErrorLine error={error} />
          {notes.map((n) => (
            <p key={n} className="text-[12.5px] text-amber-800">
              {n}
            </p>
          ))}
          {loggedId && (
            <p className="text-[12.5px] text-ink-soft">
              The request was logged.{" "}
              <Link href={`/admin/firm-os/privacy/${encodeURIComponent(loggedId)}`} className={linkText}>
                Open the request
              </Link>
            </p>
          )}
        </div>
        <button type="submit" disabled={busy} className={`${btnPrimary} ${focusRing} inline-flex items-center gap-1.5`}>
          <Spinner on={busy} />
          {busy ? "Logging…" : "Log request"}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ verify identity

export function VerifyForm({ id, methods }: { id: string; methods: readonly string[] }) {
  const uid = useId();
  const { busy, error, run } = useAction();
  const [method, setMethod] = useState(methods[0] ?? "");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!confirming) return setConfirming(true);
        if (await run(req(id, "verify"), { method, note: note || null })) setConfirming(false);
      }}
    >
      <div>
        <label htmlFor={`${uid}-m`} className={labelText}>
          How was the identity checked?
        </label>
        <select id={`${uid}-m`} value={method} onChange={(e) => setMethod(e.target.value)} className={`${field} mt-1 ${focusRing}`}>
          {methods.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${uid}-n`} className={labelText}>
          Note (optional; needed for Other)
        </label>
        <input id={`${uid}-n`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={`${field} mt-1 ${focusRing}`} />
      </div>
      <ErrorLine error={error} />
      {confirming ? (
        <div className="flex items-center gap-2 flex-wrap justify-end" role="group" aria-label="Confirm identity verified">
          <span className="text-[12px] text-ink-soft max-w-md text-right">This can&apos;t be undone. It opens the next steps, which share, change or erase the person&apos;s data.</span>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={`${btnGhost} ${focusRing}`}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={`${btnPrimary} ${focusRing} inline-flex items-center gap-1.5`}>
            <Spinner on={busy} />
            {busy ? "Saving…" : "Confirm identity verified"}
          </button>
        </div>
      ) : (
        <div className="flex justify-end">
          <button type="submit" className={`${btnPrimary} ${focusRing}`}>
            Mark identity verified
          </button>
        </div>
      )}
    </form>
  );
}

// ------------------------------------------------------------------ close / refuse

export function CloseForm({ id, canComplete, completeLabel }: { id: string; canComplete: boolean; completeLabel: string }) {
  const uid = useId();
  const { busy, error, run } = useAction();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"completed" | "rejected" | null>(null);
  const consequence =
    pending === "rejected"
      ? "The request is closed as refused, with this reason. It can't be reopened; a new request would be logged."
      : "The request is closed as completed, with this reply. It can't be reopened.";
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${uid}-n`} className={labelText}>
          {canComplete ? "Reply sent to the person, or the reason for refusing" : "Reason for refusing"}
        </label>
        <textarea id={`${uid}-n`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className={`${field} mt-1 ${focusRing}`} />
      </div>
      <ErrorLine error={error} />
      {pending ? (
        <div className="flex items-center gap-2 flex-wrap justify-end" role="group" aria-label="Confirm closing the request">
          <span className="text-[12px] text-ink-soft max-w-md text-right">{consequence}</span>
          <button type="button" disabled={busy} onClick={() => setPending(null)} className={`${btnGhost} ${focusRing}`}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await run(req(id, "close"), { outcome: pending, note })) setPending(null);
            }}
            className={`${pending === "rejected" ? btnDanger : btnPrimary} ${focusRing} inline-flex items-center gap-1.5`}
          >
            <Spinner on={busy} />
            {busy ? "Saving…" : pending === "rejected" ? "Confirm refusal" : "Confirm and close"}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button type="button" onClick={() => setPending("rejected")} disabled={note.trim().length < 10} className={`${btnDanger} ${focusRing}`}>
            Refuse request
          </button>
          {canComplete && (
            <button type="button" onClick={() => setPending("completed")} disabled={note.trim().length < 10} className={`${btnPrimary} ${focusRing}`}>
              {completeLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ nomination

export function NominationForm({ id }: { id: string }) {
  const uid = useId();
  const { busy, error, run } = useAction();
  const [f, setF] = useState({ nomineeName: "", relationship: "", nomineeContact: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void run(req(id, "nomination"), f);
      }}
    >
      <div className="grid sm:grid-cols-3 gap-3">
        {(
          [
            ["nomineeName", "Nominee's full name", 120],
            ["relationship", "Relationship", 60],
            ["nomineeContact", "Nominee's phone or email", 120],
          ] as const
        ).map(([k, label, max]) => (
          <div key={k}>
            <label htmlFor={`${uid}-${k}`} className={labelText}>
              {label}
            </label>
            <input id={`${uid}-${k}`} value={f[k]} onChange={set(k)} maxLength={max} className={`${field} mt-1 ${focusRing}`} />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ErrorLine error={error} />
        <button type="submit" disabled={busy} className={`${btnPrimary} ${focusRing} inline-flex items-center gap-1.5 ml-auto`}>
          <Spinner on={busy} />
          {busy ? "Saving…" : "Record nominee"}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ confirm steps

/** One irreversible step behind a confirm: first click shows the consequence, the second runs it. */
export function ConfirmStep({ url, body, label, confirmLabel, consequence, tone = "danger" }: { url: string; body?: unknown; label: string; confirmLabel: string; consequence: string; tone?: "danger" | "primary" }) {
  const { busy, error, run } = useAction();
  const [pending, setPending] = useState(false);
  const cls = tone === "danger" ? btnDanger : btnPrimary;
  return (
    <div className="space-y-2">
      {pending ? (
        <div className="flex items-center gap-2 flex-wrap justify-end" role="group" aria-label={`Confirm: ${label}`}>
          <span className="text-[12px] text-ink-soft max-w-md text-right">{consequence}</span>
          <button type="button" disabled={busy} onClick={() => setPending(false)} className={`${btnGhost} ${focusRing}`}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await run(url, body ?? {})) setPending(false);
            }}
            className={`${cls} ${focusRing} inline-flex items-center gap-1.5`}
          >
            <Spinner on={busy} />
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      ) : (
        <div className="flex justify-end">
          <button type="button" onClick={() => setPending(true)} className={`${cls} ${focusRing}`}>
            {label}
          </button>
        </div>
      )}
      <div className="flex justify-end">
        <ErrorLine error={error} />
      </div>
    </div>
  );
}
