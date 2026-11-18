// Reviewer view model for ADR-008 outcomes (pure). A checklist rule the framework settled as `na`
// with a question flag — the model abstained (insufficient-evidence), two reads disagreed
// (model-disagreement), or the agent's scope does not own the rule (out-of-scope) — is an open
// question for the reviewer; an abstention is also a document to request from the client.
// Wire: loadRunReview (src/lib/agents/views.ts) exposes `openQuestions`; the run review page
// (src/app/agents/[agent]/runs/[id]/page.tsx) should render them next to the checklist.

export type QuestionKind = "insufficient-evidence" | "model-disagreement" | "out-of-scope";

export type OpenQuestion = {
  ruleId: string;
  kind: QuestionKind;
  /** What to ask or decide (the result message). */
  question: string;
  /** Where the documents point, when the model cited one. */
  location: string | null;
  /** True for abstentions: the answer is a document to ask the client for. */
  clientRequest: boolean;
};

const ORDER: Record<QuestionKind, number> = { "insufficient-evidence": 0, "model-disagreement": 1, "out-of-scope": 2 };

/** Open questions from checklist rows (ChecklistView or ChecklistResultItem shaped), abstentions first. */
export function openQuestions(rows: readonly { ruleId: string; message: string; flags: readonly string[]; location?: string | null; evidence?: { location?: string } | null }[]): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  for (const r of rows) {
    const kind = (["insufficient-evidence", "model-disagreement", "out-of-scope"] as const).find((k) => r.flags.includes(k));
    if (!kind) continue;
    out.push({ ruleId: r.ruleId, kind, question: r.message, location: r.location ?? r.evidence?.location ?? null, clientRequest: kind === "insufficient-evidence" });
  }
  return out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.ruleId.localeCompare(b.ruleId));
}
