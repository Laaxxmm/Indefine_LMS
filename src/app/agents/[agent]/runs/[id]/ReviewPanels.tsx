"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye } from "lucide-react";
import type { JobTaskState } from "@prisma/client";
import { btnGhost, call, card, errorText, field, focusRing, labelText, pageBleed, pageGutter, sectionTitle, type CallResult } from "@/components/ui";
import type { CommentView, DeliverableView, RunReview } from "@/lib/agents/views";
import type { CloseLoopAction, CloseLoopView } from "@/lib/close-loop/review";
import { Alert, Button, Section, Spinner, StateChip } from "@/components/firm-os";

type Preview = { sheets: { name: string; rows: string[][]; truncated: boolean }[] };

// ------------------------------------------------------------------ deliverables

export function DeliverablesPanel({ deliverables }: { deliverables: DeliverableView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sheet, setSheet] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function show(id: string) {
    if (open === id) {
      setOpen(null);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await call(`/api/firm-os/agents/deliverables/${encodeURIComponent(id)}/preview`, undefined, "GET");
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPreview(r.data as unknown as Preview);
    setSheet(0);
    setOpen(id);
  }

  const current = preview?.sheets[sheet];
  return (
    <Section id="deliverables" title="Deliverables" card last>
      {deliverables.length === 0 ? (
        <p className="text-[13px] text-ink-mute">No files from this run.</p>
      ) : (
        <ul className="divide-y divide-border">
          {deliverables.map((d) => (
            <li key={d.id} className="py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold break-all">{d.name}</p>
                <p className="text-[12px] text-ink-mute tabular-nums">
                  {d.kind} · v{d.version} · {d.size} · sha256 <span className="font-mono">{d.sha256.slice(0, 12)}…</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {d.isSheet && (
                  <button type="button" onClick={() => show(d.id)} aria-expanded={open === d.id} className={btnGhost}>
                    {busy && open !== d.id ? <Spinner /> : <Eye className="w-3.5 h-3.5" aria-hidden="true" />}
                    {open === d.id ? "Hide preview" : "Preview"}
                  </button>
                )}
                <a href={`/api/firm-os/agents/deliverables/${encodeURIComponent(d.id)}`} className={btnGhost} download>
                  <Download className="w-3.5 h-3.5" aria-hidden="true" /> Download
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className={`${errorText} mt-2`}>
          {error}
        </p>
      )}
      {open && preview && current && (
        <div className="mt-4">
          {preview.sheets.length > 1 && (
            <div role="group" aria-label="Sheets" className="flex gap-1 mb-2 flex-wrap">
              {preview.sheets.map((s, i) => (
                <button key={s.name} type="button" aria-pressed={i === sheet} onClick={() => setSheet(i)} className={`${btnGhost} ${i === sheet ? "bg-muted text-ink" : ""} ${focusRing}`}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <div className={`relative overflow-auto max-h-[480px] rounded-lg border border-border ${focusRing}`} role="region" tabIndex={0} aria-label={`Preview of sheet ${current.name}`}>
            <table className="text-[12px] tabular-nums">
              <caption className="sr-only">Sheet {current.name}, read-only</caption>
              <tbody>
                {current.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-border last:border-0">
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2 py-1 whitespace-nowrap">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current.truncated && <p className="text-[12px] text-ink-mute mt-1">Preview shows the first rows and columns; download the file for the rest.</p>}
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ comments

export function CommentsPanel({ runId, comments }: { runId: string; comments: CommentView[] }) {
  const router = useRouter();
  const id = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await call(`/api/firm-os/agents/runs/${encodeURIComponent(runId)}/comments`, { text });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setText("");
    router.refresh();
  }

  return (
    <Section id={`${id}-h`} title="Comments" card last>
      {comments.length === 0 ? (
        <p className="text-[13px] text-ink-mute mb-3">No comments yet.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {comments.map((c) => (
            <li key={c.id} className="text-[13px]">
              <p className="text-[12px] text-ink-mute">
                {c.author} · {c.at}
              </p>
              <p className="whitespace-pre-wrap">{c.text}</p>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={`${id}-t`} className={labelText}>
        Add a comment
      </label>
      <textarea id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} className={`${field} mt-1 ${focusRing}`} />
      <div className="flex items-center justify-between mt-2 gap-2">
        {error ? (
          <p role="alert" className={errorText}>
            {error}
          </p>
        ) : (
          <span />
        )}
        <Button busy={busy} disabled={!text.trim()} onClick={add}>
          Add comment
        </Button>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------------ mistake log

export function MistakeForm({ runId, checks }: { runId: string; checks: string[] }) {
  const id = useId();
  const [f, setF] = useState({ finding: "", ruleId: "", title: "", severity: "warn", kind: checks.length ? "deterministic" : "llm", check: checks[0] ?? "", question: "", evidence: "", params: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit() {
    setError(null);
    let params: Record<string, unknown> | undefined;
    if (f.params.trim()) {
      try {
        params = JSON.parse(f.params) as Record<string, unknown>;
      } catch {
        return setError("Parameters must be JSON, for example {\"limitPaise\": 2000000}");
      }
    }
    setBusy(true);
    const ruleProposal = {
      id: f.ruleId.trim(),
      title: f.title.trim(),
      severity: f.severity,
      kind: f.kind,
      check: f.kind === "llm" ? f.question.trim() : f.check,
      evidence: f.evidence.trim(),
      ...(params ? { params } : {}),
    };
    const r = await call(`/api/firm-os/agents/runs/${encodeURIComponent(runId)}/mistakes`, { finding: f.finding, ruleProposal });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDone(true);
  }

  const lbl = `flex flex-col gap-1 ${labelText}`;
  return (
    <section aria-labelledby={`${id}-h`} className={card}>
      <details>
        <summary className={`cursor-pointer rounded ${focusRing}`}>
          <h2 id={`${id}-h`} className={`${sectionTitle} inline mb-0`}>
            Log a missed or wrong finding
          </h2>
        </summary>
        {done ? (
          <p className="text-[13px] mt-4" role="status">
            Logged. A partner or manager will review the proposed rule in the mistake log; nothing changes until they approve it.
          </p>
        ) : (
          <div className="grid gap-3 mt-3">
            <label className={lbl}>
              What did the agent miss or get wrong?
              <textarea value={f.finding} onChange={set("finding")} rows={2} className={`${field} ${focusRing}`} />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className={lbl}>
                Rule id
                <input value={f.ruleId} onChange={set("ruleId")} placeholder="e.g. gst.itc-blocked-motor" className={`${field} ${focusRing}`} />
              </label>
              <label className={lbl}>
                Rule title
                <input value={f.title} onChange={set("title")} className={`${field} ${focusRing}`} />
              </label>
              <label className={lbl}>
                Severity
                <select value={f.severity} onChange={set("severity")} className={`${field} ${focusRing}`}>
                  <option value="block">Block</option>
                  <option value="warn">Warning</option>
                  <option value="info">Note</option>
                </select>
              </label>
              <label className={lbl}>
                Checked by
                <select value={f.kind} onChange={set("kind")} className={`${field} ${focusRing}`}>
                  {checks.length > 0 && <option value="deterministic">A registered rule</option>}
                  <option value="llm">A model question (quote + location required)</option>
                </select>
              </label>
            </div>
            {f.kind === "deterministic" ? (
              <div className="grid sm:grid-cols-2 gap-3">
                <label className={lbl}>
                  Registered check
                  <select value={f.check} onChange={set("check")} className={`${field} ${focusRing}`}>
                    {checks.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label className={lbl}>
                  Parameters (JSON, optional)
                  <input value={f.params} onChange={set("params")} placeholder='{"limitPaise": 2000000}' className={`${field} font-mono ${focusRing}`} />
                </label>
              </div>
            ) : (
              <label className={lbl}>
                Question for the model
                <textarea value={f.question} onChange={set("question")} rows={2} className={`${field} ${focusRing}`} />
              </label>
            )}
            <label className={lbl}>
              Evidence a finding must cite
              <input value={f.evidence} onChange={set("evidence")} placeholder="e.g. invoice number and row" className={`${field} ${focusRing}`} />
            </label>
            {error && (
              <p role="alert" className={errorText}>
                {error}
              </p>
            )}
            <div>
              <Button busy={busy} disabled={!f.finding.trim()} onClick={submit}>
                Propose rule
              </Button>
            </div>
          </div>
        )}
      </details>
    </section>
  );
}

// ------------------------------------------------------------------ filing and close
//
// After approval a person files on the portal; Firm OS never files, submits or sends anything.
// "Mark filed" records the acknowledgement (/api/firm-os/jobs/[id]/filed); "Record Turia close"
// records the Turia task ref + minutes (/turia-close), which tries the close gate. DONE is set only
// by the gate. A manager or partner can "Retract filing" (FILED_BY_HUMAN / CLOSING → APPROVED
// through /state, note required) when the filing was recorded by mistake or with the wrong ack ref.
// The form helpers are plain functions so tests can drive them with a mocked call().

type Send = (url: string, body?: unknown) => Promise<CallResult>;
type Fail = { ok: false; error: string };

export type FilingForm = { ackRef: string; turiaTaskRef: string; minutes: string };
export type FiledBody = { ackRef: string | null; turiaTaskRef: string | null; minutes: number | null };
export type TuriaCloseBody = { turiaTaskRef: string; minutes: number };

/** "" → null (when optional); a whole number 1..6000 → that number; anything else → the error to show. */
export function parseMinutes(value: string, required: boolean): { ok: true; minutes: number | null } | Fail {
  const s = value.trim();
  if (!s) return required ? { ok: false, error: "Enter the minutes logged in Turia" } : { ok: true, minutes: null };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: "Minutes must be a whole number more than 0" };
  if (n > 6000) return { ok: false, error: "Minutes must be at most 6,000" };
  return { ok: true, minutes: n };
}

/** Body for "Mark filed"; the acknowledgement reference is required where the service has one. */
export function filedBody(ack: CloseLoopView["ack"], f: FilingForm): { ok: true; body: FiledBody } | Fail {
  const ackRef = f.ackRef.trim();
  if (ack.required && !ackRef) return { ok: false, error: `Enter the ${ack.label} from the portal acknowledgement` };
  const m = parseMinutes(f.minutes, false);
  if (!m.ok) return m;
  return { ok: true, body: { ackRef: ackRef || null, turiaTaskRef: f.turiaTaskRef.trim() || null, minutes: m.minutes } };
}

/** Body for "Record Turia close": both the task ref and minutes (> 0) are required. */
export function turiaCloseBody(f: Pick<FilingForm, "turiaTaskRef" | "minutes">): { ok: true; body: TuriaCloseBody } | Fail {
  const turiaTaskRef = f.turiaTaskRef.trim();
  if (!turiaTaskRef) return { ok: false, error: "Enter the Turia task ref" };
  const m = parseMinutes(f.minutes, true);
  if (!m.ok) return m;
  return { ok: true, body: { turiaTaskRef, minutes: m.minutes! } };
}

const jobUrl = (jobId: string, what: "filed" | "turia-close" | "state") => `/api/firm-os/jobs/${encodeURIComponent(jobId)}/${what}`;

/** POST /filed. The job moves to CLOSING (the hook issues the Turia close step). */
export async function recordFiling(jobId: string, ack: CloseLoopView["ack"], f: FilingForm, send: Send = call): Promise<{ ok: true; state: string } | Fail> {
  const b = filedBody(ack, f);
  if (!b.ok) return b;
  const r = await send(jobUrl(jobId, "filed"), b.body);
  if (!r.ok) return { ok: false, error: r.error ?? "Something went wrong" };
  return { ok: true, state: String(r.data.state ?? "") };
}

export type TuriaCloseOutcome = { ok: true; done: true } | { ok: true; done: false; reasons: string[] } | Fail;

/** POST /turia-close. DONE when the close gate passed; otherwise the gate's reasons (job stays CLOSING). */
export async function recordTuriaClose(jobId: string, f: Pick<FilingForm, "turiaTaskRef" | "minutes">, send: Send = call): Promise<TuriaCloseOutcome> {
  const b = turiaCloseBody(f);
  if (!b.ok) return b;
  const r = await send(jobUrl(jobId, "turia-close"), b.body);
  if (!r.ok) return { ok: false, error: r.error ?? "Something went wrong" };
  const close = (r.data.close ?? {}) as { ok?: boolean; reasons?: unknown };
  if (close.ok) return { ok: true, done: true };
  return { ok: true, done: false, reasons: Array.isArray(close.reasons) ? close.reasons.map(String) : [] };
}

/**
 * What "Retract filing" does, shown with the note box before the retraction is sent. The state
 * machine clears filedAt / filedById / ackRef and writes the old ref into the event note.
 */
export function retractConsequence(ack: CloseLoopView["ack"], ackRef: string | null): string {
  const cleared = ackRef ? `who filed it, when, and the ${ack.label} ${ackRef}` : "who filed it and when";
  const kept = ackRef ? `The cleared ${ack.label} is kept in the job's history with your note.` : "The earlier filing is kept in the job's history with your note.";
  return `Retracting moves the job back to APPROVED and clears the filing record: ${cleared}. ${kept} Mark it filed again with the right details. Firm OS changes nothing on the portal or in Turia.`;
}

export type RetractFrom = Extract<JobTaskState, "FILED_BY_HUMAN" | "CLOSING">;

/** POST /state FILED_BY_HUMAN / CLOSING → APPROVED with the note (required; managers and partners only). */
export async function retractFiling(jobId: string, from: RetractFrom, note: string, send: Send = call): Promise<{ ok: true; state: string } | Fail> {
  const n = note.trim();
  if (!n) return { ok: false, error: "Say why the filing is being retracted" };
  const r = await send(jobUrl(jobId, "state"), { to: "APPROVED", expectedState: from, note: n });
  if (!r.ok) return { ok: false, error: r.error ?? "Something went wrong" };
  return { ok: true, state: String(r.data.state ?? "") };
}

const turiaLine = (t: CloseLoopView["turia"]) =>
  t.status === "closed" ? `Turia close recorded · ${t.ref} · ${t.minutes} min logged` : t.status === "issued" ? "Close step issued; not recorded as done yet" : "Not recorded yet";

/** Where the job's close loop stands: Final file, filing, Turia close, the gate's reasons, DONE. */
export function CloseLoopStatus({ view }: { view: CloseLoopView }) {
  const id = useId();
  const { ack } = view;
  return (
    <Section id={`${id}-h`} title="Filing and close" card last>
      <p className="text-[13px] text-ink-soft mb-3">
        Firm OS never files anything. You file on the portal, record the acknowledgement here and close the Turia task; the job is done when the close gate finds the Final file in SharePoint and the Turia
        close.
      </p>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2 text-[13px]">
        <dt className="text-ink-mute">Final file</dt>
        <dd>{view.hasFinal ? "In the Final folder" : "Not in Final yet"}</dd>
        <dt className="text-ink-mute">Filed</dt>
        <dd className="tabular-nums">{view.filedAt ? `Recorded ${view.filedAt}` : "Not recorded yet"}</dd>
        <dt className="text-ink-mute">{ack.label}</dt>
        <dd className={view.ackRef ? "font-mono break-all" : ""}>{view.ackRef ?? (ack.required ? "Not recorded yet" : "Not needed for this service")}</dd>
        <dt className="text-ink-mute">Turia</dt>
        <dd className="tabular-nums">{turiaLine(view.turia)}</dd>
      </dl>
      {view.gate && (
        <Alert tone="warning" title="Still closing: the close gate did not pass" className="mt-4">
          <ul className="list-disc pl-6 space-y-1">
            {view.gate.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="text-[12px] mt-2 tabular-nums">Checked {view.gate.at}</p>
        </Alert>
      )}
      {view.done && (
        <div className="flex items-center gap-2 flex-wrap mt-4">
          <StateChip state="DONE" />
          <span className="text-[13px] tabular-nums">
            Closed {view.done.at} · cycle time {view.done.cycleTime}
          </span>
        </div>
      )}
    </Section>
  );
}

const fieldLabel = `flex flex-col gap-1 ${labelText}`;

/** The bar's content for the close-loop action: Mark filed, Record Turia close, or Check again. */
export function CloseLoopActions({ view }: { view: CloseLoopView }) {
  const router = useRouter();
  const id = useId();
  const [f, setF] = useState<FilingForm>({ ackRef: "", turiaTaskRef: view.turia.ref ?? view.suggestedTuriaRef ?? "", minutes: view.turia.minutes ? String(view.turia.minutes) : "" });
  const [busy, setBusy] = useState<CloseLoopAction | "retract" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retracting, setRetracting] = useState(false);
  const [note, setNote] = useState("");
  const set = (k: keyof FilingForm) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const { ack } = view;

  async function retract() {
    if (view.state !== "FILED_BY_HUMAN" && view.state !== "CLOSING") return;
    setBusy("retract");
    setError(null);
    setNotice(null);
    const r = await retractFiling(view.jobId, view.state, note);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setRetracting(false);
    setNote("");
    setNotice("Filing retracted. The job is APPROVED again; mark it filed with the right details.");
    router.refresh();
  }

  async function markFiled() {
    setBusy("mark-filed");
    setError(null);
    setNotice(null);
    const r = await recordFiling(view.jobId, ack, f);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  async function recordClose(input: Pick<FilingForm, "turiaTaskRef" | "minutes">) {
    setBusy(view.action);
    setError(null);
    setNotice(null);
    const r = await recordTuriaClose(view.jobId, input);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    if (!r.done) setNotice("Turia close recorded. The job stays CLOSING until the close gate passes; what is missing is listed under Filing and close.");
    router.refresh();
  }

  /** The bar's buttons in FILED_BY_HUMAN / CLOSING: "Retract filing" (secondary, managers and partners) beside the primary. */
  const withRetract = (button: React.ReactNode) => (
    <div className="flex items-center gap-2 ml-auto">
      {view.canRetract && (
        <Button
          variant="warn"
          disabled={!!busy}
          onClick={() => {
            setRetracting(true);
            setError(null);
            setNotice(null);
          }}
        >
          Retract filing
        </Button>
      )}
      {button}
    </div>
  );
  const refField = (label: string, required: boolean) => (
    <label htmlFor={`${id}-ref`} className={`${fieldLabel} w-full sm:w-[200px]`}>
      {label}
      <input id={`${id}-ref`} value={f.turiaTaskRef} onChange={set("turiaTaskRef")} maxLength={100} required={required} autoComplete="off" className={`${field} ${focusRing}`} />
    </label>
  );
  const minutesField = (label: string, required: boolean) => (
    <label htmlFor={`${id}-min`} className={`${fieldLabel} w-full sm:w-[160px]`}>
      {label}
      <input id={`${id}-min`} type="number" min={1} max={6000} step={1} inputMode="numeric" value={f.minutes} onChange={set("minutes")} required={required} className={`${field} ${focusRing}`} />
    </label>
  );
  const messages = (
    <>
      {error && (
        <p role="alert" className={`${errorText} w-full`}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-[13px] text-ink-soft w-full">
          {notice}
        </p>
      )}
    </>
  );

  if (view.action === "mark-filed") {
    return (
      <>
        <p className="text-[13px] text-ink-soft w-full">
          <span className="font-bold text-ink">Filed by you on the portal — record the acknowledgement here.</span>{" "}
          {view.hasFinal ? "Pack approved and in Final." : "Pack approved; no Final file is recorded yet, and the job cannot close without one."} Firm OS never files anything.
        </p>
        <p id={`${id}-filed`} className="text-[12px] text-ink-mute w-full">
          Mark filed records the filing against your name and moves the job on to closing. Only a manager or partner can retract it afterwards, with a note.
        </p>
        <label htmlFor={`${id}-ack`} className={`${fieldLabel} w-full sm:w-[240px]`}>
          {ack.label} {ack.required ? "(required)" : "(optional)"}
          <input id={`${id}-ack`} value={f.ackRef} onChange={set("ackRef")} maxLength={64} required={ack.required} autoComplete="off" className={`${field} font-mono ${focusRing}`} />
        </label>
        {refField("Turia task ref (optional)", false)}
        {minutesField("Minutes logged in Turia (optional)", false)}
        <Button variant="primary" busy={!!busy} disabled={ack.required && !f.ackRef.trim()} onClick={markFiled} aria-describedby={`${id}-filed`} className="ml-auto">
          Mark filed
        </Button>
        {messages}
      </>
    );
  }

  // "Retract filing", second step: the note (required) and what retracting does, then Confirm
  // retraction. The Turia close form and its primary button step aside until Cancel.
  if (view.canRetract && retracting) {
    return (
      <>
        <label htmlFor={`${id}-note`} className={`${fieldLabel} w-full sm:w-[420px]`}>
          Why is the filing being retracted? (required)
          <textarea id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} required autoFocus className={`${field} ${focusRing}`} />
        </label>
        <p id={`${id}-retract`} className="text-[13px] text-ink-soft w-full sm:w-auto sm:max-w-[520px]">
          {retractConsequence(ack, view.ackRef)}
        </p>
        <div className="flex items-center gap-2 ml-auto">
          <Button
            disabled={!!busy}
            onClick={() => {
              setRetracting(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button variant="warn" busy={busy === "retract"} disabled={!!busy || !note.trim()} onClick={retract} aria-describedby={`${id}-retract`}>
            Confirm retraction
          </Button>
        </div>
        {messages}
      </>
    );
  }

  if (view.action === "retry-close") {
    return (
      <>
        <p className="text-[13px] text-ink-soft">
          Turia close recorded ({view.turia.ref}, {view.turia.minutes} min). The job closes when every check under Filing and close passes.
        </p>
        {withRetract(
          <Button variant="primary" busy={!!busy} onClick={() => recordClose({ turiaTaskRef: view.turia.ref ?? "", minutes: String(view.turia.minutes ?? "") })}>
            Check again
          </Button>,
        )}
        {messages}
      </>
    );
  }

  return (
    <>
      <p className="text-[13px] text-ink-soft w-full">
        <span className="font-bold text-ink">Close the task in Turia yourself</span> — log your minutes and mark it complete there — then record the Turia task ref and minutes here.
        {view.ackRef && ` Filed with ${ack.label} ${view.ackRef}.`}
      </p>
      {refField("Turia task ref", true)}
      {minutesField("Minutes logged in Turia", true)}
      {withRetract(
        <Button variant="primary" busy={!!busy} disabled={!f.turiaTaskRef.trim() || !f.minutes.trim()} onClick={() => recordClose(f)}>
          Record Turia close
        </Button>,
      )}
      {messages}
    </>
  );
}

// ------------------------------------------------------------------ bottom bar

/** What the bar says when this person has no action (never a file, submit or send action). */
const IDLE: Partial<Record<JobTaskState, string>> = {
  ASSIGNED: "Assigned. The preparer runs the agent when the documents are ready.",
  IN_PREP: "In preparation. The preparer runs the agent again when the documents are ready.",
  AGENT_DONE: "The agent has prepared the pack. The preparer checks it and submits it for review, or re-runs the agent with a note.",
  IN_REVIEW: "Submitted for review. The reviewer approves the pack or requests changes.",
  APPROVED: "Pack approved and in Final. A person files it on the portal and records the acknowledgement.",
  FILED_BY_HUMAN: "Filed by a person on the portal. The job closes when the Final file and the Turia close are confirmed.",
  CLOSING: "Filed by a person on the portal. The job closes when the Final file and the Turia close are confirmed.",
  DONE: "Done: filed, Final file in SharePoint and the Turia task closed.",
};
const IDLE_APPROVED_NO_FINAL = "Pack approved; no Final file is recorded yet. A person files it on the portal and records the acknowledgement.";

/** What "Approve pack" does, shown before the approval is sent (it cannot be undone from this screen). */
export function approveConsequence(deliverables: number): string {
  const copy =
    deliverables === 0
      ? "This run has no files to copy to Final."
      : `It copies ${deliverables === 1 ? "the file" : `the ${deliverables} files`} to Final as a new version (nothing is overwritten).`;
  return `Approving moves the job to APPROVED. ${copy} A person then files it on the portal; Firm OS never files anything.`;
}

/** What "Re-run with a note" does, shown with the note box before the re-run is sent. */
export const RERUN_CONSEQUENCE =
  "Re-running moves the job back to IN_PREP and starts a new agent run with your note. This run is kept for the record; submit the new run for review when it is ready.";

const RERUN_NOTE_MIN = 3; // as the route's schema (rerunZ)

/** Body for "Re-run with a note": the note is required (at least 3 characters, as the route asks). */
export function rerunBody(note: string): { ok: true; body: { note: string } } | Fail {
  const n = note.trim();
  return n.length < RERUN_NOTE_MIN ? { ok: false, error: "Say why the agent is being re-run" } : { ok: true, body: { note: n } };
}

/** POST /rerun: AGENT_DONE → IN_PREP with the note, then a new run; returns the new run's id. */
export async function requestRerun(runId: string, note: string, send: Send = call): Promise<{ ok: true; runId: string } | Fail> {
  const b = rerunBody(note);
  if (!b.ok) return b;
  const r = await send(`/api/firm-os/agents/runs/${encodeURIComponent(runId)}/rerun`, b.body);
  if (!r.ok) return { ok: false, error: r.error ?? "Something went wrong" };
  return { ok: true, runId: String(r.data.runId ?? "") };
}

export function ActionBar({
  agent,
  runId,
  jobId,
  jobState,
  actions,
  blockFails,
  deliverables = 0,
  closeLoop = null,
}: {
  agent: string;
  runId: string;
  jobId: string;
  jobState: JobTaskState;
  actions: RunReview["actions"];
  blockFails: number;
  /** Working files the run produced (what approval copies to Final). */
  deliverables?: number;
  closeLoop?: CloseLoopView | null;
}) {
  const router = useRouter();
  const id = useId();
  const [mode, setMode] = useState<"idle" | "changes" | "approve" | "rerun">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/firm-os/agents/runs/${encodeURIComponent(runId)}`;

  async function go(url: string, body?: unknown, after?: (data: Record<string, unknown>) => void) {
    setBusy(true);
    setError(null);
    const r = await call(url, body);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    setNote("");
    if (after) return after(r.data); // navigating: stay busy so nothing is sent twice
    setBusy(false);
    setMode("idle");
    router.refresh();
  }

  async function rerun() {
    setBusy(true);
    setError(null);
    const r = await requestRerun(runId, note);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    setNote("");
    router.push(`/agents/${agent}/runs/${r.runId}`); // navigating: stay busy so nothing is sent twice
  }

  const noteBox = (label: string) => (
    <label htmlFor={`${id}-n`} className={`flex flex-col gap-1 ${labelText} w-full sm:w-[420px]`}>
      {label}
      <textarea id={`${id}-n`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className={`${field} ${focusRing}`} autoFocus />
    </label>
  );

  let content: React.ReactNode;
  if (actions.approve || actions.requestChanges) {
    content = (
      <>
        {mode === "changes" && noteBox("What needs to change? The agent re-runs with this note.")}
        {mode === "approve" && actions.approveNeedsNote && noteBox(`Partner note: approving over ${blockFails} block finding(s)`)}
        {mode === "approve" && (
          <p id={`${id}-approve`} className="text-[13px] text-ink-soft w-full sm:w-auto sm:max-w-[520px]">
            {approveConsequence(deliverables)}
          </p>
        )}
        {mode === "idle" && !actions.approve && blockFails > 0 && jobState === "IN_REVIEW" && (
          <p className="text-[13px] text-ink-soft">
            {blockFails} block finding{blockFails === 1 ? "" : "s"}: only a partner can approve over {blockFails === 1 ? "it" : "them"}. Request changes, or ask a partner to review.
          </p>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {mode !== "idle" && (
            <Button onClick={() => setMode("idle")}>Cancel</Button>
          )}
          {actions.requestChanges && mode !== "approve" && (
            <Button
              variant="warn"
              busy={busy && mode === "changes"}
              disabled={busy || (mode === "changes" && note.trim().length < 3)}
              onClick={() => (mode === "changes" ? go(`${base}/request-changes`, { note }, (d) => router.push(`/agents/${agent}/runs/${String(d.runId)}`)) : setMode("changes"))}
            >
              {mode === "changes" ? "Request changes and re-run" : "Request changes"}
            </Button>
          )}
          {actions.approve && mode !== "changes" && (
            // First click shows what approval does (and the partner note box when needed); the second sends it.
            <Button
              variant="primary"
              busy={busy && mode === "approve"}
              disabled={busy || (mode === "approve" && actions.approveNeedsNote && !note.trim())}
              onClick={() => (mode !== "approve" ? setMode("approve") : go(`${base}/approve`, { note: note || null }))}
              aria-describedby={mode === "approve" ? `${id}-approve` : undefined}
            >
              {mode === "approve" ? "Confirm approval" : "Approve pack"}
            </Button>
          )}
        </div>
      </>
    );
  } else if (actions.submit || actions.rerun) {
    // Submit for review is the one primary action; "Re-run with a note" is secondary. Its first click
    // opens the note box and says what a re-run does; the second sends it (note required).
    content = (
      <>
        {mode === "rerun" && noteBox("Why re-run? The agent runs again with this note.")}
        {mode === "rerun" && (
          <p id={`${id}-rerun`} className="text-[13px] text-ink-soft w-full sm:w-auto sm:max-w-[520px]">
            {RERUN_CONSEQUENCE}
          </p>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {mode === "rerun" && (
            <Button onClick={() => setMode("idle")}>Cancel</Button>
          )}
          {actions.rerun && (
            <Button
              variant="warn"
              busy={busy && mode === "rerun"}
              disabled={busy || (mode === "rerun" && !rerunBody(note).ok)}
              onClick={() => (mode === "rerun" ? rerun() : setMode("rerun"))}
              aria-describedby={mode === "rerun" ? `${id}-rerun` : undefined}
            >
              {mode === "rerun" ? "Re-run agent with this note" : "Re-run with a note"}
            </Button>
          )}
          {actions.submit && mode !== "rerun" && (
            <Button variant="primary" busy={busy} onClick={() => go(`${base}/submit`)}>
              Submit for review
            </Button>
          )}
        </div>
      </>
    );
  } else if (actions.finalize) {
    content = (
      <>
        <p className="text-[13px] text-ink-soft">Approved, but the files are not in Final yet.</p>
        <Button variant="primary" busy={busy} onClick={() => go(`${base}/finalize`)} className="ml-auto">
          Copy to Final
        </Button>
      </>
    );
  } else if (actions.run) {
    content = (
      <>
        <p className="text-[13px] text-ink-soft">The job is back in preparation. Run the agent again when the documents are ready.</p>
        <Button
          variant="primary"
          busy={busy}
          onClick={() => go(`/api/firm-os/agents/${encodeURIComponent(agent)}/jobs/${encodeURIComponent(jobId)}/run`, undefined, (d) => router.push(`/agents/${agent}/runs/${String(d.runId)}`))}
          className="ml-auto"
        >
          Run agent
        </Button>
      </>
    );
  } else if (closeLoop?.action) {
    content = <CloseLoopActions view={closeLoop} />;
  } else {
    const idle = jobState === "APPROVED" && closeLoop && !closeLoop.hasFinal ? IDLE_APPROVED_NO_FINAL : IDLE[jobState];
    content = <p className="text-[13px] text-ink-mute">{idle ?? "No action for you on this job right now."}</p>;
  }

  // Sticky, not fixed: the bar sticks to the bottom of the window while the page scrolls but keeps
  // its own place at the end, so a tall bar never hides the last panels. On a phone it is not sticky
  // at all (the Mark filed form would cover most of the screen); it sits at the end of the page.
  // It bleeds to the edges of the layout's padding, and scrolls itself if taller than 70vh.
  return (
    <div className={`sticky max-sm:static bottom-0 z-20 ${pageBleed} -mb-8 mt-8 max-h-[70vh] max-sm:max-h-none overflow-y-auto border-t border-border bg-card/95 backdrop-blur`} role="region" aria-label="Review actions">
      <div className={`${pageGutter} py-3 flex items-end gap-3 flex-wrap`}>
        {content}
        {error && (
          <p role="alert" className={`${errorText} w-full`}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
