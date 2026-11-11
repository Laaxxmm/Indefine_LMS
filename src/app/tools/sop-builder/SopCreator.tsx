"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Sparkles, Loader2, AlertTriangle, CheckCircle2, Wand2 } from "lucide-react";
import { MAX_SUB_PROCESSES, type SopBrief, type SopAnalysis } from "@/lib/sop/types";
import { departmentLabel } from "@/lib/sop/labels";
import { userMessage } from "@/lib/errors";

const DEPARTMENTS = ["AUDIT", "TAX", "ACCOUNTS", "ROC", "TECH", "ADMIN", "GENERAL"];
const input = "w-full rounded-lg border border-border bg-page/60 px-3 py-2 text-[13.5px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400 transition";
const linesToArr = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function SopCreator({ defaultDepartment, lockDepartment, editSopId, initial }: { defaultDepartment: string; lockDepartment?: boolean; editSopId?: string; initial?: { title: string; workCategory: string; purpose: string; rawProcedure: string; department: string } }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [department, setDepartment] = useState(initial?.department ?? defaultDepartment);
  const [workCategory, setWorkCategory] = useState(initial?.workCategory ?? "");
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [rawProcedure, setRawProcedure] = useState(initial?.rawProcedure ?? "");

  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [brief, setBrief] = useState<SopBrief | null>(null);
  // What the description left unsaid, and the author's answers (by question index).
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  async function analyze() {
    setError(null);
    setRejected(null);
    setBrief(null);
    setQuestions([]);
    setAnswers({});
    if (rawProcedure.trim().length < 10) {
      setError("Describe the procedure in at least a sentence or two.");
      return;
    }
    setAnalyzing(true);
    try {
      const res = await fetch("/api/tools/sop-builder/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, department, workCategory, purpose, rawProcedure }) });
      const data = (await res.json()) as SopAnalysis & { error?: string };
      if (!res.ok) { setError(data.error || "The SOP draft could not be prepared. Try again in a minute."); return; }
      if (!data.valid || !data.brief) { setRejected(data.reason || "This doesn't look like a valid SOP request for the firm."); return; }
      // Granted editors are locked to their own department — never let the AI reassign it.
      setBrief(lockDepartment ? { ...data.brief, department: defaultDepartment } : data.brief);
      setQuestions(data.questions ?? []);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setAnalyzing(false);
    }
  }

  async function generate() {
    if (!brief) return;
    setError(null);
    // The list fields keep blank lines while being typed; tidy them only now.
    const tidy = (a?: string[]) => linesToArr((a ?? []).join("\n"));
    const confirmed = { ...brief, keySteps: tidy(brief.keySteps), rolesInvolved: tidy(brief.rolesInvolved), references: tidy(brief.references), subProcesses: tidy(brief.subProcesses) };
    if (confirmed.subProcesses.length > MAX_SUB_PROCESSES) {
      setError(`Keep it to ${MAX_SUB_PROCESSES} sub-processes. Merge some, or split this into two SOPs.`);
      return;
    }
    // Answers travel with the description, so they are kept for the next version too.
    const answered = questions.map((q, i) => ({ q, a: (answers[i] ?? "").trim() })).filter((x) => x.a);
    const described = answered.length ? `${rawProcedure}\n\nClarifications from the author:\n${answered.map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n")}` : rawProcedure;
    if (described.length > 50_000) {
      setError("The description and your answers are too long together. Shorten them to under 50,000 characters.");
      return;
    }
    setGenerating(true);
    try {
      const url = editSopId ? `/api/tools/sop-builder/sops/${editSopId}/versions` : "/api/tools/sop-builder/sops";
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: confirmed, rawProcedure: described, purpose }) });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) { setError(data.error || "The SOP could not be generated. Try again in a minute."); return; }
      router.push(`/tools/sop-builder/${data.id}`);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <button onClick={() => (editSopId ? router.push(`/tools/sop-builder/${editSopId}`) : router.push("/tools/sop-builder"))} className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4">
        <ArrowLeft className="w-4 h-4" /> {editSopId ? "Back to SOP" : "All SOPs"}
      </button>
      <h1 className="font-display font-extrabold text-2xl sm:text-[28px] tracking-[-0.02em] mb-1">{editSopId ? "New version" : "New SOP"}</h1>
      <p className="text-ink-mute text-[14px] mb-6">Explain the work the way you would to a new joiner on their first day. The AI checks it&apos;s in scope, drafts a brief, asks about anything you left out, then writes the SOP one small step at a time.</p>

      {/* Step 1 — input */}
      <section className="rounded-2xl bg-card border border-border shadow-lift p-5 mb-4">
        <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase mb-3.5">Your input</h2>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
          <Field label="Working title"><input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Monthly bank reconciliation" /></Field>
          <Field label="Department">
            <select className={`${input} disabled:opacity-70 disabled:cursor-not-allowed`} value={department} onChange={(e) => setDepartment(e.target.value)} disabled={lockDepartment}>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}
            </select>
            {lockDepartment && <span className="block text-[11px] text-ink-faint mt-1">You can author SOPs for your department only.</span>}
          </Field>
          <Field label="Work category"><input className={input} value={workCategory} onChange={(e) => setWorkCategory(e.target.value)} placeholder="e.g. Statutory audit" /></Field>
          <Field label="Purpose (optional)"><input className={input} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Why this SOP exists" /></Field>
          <div className="sm:col-span-2">
            <Field label="Describe the procedure" required>
              <textarea className={input} rows={12} value={rawProcedure} onChange={(e) => setRawProcedure(e.target.value)} placeholder="Start from the very first click. Which software and screen, what you type and where that comes from, where files are saved and how they are named, who checks it, and what you do when something does not match. Long is good." />
              <span className="block text-[11px] text-ink-faint mt-1">Do not type passwords or OTPs. Anything that looks like one is removed.</span>
            </Field>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={analyze} disabled={analyzing || generating} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:bg-ink-faint text-white text-sm font-bold shadow-pop transition">
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {brief ? "Re-analyze" : "Analyze"}
          </button>
          {error && <span className="text-[13px] text-rose-600 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</span>}
        </div>
      </section>

      {rejected && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 mb-4 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 mt-0.5 shrink-0" />
          <div className="text-[13px] text-rose-800"><p className="font-bold mb-0.5">Not generated — out of scope</p><p>{rejected}</p></div>
        </div>
      )}

      {/* Step 2 — confirm brief */}
      {brief && (
        <section className="rounded-2xl bg-card border border-border shadow-lift p-5 animate-fade-in">
          <div className="flex items-center gap-2 mb-3.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <h2 className="text-[10.5px] font-extrabold tracking-[0.12em] text-ink-faint uppercase">Confirm the brief · edit anything before generating</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3.5">
            <Field label="Title"><input className={input} value={brief.title} onChange={(e) => setBrief({ ...brief, title: e.target.value })} /></Field>
            <Field label="Department">
              <select className={`${input} disabled:opacity-70 disabled:cursor-not-allowed`} value={brief.department} onChange={(e) => setBrief({ ...brief, department: e.target.value })} disabled={lockDepartment}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{departmentLabel(d)}</option>)}
              </select>
            </Field>
            <Field label="Work category"><input className={input} value={brief.workCategory} onChange={(e) => setBrief({ ...brief, workCategory: e.target.value })} /></Field>
            <Field label="Objective"><input className={input} value={brief.objective} onChange={(e) => setBrief({ ...brief, objective: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Scope"><textarea className={input} rows={2} value={brief.scope} onChange={(e) => setBrief({ ...brief, scope: e.target.value })} /></Field></div>
            <div className="sm:col-span-2"><Field label="Key steps (one per line)"><textarea className={input} rows={5} value={brief.keySteps.join("\n")} onChange={(e) => setBrief({ ...brief, keySteps: e.target.value.split("\n") })} /></Field></div>
            <div className="sm:col-span-2">
              <Field label="Sub-processes, in order (one per line)">
                <textarea className={input} rows={4} value={(brief.subProcesses ?? []).join("\n")} onChange={(e) => setBrief({ ...brief, subProcesses: e.target.value.split("\n") })} />
                <span className="block text-[11px] text-ink-faint mt-1">Each one is written out step by step. Up to {MAX_SUB_PROCESSES}.</span>
              </Field>
            </div>
            <Field label="Roles (one per line)"><textarea className={input} rows={3} value={brief.rolesInvolved.join("\n")} onChange={(e) => setBrief({ ...brief, rolesInvolved: e.target.value.split("\n") })} /></Field>
            <Field label="References (one per line)"><textarea className={input} rows={3} value={brief.references.join("\n")} onChange={(e) => setBrief({ ...brief, references: e.target.value.split("\n") })} /></Field>
          </div>
          {questions.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border">
              <h3 className="text-[13.5px] font-bold text-ink mb-0.5">Answer these to make every step clear</h3>
              <p className="text-[12px] text-ink-mute mb-3.5">The description does not say these. Anything you leave blank is marked &quot;to confirm&quot; in the SOP.</p>
              <div className="space-y-3.5">
                {questions.map((q, i) => (
                  <Field key={i} label={q}><textarea className={input} rows={2} value={answers[i] ?? ""} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })} /></Field>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 flex items-center gap-3">
            <button onClick={generate} disabled={generating || !brief.title.trim()} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-ink-faint text-white text-sm font-bold shadow-pop transition">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              Generate SOP
            </button>
            <span className="text-[11px] text-ink-faint">Saves a Word copy to the L&D drive and records you as the author.</span>
          </div>
        </section>
      )}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12.5px] font-bold text-ink-soft mb-1">{label}{required && <span className="text-rose-500 ml-0.5">*</span>}</span>
      {children}
    </label>
  );
}
