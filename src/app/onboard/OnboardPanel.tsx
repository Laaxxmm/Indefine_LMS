"use client";

// /onboard client panel. One screen at a time, one primary action per screen:
//   describe → answer (≤ 5 questions) → plan preview ("Create") → progress (+ Turia checklists).
// Every action goes through /api/firm-os/onboard/* with the shared call() helper.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Loader2 } from "lucide-react";
import { btnGhost, btnPrimary, btnSm, call, card, errorText, field, h2 } from "@/components/ui";
import { istLabel } from "@/lib/ist";
import type { Question } from "@/lib/agents/onboarding/clarify";
import { summarizeJobs, type OnboardingPlan } from "@/lib/agents/onboarding/plan";
import type { SagaStep, StepStatus } from "@/lib/agents/onboarding/saga";
import type { RunView, TuriaItem } from "@/lib/agents/onboarding/service";
import { ENTITY_TYPES, FIELD_LABELS, SERVICE_LABELS, serviceLineLabel, type PartialSpec } from "@/lib/agents/onboarding/spec";

const API = "/api/firm-os/onboard";
const focusField = "focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500";
const focusBtn = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";
const input = `${field} ${focusField}`;
const label = "text-[11px] font-bold text-ink-mute";
const primary = `${btnPrimary} ${focusBtn} inline-flex items-center gap-2`;
const ghost = `${btnGhost} ${focusBtn} inline-flex items-center gap-1.5`;

/** DD MMM YYYY in IST. */
const day = (iso: string | null | undefined) => (iso ? istLabel(new Date(iso), { day: "2-digit", month: "short", year: "numeric" }) : null);

type Answers = Record<string, string | string[]>;
/** The action in flight (its button shows the spinner) and the last failure (shown beside the action that failed). */
type Busy = { key: string; text: string } | null;
type Failure = { key: string; text: string } | null;

function Spin({ busy, k, children }: { busy: Busy; k: string; children: React.ReactNode }) {
  return busy?.key === k ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {busy.text}</> : <>{children}</>;
}

function ErrorBox({ error, keys }: { error: Failure; keys: string[] }) {
  if (!error || !keys.includes(error.key)) return null;
  return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-[13px] mt-4">{error.text}</div>;
}

