// Pieces shared by /focus and /workspace/[jobId]: the SOP steps with the current one marked, the
// "before you move on" checklist, open questions and the portal note. Server components; classes
// from src/components/ui.ts and src/app/agents/parts.tsx, nothing restyled per page.
import { CheckCircle2, Circle, CircleHelp, Info } from "lucide-react";
import { sectionTitle } from "@/app/agents/parts";
import type { NextTask } from "@/lib/workspace/contract";

type Steps = NextTask["sopSteps"];

/** Numbered SOP steps; the current one carries aria-current="step" and a "Now" label. */
export function SopStepsList({ steps, headingId }: { steps: Steps; headingId: string }) {
  return (
    <>
      <h2 id={headingId} className={sectionTitle}>
        SOP steps
      </h2>
      <ol className="space-y-2">
        {steps.map((s) => {
          const current = s.status === "current";
          const done = s.status === "done";
          return (
            <li
              key={s.number}
              aria-current={current ? "step" : undefined}
              className={`flex items-start gap-3 rounded-lg px-3 py-2.5 border ${current ? "border-brand-200 bg-brand-50" : "border-transparent"}`}
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 w-6 h-6 shrink-0 rounded-full grid place-items-center text-[12px] font-bold tabular-nums ${
                  current ? "bg-brand-500 text-white" : done ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-muted text-ink-soft"
                }`}
              >
                {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.number}
              </span>
              <span className="min-w-0">
                <span className={`block text-[13.5px] ${current ? "font-bold text-ink" : done ? "font-semibold text-ink-soft" : "font-semibold text-ink"}`}>
                  <span className="sr-only">Step {s.number}{current ? ", current step" : done ? ", done" : ""}: </span>
                  {s.title}
                  {current && <span className="ml-2 text-[11px] font-bold uppercase tracking-wide text-brand-700" aria-hidden="true">Now</span>}
                </span>
                {(current || !done) && <span className="block text-[12.5px] text-ink-mute mt-0.5">{s.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function ChecklistList({ items, headingId }: { items: string[]; headingId: string }) {
  return (
    <>
      <h2 id={headingId} className={sectionTitle}>
        Before you move on
      </h2>
      <ul className="space-y-2">
        {items.map((t) => (
          <li key={t} className="flex items-start gap-2.5 text-[13.5px]">
            <Circle className="w-4 h-4 mt-0.5 shrink-0 text-ink-mute" aria-hidden="true" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function OpenQuestionsList({ questions, headingId }: { questions: NextTask["openQuestions"]; headingId: string }) {
  return (
    <>
      <h2 id={headingId} className={sectionTitle}>
        Open questions
      </h2>
      <ul className="space-y-2">
        {questions.map((q) => (
          <li key={q.ruleId} className="flex items-start gap-2.5 text-[13.5px]">
            <CircleHelp className="w-4 h-4 mt-0.5 shrink-0 text-amber-800" aria-hidden="true" />
            <span className="min-w-0">
              {q.question}
              <span className="block text-[11.5px] text-ink-mute">
                {q.clientRequest ? "Ask the client for this document" : q.kind === "model-disagreement" ? "Two reads disagreed: decide it yourself" : "Outside this agent's scope: check it by hand"}
                {q.location ? ` · ${q.location}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Plain note for portal-filed jobs: no links, no embedding (the firm never automates portals). */
export function PortalNote({ note }: { note: string }) {
  return (
    <p className="flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 text-sky-800 px-4 py-3 text-[13px]" role="note">
      <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
      <span>{note}</span>
    </p>
  );
}

/** "Internal due 02 Nov 2026 · Statutory due 11 Nov 2026", or that no date is set. */
export function DueLine({ internalDue, statutoryDue, overdue }: { internalDue: string | null; statutoryDue: string | null; overdue: boolean }) {
  const parts = [internalDue ? `Internal due ${internalDue}` : null, statutoryDue ? `Statutory due ${statutoryDue}` : null].filter(Boolean);
  return (
    <p className="text-[13px] text-ink-mute tabular-nums">
      {parts.length ? parts.join(" · ") : "No due date set"}
      {overdue && <span className="ml-2 font-bold text-rose-700">Overdue</span>}
    </p>
  );
}
