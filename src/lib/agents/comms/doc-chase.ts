// Documents to ask a client for, from an agent run (Phase 10 doc-chase). Two sources, both stored
// on the run's ChecklistResult rows:
//   - open questions the model abstained on (ADR-008 insufficient_evidence → clientRequest), via
//     core/guardrails/review.ts openQuestions();
//   - the agents' missing-document rules, whose message lists the documents after a colon,
//     separated by "; " (tax.missing-docs "Ask the client / staff for: …", audit.inputs-missing
//     "Not provided (listed under Pending information): …").
// Suggestions only: staff pick, edit and add items before the draft is made. Pure.
import { openQuestions } from "@/lib/agents/core/guardrails/review";
import { LIMITS } from "./types";

export type ChecklistRowLike = { ruleId: string; status: string; message: string; evidence?: unknown };

/** Rules whose failure message is a list of missing documents. */
export const MISSING_DOC_RULES = /(?:^|\.)(?:missing-docs|inputs-missing)$/;

const MAX_SUGGESTIONS = 20;

/** Trim to LIMITS.itemChars at a word boundary (staff can edit the text afterwards). */
export function fitItem(s: string): string {
  const v = s.replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
  if (v.length <= LIMITS.itemChars) return v;
  const cut = v.slice(0, LIMITS.itemChars - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), LIMITS.itemChars / 2)).trim()}…`;
}

export function docChaseSuggestions(rows: readonly ChecklistRowLike[]): string[] {
  const views = rows.map((r) => {
    const ev = (r.evidence ?? {}) as { location?: string; flags?: string[] };
    return { ruleId: r.ruleId, message: r.message, flags: Array.isArray(ev.flags) ? ev.flags : [], location: ev.location ?? null };
  });
  const out: string[] = [];
  for (const r of rows) {
    if (r.status !== "fail" || !MISSING_DOC_RULES.test(r.ruleId)) continue;
    const at = r.message.indexOf(": ");
    if (at < 0) continue;
    out.push(...r.message.slice(at + 2).split(/;\s*/));
  }
  for (const q of openQuestions(views)) if (q.clientRequest && q.question.trim()) out.push(q.question);
  const seen = new Set<string>();
  return out
    .map(fitItem)
    .filter((s) => {
      const k = s.toLowerCase();
      if (!s || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, MAX_SUGGESTIONS);
}
