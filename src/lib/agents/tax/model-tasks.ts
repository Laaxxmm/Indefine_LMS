// Tax model-task registry (ADR-008). The Tax agent may run exactly these tasks:
//
//   tax.match-ais@1                 AIS income lines → the books ledger that holds each (or
//                                   not_in_books / insufficient_evidence), with a verbatim quote
//   tax.check:tax.foreign-asset@1   the LLM checklist rule (prompt built by the framework runner)
//
// The model sees names and categories only — never amounts: comparing amounts is code's job.
// Validation is deterministic (ids exist, ledger nature fits the AIS category, quote copied from
// the cited line); invalid answers are dropped and become reviewer questions, never defaults.
import { z } from "zod";
import { LLM_CHECK_SYSTEM, LlmVerdictOutputSchema } from "@/lib/agents/core/runner";
import { EvidenceSchema, FIRM_PREAMBLE, INSUFFICIENT, quoteIn, type ModelTaskSpec } from "@/lib/agents/roc/grounding";
import { AIS_INCOME_CATEGORIES, isAisIncome, type AisMatch } from "./analyse";
import { TAX_RULESETS, type TaxRuleSet } from "./data";
import type { AisLine, OtherSource } from "./parse";

export function taxPreamble(rules: Pick<TaxRuleSet, "act" | "ay" | "fy">): string {
  return `${FIRM_PREAMBLE} Department: Indian income tax only — the ${rules.act}, assessment year ${rules.ay} (financial year ${rules.fy}). Do not answer questions about GST, company law or anything outside income tax.`;
}

export const AIS_OUTCOMES = ["matched", "not_in_books", INSUFFICIENT] as const;

export const AisMatchSchema = z.object({
  matches: z
    .array(
      z.object({
        aisId: z.string().trim().min(1).max(60),
        outcome: z.enum(AIS_OUTCOMES),
        bookId: z.string().trim().min(1).max(60).nullable(),
        evidence: EvidenceSchema,
      }),
    )
    .max(2000),
});
export type AisMatchOutput = z.infer<typeof AisMatchSchema>;

export type AisMatchContext = { ais: AisLine[]; books: OtherSource[] };

const aisLabel = (ais: AisLine[], line: AisLine) => `ais.csv row ${ais.indexOf(line) + 2}`;
const bookLabel = (books: OtherSource[], b: OtherSource) => `organiser.json otherSources[${books.indexOf(b)}]`;

/** The text the model is shown: labelled AIS income lines and books ledgers, without amounts. */
export function aisPrompt(ctx: AisMatchContext): { aisLines: Map<string, { label: string; text: string; line: AisLine }>; bookLines: Map<string, { label: string; text: string; book: OtherSource }>; text: string } {
  const aisLines = new Map<string, { label: string; text: string; line: AisLine }>();
  for (const l of ctx.ais.filter((x) => isAisIncome(x.category))) {
    const label = aisLabel(ctx.ais, l);
    aisLines.set(l.id, { label, text: `${label}: ${l.id} | ${l.category} | ${l.source} | ${l.description}`, line: l });
  }
  const bookLines = new Map<string, { label: string; text: string; book: OtherSource }>();
  for (const b of ctx.books) {
    const label = bookLabel(ctx.books, b);
    bookLines.set(b.id, { label, text: `${label}: ${b.id} | ${b.nature} | ${b.payer}`, book: b });
  }
  const text = `AIS income lines:\n${[...aisLines.values()].map((v) => v.text).join("\n")}\n\nBooks ledgers (other sources):\n${[...bookLines.values()].map((v) => v.text).join("\n")}`;
  return { aisLines, bookLines, text };
}

