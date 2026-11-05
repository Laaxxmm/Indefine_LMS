"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, Loader2 } from "lucide-react";
import type { JobTaskState } from "@prisma/client";
import { btnGhost, btnPrimary, btnWarn, call, card, errorText, field } from "@/components/ui";
import type { CommentView, DeliverableView, RunReview } from "@/lib/agents/views";
import { focusRing, sectionTitle } from "../../../parts";

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
    <section aria-labelledby="deliverables" className={card}>
      <h2 id="deliverables" className={sectionTitle}>
        Deliverables
      </h2>
      {deliverables.length === 0 ? (
        <p className="text-[13px] text-ink-mute">No files from this run.</p>
      ) : (
        <ul className="divide-y divide-border">
          {deliverables.map((d) => (
            <li key={d.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold break-all">{d.name}</p>
                <p className="text-[11.5px] text-ink-mute tabular-nums">
                  {d.kind} · v{d.version} · {d.size} · sha256 <span className="font-mono">{d.sha256.slice(0, 12)}…</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                {d.isSheet && (
                  <button type="button" onClick={() => show(d.id)} aria-expanded={open === d.id} className={`${btnGhost} ${focusRing} inline-flex items-center gap-1.5`}>
                    {busy && open !== d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Eye className="w-3.5 h-3.5" aria-hidden="true" />}
                    {open === d.id ? "Hide preview" : "Preview"}
                  </button>
                )}
                <a href={`/api/firm-os/agents/deliverables/${encodeURIComponent(d.id)}`} className={`${btnGhost} ${focusRing} inline-flex items-center gap-1.5`} download>
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
            <div role="tablist" aria-label="Sheets" className="flex gap-1 mb-2 flex-wrap">
              {preview.sheets.map((s, i) => (
                <button key={s.name} type="button" role="tab" aria-selected={i === sheet} onClick={() => setSheet(i)} className={`${i === sheet ? btnPrimary : btnGhost} ${focusRing}`}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
          <div className="overflow-auto max-h-[480px] rounded-lg border border-border" role="tabpanel" tabIndex={0} aria-label={`Preview of sheet ${current.name}`}>
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
          {current.truncated && <p className="text-[11.5px] text-ink-mute mt-1">Preview shows the first rows and columns; download the file for the rest.</p>}
        </div>
      )}
    </section>
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
    <section aria-labelledby={`${id}-h`} className={card}>
      <h2 id={`${id}-h`} className={sectionTitle}>
        Comments
      </h2>
      {comments.length === 0 ? (
        <p className="text-[13px] text-ink-mute mb-3">No comments yet.</p>
      ) : (
        <ul className="space-y-2 mb-3">
          {comments.map((c) => (
            <li key={c.id} className="text-[13px]">
              <p className="text-[11.5px] text-ink-mute">
                {c.author} · {c.at}
              </p>
              <p className="whitespace-pre-wrap">{c.text}</p>
            </li>
          ))}
        </ul>
      )}
      <label htmlFor={`${id}-t`} className="text-[11px] font-bold text-ink-mute">
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
        <button type="button" onClick={add} disabled={busy || !text.trim()} className={`${btnGhost} ${focusRing}`}>
          Add comment
        </button>
      </div>
    </section>
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

  const lbl = "flex flex-col gap-1 text-[11px] font-bold text-ink-mute";
  return (
    <section aria-labelledby={`${id}-h`} className={card}>
      <details>
        <summary className={`cursor-pointer rounded ${focusRing}`}>
          <h2 id={`${id}-h`} className={`${sectionTitle} inline mb-0`}>
            Log a missed or wrong finding
          </h2>
        </summary>
        {done ? (
          <p className="text-[13px] mt-3" role="status">
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
              <button type="button" onClick={submit} disabled={busy || !f.finding.trim()} className={`${btnGhost} ${focusRing}`}>
                Propose rule
              </button>
            </div>
          </div>
        )}
      </details>
    </section>
  );
}

// ------------------------------------------------------------------ bottom bar

export function ActionBar({
  agent,
  runId,
  jobId,
  jobState,
  actions,
  blockFails,
}: {
  agent: string;
  runId: string;
  jobId: string;
  jobState: JobTaskState;
  actions: RunReview["actions"];
  blockFails: number;
}) {
  const router = useRouter();
  const id = useId();
  const [mode, setMode] = useState<"idle" | "changes" | "approve">("idle");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/firm-os/agents/runs/${encodeURIComponent(runId)}`;

  async function go(url: string, body?: unknown, after?: (data: Record<string, unknown>) => void) {
    setBusy(true);
    setError(null);
    const r = await call(url, body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setMode("idle");
    setNote("");
    if (after) after(r.data);
    else router.refresh();
  }

  const spinner = busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />;
  const primary = `${btnPrimary} ${focusRing} inline-flex items-center gap-1.5`;
  const noteBox = (label: string) => (
    <label htmlFor={`${id}-n`} className="flex flex-col gap-1 text-[11px] font-bold text-ink-mute w-full sm:w-[420px]">
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
        <div className="flex items-center gap-2 ml-auto">
          {mode !== "idle" && (
            <button type="button" onClick={() => setMode("idle")} className={`${btnGhost} ${focusRing}`}>
              Cancel
            </button>
          )}
          {actions.requestChanges && mode !== "approve" && (
            <button
              type="button"
              disabled={busy || (mode === "changes" && note.trim().length < 3)}
              onClick={() => (mode === "changes" ? go(`${base}/request-changes`, { note }, (d) => router.push(`/agents/${agent}/runs/${String(d.runId)}`)) : setMode("changes"))}
              className={`${btnWarn} ${focusRing} inline-flex items-center gap-1.5`}
            >
              {mode === "changes" && spinner}
              {mode === "changes" ? "Request changes and re-run" : "Request changes"}
            </button>
          )}
          {actions.approve && mode !== "changes" && (
            <button
              type="button"
              disabled={busy || (mode === "approve" && actions.approveNeedsNote && !note.trim())}
              onClick={() => (actions.approveNeedsNote && mode !== "approve" ? setMode("approve") : go(`${base}/approve`, { note: note || null }))}
              className={primary}
            >
              {mode === "approve" && spinner}
              Approve pack
            </button>
          )}
        </div>
      </>
    );
  } else if (actions.submit) {
    content = (
      <button type="button" disabled={busy} onClick={() => go(`${base}/submit`)} className={`${primary} ml-auto`}>
        {spinner}Submit for review
      </button>
    );
  } else if (actions.finalize) {
    content = (
      <>
        <p className="text-[13px] text-ink-soft">Approved, but the files are not in Final yet.</p>
        <button type="button" disabled={busy} onClick={() => go(`${base}/finalize`)} className={`${primary} ml-auto`}>
          {spinner}Copy to Final
        </button>
      </>
    );
  } else if (actions.run) {
    content = (
      <>
        <p className="text-[13px] text-ink-soft">The job is back in preparation. Run the agent again when the documents are ready.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => go(`/api/firm-os/agents/${encodeURIComponent(agent)}/jobs/${encodeURIComponent(jobId)}/run`, undefined, (d) => router.push(`/agents/${agent}/runs/${String(d.runId)}`))}
          className={`${primary} ml-auto`}
        >
          {spinner}Run agent
        </button>
      </>
    );
  } else {
    content = (
      <p className="text-[13px] text-ink-mute">
        {jobState === "APPROVED" ? "Pack approved and in Final. A person files it on the portal and records the acknowledgement." : "No action for you on this job right now."}
      </p>
    );
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-card/95 backdrop-blur" role="region" aria-label="Review actions">
      <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-3 flex items-end gap-3 flex-wrap">
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
