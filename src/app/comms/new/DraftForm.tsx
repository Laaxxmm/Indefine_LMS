"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FirmService } from "@prisma/client";
import { btnGhost, call, card, errorText, field, formWidth, hintText, labelText } from "@/components/ui";
import { Button } from "@/components/firm-os";
import type { DraftContext, JobOption } from "@/lib/agents/comms/service";
import { COMMS_KINDS, COMMS_LANGUAGES, FIRM_SERVICES, KIND_LABELS, LANGUAGE_LABELS, LIMITS, type CommsKind, type CommsLanguage, type ReminderAsk } from "@/lib/agents/comms/types";
import { DEFAULT_MESSAGE } from "@/lib/errors";

const label = `flex flex-col gap-1 ${labelText}`;
const legend = labelText;
const hint = `${hintText} font-normal`;
/** Focus ring for checkboxes and radios (fields carry it in ui.ts field). */
const focusRing = "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2";

const KIND_HINT: Record<CommsKind, string> = {
  status: "Where the job stands, and its due date.",
  "doc-chase": "The documents you need, and the date you need them by.",
  "due-reminder": "The due date, with one ask: confirm, send documents, or pay.",
  "filing-completed": "The filing date and the acknowledgement number you recorded.",
  "query-response": "Your answer to the client's question, in plain words.",
};

const DEPARTMENT_NAMES: Record<FirmService, string> = { GST: "GST", ROC: "ROC / company law", IncomeTax: "Income tax", TDS: "TDS / TCS", Books: "Books and accounts", Audit: "Audit", Engagement: "Engagement" };

/** Why a kind cannot be drafted for the selected job (null = it can). */
function blocked(kind: CommsKind, job: JobOption | null): string | null {
  if (kind === "query-response") return null;
  if (!job) return "pick a job first";
  if (kind === "due-reminder" && job.filed) return "already filed";
  if (kind === "due-reminder" && !job.due) return "no due date recorded";
  if (kind === "filing-completed" && !(job.filed && job.hasAck)) return "mark the job filed with its ARN / SRN first";
  return null;
}