function itemIssues(m: AisMatchOutput["matches"][number], p: ReturnType<typeof aisPrompt>): string[] {
  const a = p.aisLines.get(m.aisId);
  if (!a) return [`AIS id ${m.aisId} is not an AIS income line given`];
  if (m.outcome === "matched") {
    const b = m.bookId ? p.bookLines.get(m.bookId) : undefined;
    if (!b) return [`AIS ${m.aisId}: books ledger ${m.bookId ?? "(none)"} does not exist`];
    if (!AIS_INCOME_CATEGORIES[a.line.category].includes(b.book.nature)) return [`AIS ${m.aisId}: a ${a.line.category} line cannot match a ${b.book.nature} ledger`];
    if (m.evidence.location !== b.label || !quoteIn(b.text, m.evidence.quote)) return [`AIS ${m.aisId}: evidence must quote the matched ledger line ${b.label}`];
    return [];
  }
  if (m.bookId !== null) return [`AIS ${m.aisId}: ${m.outcome} must not name a ledger`];
  if (m.evidence.location !== a.label || !quoteIn(a.text, m.evidence.quote)) return [`AIS ${m.aisId}: evidence must quote its AIS line ${a.label}`];
  return [];
}

export function validateAisMatches(out: AisMatchOutput, ctx: AisMatchContext): string[] {
  const p = aisPrompt(ctx);
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const m of out.matches) {
    if (seen.has(m.aisId)) issues.push(`AIS ${m.aisId} answered twice`);
    seen.add(m.aisId);
    issues.push(...itemIssues(m, p));
  }
  return issues;
}

/** One validated outcome per AIS income line: invalid → dropped, missing → unanswered. */
export function acceptedAisMatches(out: AisMatchOutput, ctx: AisMatchContext): AisMatch[] {
  const p = aisPrompt(ctx);
  const byId = new Map<string, AisMatchOutput["matches"]>();
  for (const m of out.matches) byId.set(m.aisId, [...(byId.get(m.aisId) ?? []), m]);
  return [...p.aisLines.keys()].map((id) => {
    const answers = byId.get(id) ?? [];
    if (!answers.length) return { aisId: id, outcome: "unanswered", bookId: null };
    if (answers.length > 1 || itemIssues(answers[0], p).length) return { aisId: id, outcome: "dropped", bookId: null };
    return { aisId: id, outcome: answers[0].outcome, bookId: answers[0].bookId };
  });
}

export function matchAisSystem(rules: Pick<TaxRuleSet, "act" | "ay" | "fy">): string {
  return [
    taxPreamble(rules),
    "Task: for each AIS income line, name the books ledger (other sources) that records the same income, judging by payer and nature only.",
    "outcome = matched with bookId and evidence quoting that ledger line; not_in_books when no ledger is that payer's income of that nature, with evidence quoting the AIS line; insufficient_evidence when the names do not let you decide (for example two ledgers could both be it), with evidence quoting the AIS line.",
    "evidence.location is the line label exactly as given (for example ais.csv row 3 or organiser.json otherSources[1]). Answer every AIS line once.",
  ].join(" ");
}

export const TAX_MATCH_AIS_SPEC: ModelTaskSpec<AisMatchOutput, AisMatchContext> = {
  name: "tax.match-ais",
  version: 1,
  schema: AisMatchSchema,
  // Registry copy for FY 2025-26 (the only verified rule set); extract() builds it from the job FY rule set.
  system: matchAisSystem(TAX_RULESETS["2025-26"]),
  rules: ["tax.ais-not-in-books"],
  validate: validateAisMatches,
};

export const TAX_FOREIGN_ASSET_CHECK_SPEC: ModelTaskSpec<z.infer<typeof LlmVerdictOutputSchema>, string> = {
  name: "tax.check:tax.foreign-asset",
  version: 1,
  schema: LlmVerdictOutputSchema,
  system: LLM_CHECK_SYSTEM,
  rules: ["tax.foreign-asset"],
  validate: (out, context) => (quoteIn(context, out.evidence.quote) ? [] : ["verdict quote not found in the documents"]),
};

/** Every model task the Tax agent may run. */
export const TAX_MODEL_TASKS = [TAX_MATCH_AIS_SPEC, TAX_FOREIGN_ASSET_CHECK_SPEC] as const;