export function OnboardPanel({ initial }: { initial: RunView | null }) {
  const router = useRouter();
  const [run, setRun] = useState<RunView | null>(initial);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<Failure>(null);

  async function send(path: string, body: unknown, text: string, key: string = path): Promise<RunView | null> {
    setBusy({ key, text });
    setError(null);
    try {
      const r = await call(`${API}/${path}`, body);
      if (!r.ok) {
        setError({ key, text: r.error ?? "Something went wrong" });
        return null;
      }
      const next = r.data.run as RunView;
      setRun(next);
      router.replace(`/onboard?run=${encodeURIComponent(next.id)}`, { scroll: false });
      return next;
    } catch (e) {
      setError({ key, text: (e as Error).message });
      return null;
    } finally {
      setBusy(null);
    }
  }

  // A complete spec goes straight to the plan preview: one click less, nothing created yet.
  useEffect(() => {
    if (run && run.status === "DRAFT" && run.complete && !run.plan && !busy && !error) {
      void send("plan", { runId: run.id }, "Building the plan…");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the run changes
  }, [run]);

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="sr-only">{busy?.text ?? ""}</div>
      {!run && <Describe busy={busy} error={error} onStart={(prompt) => send("start", { prompt }, "Reading the sentence…")} />}
      {run && run.status === "DRAFT" && !run.plan && (
        <Clarify run={run} busy={busy} error={error} onAnswer={(answers, message) => send("answer", { runId: run.id, answers, message }, "Checking the answers…")} />
      )}
      {run && run.status === "DRAFT" && run.plan && (
        <PlanPreview plan={run.plan} busy={busy} error={error} onCreate={() => send("create", { runId: run.id }, "Creating…")} onEdit={() => setRun({ ...run, plan: null, complete: false })} />
      )}
      {run && run.status !== "DRAFT" && (
        <Progress
          run={run}
          busy={busy}
          error={error}
          onResume={() => send("resume", { runId: run.id }, "Resuming…")}
          onConfirm={(syncId, turiaRef, minutes) => send("turia-confirm", { runId: run.id, syncId, turiaRef, minutes }, "Recording…", `turia:${syncId}`)}
        />
      )}
      {run && (
        <p className="text-[12px] text-ink-mute">
          <button type="button" className={`underline hover:text-ink ${focusBtn} rounded`} onClick={() => { setRun(null); setError(null); router.replace("/onboard", { scroll: false }); }}>
            Start another client
          </button>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 1. describe

function Describe({ busy, error, onStart }: { busy: Busy; error: Failure; onStart: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState("");
  return (
    <form
      className={`${card} max-w-[640px]`}
      onSubmit={(e) => {
        e.preventDefault();
        if (prompt.trim().length >= 5) onStart(prompt.trim());
      }}
    >
      <h2 className={h2}>Describe the client</h2>
      <label htmlFor="onboard-prompt" className={`${label} block mb-1`}>Client in one sentence</label>
      <textarea
        id="onboard-prompt"
        rows={3}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        maxLength={2000}
        placeholder="Onboard Acme Pvt Ltd — private limited, GST monthly + ROC + books monthly, assign Priya, reviewer Ravi."
        className={`${input} resize-y`}
      />
      <p className="text-[12px] text-ink-mute mt-2">
        PAN, GSTIN, phone numbers and names are masked before any text reaches a cloud model.
      </p>
      <ErrorBox error={error} keys={["start"]} />
      <div className="mt-4">
        <button type="submit" disabled={!!busy || prompt.trim().length < 5} className={primary}>
          <Spin busy={busy} k="start">Continue</Spin>
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- 2. clarify

function specRows(spec: PartialSpec): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (spec.legalName) rows.push([FIELD_LABELS.legalName, spec.legalName]);
  if (spec.entityType) rows.push([FIELD_LABELS.entityType, ENTITY_TYPES[spec.entityType]]);
  if (spec.services?.length) rows.push([FIELD_LABELS.services, spec.services.map(serviceLineLabel).join(", ")]);
  if (spec.clientCode) rows.push([FIELD_LABELS.clientCode, spec.clientCode]);
  if (spec.fy) rows.push(["FY", spec.fy]);
  if (spec.assigneeName) rows.push([FIELD_LABELS.assigneeId, spec.assigneeName]);
  if (spec.reviewerName) rows.push([FIELD_LABELS.reviewerId, spec.reviewerName]);
  if (spec.pan) rows.push([FIELD_LABELS.pan, spec.pan]);
  if (spec.gstins?.length) rows.push([FIELD_LABELS.gstins, spec.gstins.join(", ")]);
  if (spec.cin) rows.push([FIELD_LABELS.cin, spec.cin]);
  if (spec.firstPeriod) rows.push([FIELD_LABELS.firstPeriod, spec.firstPeriod]);
  return rows;
}

function initialAnswers(questions: Question[]): Answers {
  const a: Answers = {};
  for (const q of questions) a[q.field] = q.kind === "services" ? [] : typeof q.defaultValue === "string" ? q.defaultValue : "";
  return a;
}

function Clarify({ run, busy, error, onAnswer }: { run: RunView; busy: Busy; error: Failure; onAnswer: (answers: Answers, message?: string) => void }) {
  const [answers, setAnswers] = useState<Answers>(() => initialAnswers(run.questions));
  const [message, setMessage] = useState("");
  useEffect(() => setAnswers(initialAnswers(run.questions)), [run.questions]);
  const rows = specRows(run.spec);
  const set = (k: string, v: string | string[]) => setAnswers((a) => ({ ...a, [k]: v }));
  const filled = Object.fromEntries(Object.entries(answers).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v.trim() !== "")));

  return (
    <div className="space-y-6">
      {(rows.length > 0 || run.notes.length > 0) && (
        <section className={`${card} max-w-[640px]`} aria-labelledby="understood">
          <h2 id="understood" className={h2}>Understood so far</h2>
          {run.notes.map((n) => <p key={n} className="text-[13px] text-amber-800 mb-2">{n}</p>)}
          {rows.length > 0 && (
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2 text-[13px]">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-mute">{k}</dt>
                  <dd className="font-semibold break-words">{v}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      )}

      <form
        className={`${card} max-w-[640px]`}
        onSubmit={(e) => {
          e.preventDefault();
          onAnswer(filled, message.trim() || undefined);
          setMessage("");
        }}
      >
        <h2 className={h2}>{run.questions.length ? `${run.questions.length} question${run.questions.length === 1 ? "" : "s"}` : "Anything to correct?"}</h2>
        {run.errors.length > 0 && (
          <ul className="mb-4 space-y-1">
            {run.errors.map((e) => <li key={e.field + e.message} className={errorText}>{e.message}</li>)}
          </ul>
        )}
        <div className="space-y-4">
          {run.questions.map((q) => <QuestionField key={q.field} q={q} value={answers[q.field]} onChange={(v) => set(q.field, v)} />)}
          <label className="flex flex-col gap-1">
            <span className={label}>Or say it in plain English (optional)</span>
            <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} placeholder="e.g. reviewer is Anita, books in Zoho" className={input} />
          </label>
        </div>
        {run.checks.length > 0 && (
          <p className="text-[12px] text-ink-mute mt-4">Checked by hand later: {run.checks.join(" ")}</p>
        )}
        <ErrorBox error={error} keys={["answer", "plan"]} />
        <div className="mt-4">
          <button type="submit" disabled={!!busy || (Object.keys(filled).length === 0 && !message.trim())} className={primary}>
            {busy?.key === "plan" ? <Spin busy={busy} k="plan">Continue</Spin> : <Spin busy={busy} k="answer">Continue</Spin>}
          </button>
        </div>
      </form>
    </div>
  );
}

function QuestionField({ q, value, onChange }: { q: Question; value: string | string[] | undefined; onChange: (v: string | string[]) => void }) {
  const id = `q-${q.field}`;
  const help = [q.help ? `${id}-help` : null, q.error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const text = typeof value === "string" ? value : "";
  const notes = (
    <>
      {q.help && <span id={`${id}-help`} className="text-[12px] text-ink-mute">{q.help}</span>}
      {q.error && <span id={`${id}-error`} className={errorText}>{q.error}</span>}
    </>
  );

  if (q.kind === "services") {
    const picked = Array.isArray(value) ? value : [];
    return (
      <fieldset aria-describedby={help}>
        <legend className={`${label} mb-1.5`}>{q.label}</legend>
        <div className="grid sm:grid-cols-2 gap-2">
          {(q.options ?? []).map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={picked.includes(o.value)}
                onChange={(e) => onChange(e.target.checked ? [...picked, o.value] : picked.filter((p) => p !== o.value))}
                className={`h-4 w-4 accent-brand-500 ${focusBtn}`}
              />
              {o.label}
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-1 mt-1">{notes}</div>
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={label}>{q.label}</label>
      {q.kind === "select" ? (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value)} aria-describedby={help} aria-invalid={!!q.error} className={input}>
          <option value="">Select…</option>
          {(q.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : q.kind === "gstins" ? (
        <textarea id={id} rows={2} value={text} onChange={(e) => onChange(e.target.value)} placeholder={q.placeholder} aria-describedby={help} aria-invalid={!!q.error} className={input} />
      ) : (
        <input
          id={id}
          type={q.kind === "email" ? "email" : q.kind === "tel" ? "tel" : q.kind === "month" ? "month" : "text"}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder={q.placeholder}
          aria-describedby={help}
          aria-invalid={!!q.error}
          className={input}
        />
      )}
      {notes}
    </div>
  );
}

// ---------------------------------------------------------------- 3. plan preview

function PlanPreview({ plan, busy, error, onCreate, onEdit }: { plan: OnboardingPlan; busy: Busy; error: Failure; onCreate: () => void; onEdit: () => void }) {
  const jobs = summarizeJobs(plan.jobs);
  return (
    <section className={`${card} max-w-3xl`} aria-labelledby="plan-title">
      <h2 id="plan-title" className={h2}>What will be created</h2>
      <p className="font-display font-bold text-xl">{plan.legalName} <span className="text-ink-mute font-semibold text-[15px]">· {plan.clientCode} · FY {plan.fy}</span></p>

      <ol className="mt-4 space-y-4 text-[13px]">
        <li>
          <p className="font-bold">LMS client record</p>
          <p className="text-ink-mute">
            {plan.lmsClient.action === "create" ? "A new client in /clients, linked to Firm OS with code " : `Link the existing client ${plan.lmsClient.existingName} to Firm OS with code `}
            <span className="font-semibold text-ink">{plan.clientCode}</span>.
          </p>
        </li>
        <li>
          <p className="font-bold">Turia ({plan.turia.mode === "MANUAL" ? "manual checklist" : plan.turia.mode})</p>
          <p className="text-ink-mute">
            Client, then {plan.engagements.map(serviceLineLabel).join(", ")}; {plan.turia.tasksNow} first-period task{plan.turia.tasksNow === 1 ? "" : "s"}.
            {plan.turia.mode === "MANUAL" && " Each comes as a numbered checklist to complete in Turia and confirm here."}
          </p>
        </li>
        <li>
          <p className="font-bold">SharePoint</p>
          <p className="text-ink-mute break-all">
            Site <span className="font-semibold text-ink">{plan.sharepoint.siteUrl}</span>, folders FY{plan.sharepoint.fy} for {plan.sharepoint.services.map((s) => SERVICE_LABELS[s]).join(", ")}.
          </p>
        </li>
        <li>
          <p className="font-bold">People</p>
          <p className="text-ink-mute">Assignee <span className="font-semibold text-ink">{plan.people.assignee.name}</span>, reviewer <span className="font-semibold text-ink">{plan.people.reviewer.name}</span>.</p>
        </li>
        <li>
          <p className="font-bold">{plan.jobs.length} jobs</p>
          <p className="text-ink-mute mb-2">{plan.plannerSource}.{plan.datesPending > 0 && ` ${plan.datesPending} without a date yet.`}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] tabular-nums">
              <thead className="text-[11px] uppercase tracking-wide text-ink-faint text-left">
                <tr>
                  <th scope="col" className="py-2 pr-3">Job</th>
                  <th scope="col" className="py-2 pr-3">Periods</th>
                  <th scope="col" className="py-2 pr-3">First statutory due</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={`${j.service}-${j.title}`} className="border-t border-border">
                    <td className="py-2 pr-3 font-semibold">{j.title} <span className="text-ink-mute font-normal">· {SERVICE_LABELS[j.service]}</span></td>
                    <td className="py-2 pr-3">{j.count === 1 ? j.periods[0] : `${j.periods[0]} – ${j.periods[j.periods.length - 1]} (${j.count})`}</td>
                    <td className="py-2 pr-3">{day(j.firstDue) ?? <span className="text-ink-mute">{j.note ?? "Pending"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </li>
        {plan.checks.length > 0 && (
          <li>
            <p className="font-bold">Checks by hand</p>
            <ul className="list-disc pl-5 text-ink-mute">{plan.checks.map((c) => <li key={c}>{c}</li>)}</ul>
          </li>
        )}
      </ol>

      <ErrorBox error={error} keys={["create"]} />
      <div className="mt-6 flex items-center gap-3">
        <button type="button" onClick={onCreate} disabled={!!busy} className={primary}>
          <Spin busy={busy} k="create">Create</Spin>
        </button>
        <button type="button" onClick={onEdit} disabled={!!busy} className={ghost}>Change answers</button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 4. progress

const CHIP: Record<StepStatus, string> = {
  done: "bg-emerald-100 text-emerald-800",
  running: "bg-brand-100 text-brand-800",
  waiting: "bg-amber-100 text-amber-800",
  blocked: "bg-amber-100 text-amber-800",
  failed: "bg-rose-100 text-rose-700",
  pending: "bg-muted text-ink-mute",
};
const CHIP_TEXT: Record<StepStatus, string> = { done: "Done", running: "Running", waiting: "Waiting on you", blocked: "Blocked", failed: "Failed", pending: "Not started" };

function StepRow({ step }: { step: SagaStep }) {
  return (
    <li className="py-3 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-[13.5px] flex items-center gap-2">
          {step.status === "done" && <Check className="w-4 h-4 text-emerald-700" aria-hidden />}
          {step.status === "running" && <Loader2 className="w-4 h-4 animate-spin text-brand-600" aria-hidden />}
          {(step.status === "failed" || step.status === "blocked") && <AlertTriangle className="w-4 h-4 text-amber-700" aria-hidden />}
          {step.label}
        </span>
        <span className={`shrink-0 px-1.5 py-[1px] rounded-md font-bold uppercase text-[9.5px] tracking-wide ${CHIP[step.status]}`}>{CHIP_TEXT[step.status]}</span>
      </div>
      {step.action && <p className="text-[12.5px] text-amber-800">{step.action}</p>}
      {step.status === "failed" && step.error && <p className={errorText}>{step.error}</p>}
    </li>
  );
}

function Progress({ run, busy, error, onResume, onConfirm }: { run: RunView; busy: Busy; error: Failure; onResume: () => void; onConfirm: (syncId: string, turiaRef: string, minutes: number | null) => void }) {
  const steps = run.steps ?? [];
  const summary = steps.find((s) => s.key === "summary")?.result as { clientUrl?: string | null; siteUrl?: string; jobTasks?: number; nextInternalDue?: { title: string; period: string; on: string } | null } | undefined;
  const canResume = run.status === "FAILED" || run.status === "BLOCKED";
  const open = run.turia.filter((t) => t.status === "CHECKLIST_ISSUED");
  const heading = { RUNNING: "Creating…", CONFIRMED: "Confirmed", FAILED: "Stopped at a failed step", BLOCKED: "Waiting on a person", DONE: "Onboarded" }[run.status as string] ?? run.status;

  return (
    <div className="space-y-6">
      <section className={`${card} max-w-3xl`} aria-labelledby="progress-title">
        <h2 id="progress-title" className={h2}>{run.plan ? `${run.plan.legalName} · ${run.plan.clientCode}` : "Progress"}</h2>
        <p className="font-display font-bold text-xl">{heading}</p>
        <ol className="mt-2 divide-y divide-border">{steps.map((s) => <StepRow key={s.key} step={s} />)}</ol>
        {run.status === "DONE" && summary && (
          <p className="text-[13px] text-ink-mute mt-3">
            {summary.jobTasks} jobs assigned.
            {summary.nextInternalDue && ` Next internal due: ${summary.nextInternalDue.title} ${summary.nextInternalDue.period} on ${day(summary.nextInternalDue.on)}.`}{" "}
            {summary.clientUrl && <a href={summary.clientUrl} className={`underline font-semibold text-ink ${focusBtn} rounded`}>Open client</a>}
            {summary.siteUrl && <> · <a href={summary.siteUrl} target="_blank" rel="noreferrer" className={`underline font-semibold text-ink ${focusBtn} rounded`}>SharePoint site</a></>}
          </p>
        )}
        <ErrorBox error={error} keys={["resume", "create"]} />
        {canResume && (
          <div className="mt-4">
            <button type="button" onClick={onResume} disabled={!!busy} className={primary}>
              <Spin busy={busy} k="resume">Retry</Spin>
            </button>
            <p className="text-[12px] text-ink-mute mt-2">Retry continues from the first step that is not done. Nothing already created is created twice.</p>
          </div>
        )}
      </section>

      {run.turia.length > 0 && (
        <section className="space-y-4 max-w-3xl" aria-labelledby="turia-title">
          <h2 id="turia-title" className={h2}>Turia — {open.length ? `${open.length} checklist${open.length === 1 ? "" : "s"} to complete` : "all confirmed"}</h2>
          {run.turia.map((t) => <TuriaCard key={t.syncId} item={t} busy={busy} error={error} onConfirm={onConfirm} />)}
        </section>
      )}
    </div>
  );
}

function CopyButton({ text, what }: { text: string; what: string }) {
  const [state, setState] = useState<"idle" | "copied" | "blocked">("idle");
  return (
    <button
      type="button"
      aria-label={`Copy ${what}`}
      className={`${ghost} ${btnSm}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("blocked"); // the value stays visible to select by hand
        }
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "copied" ? <Check className="w-3.5 h-3.5" aria-hidden /> : <Copy className="w-3.5 h-3.5" aria-hidden />}
      {state === "copied" ? "Copied" : state === "blocked" ? "Copy blocked: select the value" : "Copy"}
    </button>
  );
}

function TuriaCard({ item, busy, error, onConfirm }: { item: TuriaItem; busy: Busy; error: Failure; onConfirm: (syncId: string, turiaRef: string, minutes: number | null) => void }) {
  const [ref, setRef] = useState("");
  const [minutes, setMinutes] = useState("");
  const c = item.checklist;
  const done = item.status === "CONFIRMED" || item.status === "CLOSED";
  const needMinutes = !!c?.confirmWith.minutesRequired;
  const refId = `turia-ref-${item.syncId}`;
  const minId = `turia-min-${item.syncId}`;

  return (
    <article className={card} aria-labelledby={`turia-${item.syncId}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={`turia-${item.syncId}`} className="font-bold text-[14px]">{c?.title ?? item.operation}</h3>
        <span className={`shrink-0 px-1.5 py-[1px] rounded-md font-bold uppercase text-[9.5px] tracking-wide ${done ? CHIP.done : CHIP.waiting}`}>
          {done ? <>Done in Turia · <span className="normal-case">{item.turiaRef}</span></> : "To do"}
        </span>
      </div>
      {!done && c && (
        <>
          <ol className="mt-3 space-y-2 text-[13px]">
            {c.steps.map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="tabular-nums font-bold text-ink-mute w-5 shrink-0 text-right">{s.n}.</span>
                <div className="flex-1 min-w-0">
                  <p>{s.text}</p>
                  {s.values && (
                    <ul className="mt-1.5 space-y-1.5">
                      {s.values.map((v) => (
                        <li key={v.label + v.value} className="flex items-center gap-2 flex-wrap">
                          <span className="text-ink-mute text-[12px] w-32 shrink-0">{v.label}</span>
                          <code className="font-semibold bg-muted rounded px-2 py-0.5 break-all">{v.value}</code>
                          <CopyButton text={v.value} what={v.label} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <ErrorBox error={error} keys={[`turia:${item.syncId}`]} />
          <form
            className="mt-4 flex flex-wrap items-end gap-3 max-w-[640px]"
            onSubmit={(e) => {
              e.preventDefault();
              if (ref.trim()) onConfirm(item.syncId, ref.trim(), needMinutes ? Number(minutes) : null);
            }}
          >
            <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
              <label htmlFor={refId} className={label}>{c.confirmWith.turiaRefLabel}</label>
              <input id={refId} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={100} required className={input} />
            </div>
            {needMinutes && (
              <div className="flex flex-col gap-1 w-32">
                <label htmlFor={minId} className={label}>Minutes logged</label>
                <input id={minId} type="number" min={1} max={6000} step={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} required className={input} />
              </div>
            )}
            <button type="submit" disabled={!!busy || !ref.trim() || (needMinutes && !minutes)} className={ghost}>
              <Spin busy={busy} k={`turia:${item.syncId}`}>Done in Turia</Spin>
            </button>
          </form>
        </>
      )}
    </article>
  );
}