export function DraftForm({ ctx }: { ctx: DraftContext }) {
  const router = useRouter();
  const [jobId, setJobId] = useState(ctx.job?.id ?? "");
  const job = ctx.jobs.find((j) => j.id === jobId) ?? (ctx.job && ctx.job.id === jobId ? ctx.job : null);
  const [kind, setKind] = useState<CommsKind>(ctx.defaults.kind);
  const [language, setLanguage] = useState<CommsLanguage>(ctx.client.preferredLanguage);
  const [replyBy, setReplyBy] = useState(ctx.defaults.replyBy);
  const [items, setItems] = useState(ctx.suggestions.map((text) => ({ text, on: true })));
  const [extra, setExtra] = useState("");
  const [ask, setAsk] = useState<ReminderAsk>("confirm");
  const [amount, setAmount] = useState("");
  const [topic, setTopic] = useState("");
  const [answer, setAnswer] = useState("");
  const [department, setDepartment] = useState<FirmService>("GST");
  const [ids, setIds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const why = blocked(kind, job);
  const picked = items.filter((i) => i.on && i.text.trim());

  function addItem() {
    const t = extra.trim();
    if (!t) return;
    setItems([...items, { text: t.slice(0, LIMITS.itemChars), on: true }]);
    setExtra("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountInr = amount.trim() ? Number(amount.replace(/[₹,\s]/g, "")) : undefined;
    if (amountInr !== undefined && !(amountInr > 0)) return setError("The amount must be a number above ₹0");
    setBusy(true);
    const r = await call("/api/firm-os/comms/drafts", {
      kind,
      clientCode: ctx.client.code,
      jobId: jobId || undefined,
      runId: ctx.run && jobId === ctx.job?.id ? ctx.run.id : undefined,
      department: jobId ? undefined : department,
      language,
      replyBy: kind === "doc-chase" || kind === "due-reminder" ? replyBy : undefined,
      items: kind === "doc-chase" ? picked.map((i) => i.text.trim()) : undefined,
      ask: kind === "due-reminder" ? ask : undefined,
      amountInr: kind === "due-reminder" || kind === "filing-completed" ? amountInr : undefined,
      topic: kind === "query-response" ? topic : undefined,
      answer: kind === "query-response" ? answer : undefined,
      clientRequestedIds: ids,
    }).catch(() => ({ ok: false, error: "Could not reach the server", data: {} as Record<string, unknown> }));
    setBusy(false);
    if (r.ok && typeof r.data.href === "string") router.push(r.data.href);
    else setError(r.error ?? DEFAULT_MESSAGE);
  }

  return (
    <form onSubmit={submit} className={`${card} space-y-6 ${formWidth}`} aria-describedby={error ? "draft-error" : undefined}>
      {ctx.jobs.length > 0 && (
        <label className={label}>
          Job
          <select className={`${field} font-normal text-ink`} value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">No job (a general answer to the client)</option>
            {ctx.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset>
        <legend className={legend}>What is the message for?</legend>
        <div className="mt-2 grid sm:grid-cols-2 gap-2">
          {COMMS_KINDS.map((k) => {
            const no = blocked(k, job);
            return (
              <label key={k} className={`flex gap-3 rounded-lg border px-3 py-3 text-[13px] ${kind === k ? "border-brand-500 bg-brand-50" : "border-border"} ${no ? "opacity-60" : "cursor-pointer"}`}>
                <input type="radio" name="kind" value={k} checked={kind === k} disabled={!!no} onChange={() => setKind(k)} className={`mt-0.5 ${focusRing}`} />
                <span>
                  <span className="font-semibold">{KIND_LABELS[k]}</span>
                  <span className={`block ${hint}`}>{no ? `Not available: ${no}.` : KIND_HINT[k]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {kind === "doc-chase" && (
        <fieldset className="space-y-2">
          <legend className={legend}>
            Documents to ask for <span className={hint}>(at most {LIMITS.maxItems}; edit the wording as you like)</span>
          </legend>
          {items.length === 0 && <p className={hint}>No documents suggested by the agent run. Add them below.</p>}
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Include document ${i + 1}`}
                checked={it.on}
                onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))}
                className={focusRing}
              />
              <input
                className={field}
                aria-label={`Document ${i + 1}`}
                maxLength={LIMITS.itemChars}
                value={it.text}
                onChange={(e) => setItems(items.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input className={field} aria-label="Another document" placeholder="Another document, e.g. Bank statement for October 2026" maxLength={LIMITS.itemChars} value={extra} onChange={(e) => setExtra(e.target.value)} />
            <button type="button" className={`${btnGhost} shrink-0 h-10`} onClick={addItem}>
              Add
            </button>
          </div>
          {picked.length > LIMITS.maxItems && <p className={errorText}>Pick at most {LIMITS.maxItems}; draft a second message for the rest.</p>}
        </fieldset>
      )}

      {kind === "due-reminder" && (
        <fieldset>
          <legend className={legend}>The one thing the client should do</legend>
          <div className="mt-2 flex flex-wrap gap-4 text-[13px]">
            {(
              [
                ["confirm", "Confirm we may file"],
                ["documents", "Send pending documents"],
                ["payment", "Arrange the payment"],
              ] as [ReminderAsk, string][]
            ).map(([v, t]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="ask" value={v} checked={ask === v} onChange={() => setAsk(v)} className={focusRing} /> {t}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {(kind === "doc-chase" || kind === "due-reminder") && (
        <label className={label}>
          Reply needed by
          <input type="date" required className={`${field} font-normal text-ink max-w-[12rem]`} value={replyBy} onChange={(e) => setReplyBy(e.target.value)} />
        </label>
      )}

      {(kind === "due-reminder" || kind === "filing-completed") && (
        <label className={label}>
          {kind === "filing-completed" ? "Amount paid with the return (optional)" : ask === "payment" ? "Amount to pay" : "Amount payable (optional)"}{" "}
          <span className={hint}>₹, from the approved pack</span>
          <input inputMode="decimal" className={`${field} font-normal text-ink max-w-[14rem] tabular-nums`} placeholder="1,23,456.00" value={amount} onChange={(e) => setAmount(e.target.value)} required={kind === "due-reminder" && ask === "payment"} />
        </label>
      )}

      {kind === "query-response" && (
        <>
          {!jobId && (
            <label className={label}>
              Department
              <select className={`${field} font-normal text-ink max-w-[16rem]`} value={department} onChange={(e) => setDepartment(e.target.value as FirmService)}>
                {FIRM_SERVICES.map((d) => (
                  <option key={d} value={d}>
                    {DEPARTMENT_NAMES[d]}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={label}>
            The client asked about <span className={hint}>(a few words, e.g. &quot;GST on office rent&quot;)</span>
            <input className={`${field} font-normal text-ink`} maxLength={LIMITS.topicChars} required value={topic} onChange={(e) => setTopic(e.target.value)} />
          </label>
          <label className={label}>
            Your answer <span className={hint}>(at most {LIMITS.answerChars} characters; one ask at most)</span>
            <textarea className={`${field} font-normal text-ink font-sans`} rows={6} maxLength={LIMITS.answerChars} required value={answer} onChange={(e) => setAnswer(e.target.value)} />
          </label>
        </>
      )}

      <label className={label}>
        Language
        <select className={`${field} font-normal text-ink max-w-[12rem]`} value={language} onChange={(e) => setLanguage(e.target.value as CommsLanguage)}>
          {COMMS_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {LANGUAGE_LABELS[l]}
            </option>
          ))}
        </select>
        <span className={`block mt-1 ${hint}`}>
          The client&apos;s preferred language is {LANGUAGE_LABELS[ctx.client.preferredLanguage]}. A translation always keeps the English below it for you to check.
        </span>
      </label>

      <label className="flex items-start gap-3 text-[13px]">
        <input type="checkbox" checked={ids} onChange={(e) => setIds(e.target.checked)} className={`mt-0.5 ${focusRing}`} />
        <span>
          The client asked for their PAN or Aadhaar in this message <span className={hint}>(it is then shown masked to the last 4 characters; otherwise it is left out)</span>
        </span>
      </label>

      {error && (
        <p id="draft-error" className={errorText} role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <Button type="submit" variant="primary" busy={busy} busyLabel="Preparing…" disabled={!!why || (kind === "doc-chase" && (picked.length === 0 || picked.length > LIMITS.maxItems))}>
          Prepare draft
        </Button>
        <span className={hint}>Nothing is sent. You will see the draft first.</span>
      </div>
    </form>
  );
}
