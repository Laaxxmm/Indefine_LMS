// Tax model-task registry (ADR-008). The Tax agent may run exactly these tasks:
//
//   tax.match-ais@1                 AIS income lines → the books ledger that holds each (or
//                                   not_in_books / insufficient_evidence), with a verbatim quote
//   tax.check:tax.foreign-asset@1   the LLM checklist rule (prompt built by the framework runner)
//
// The model sees names and categories only — never amounts: comparing amounts is code's job.
// Validation is deterministic (ids exist, ledger nature fits the AIS category, quote copied from
// the cited line); invalid answers are dropped and become reviewer questions, never defaults.
//
// These specs ARE the agent's ADR-008 scope (index.ts): the framework prefixes each system prompt
// with the firm and income-tax department preambles and runs `validate` as the router's
// contradictions (input = TaxInput for tax.match-ais, the documents text for the checklist task).
// The prompts are fixed per version; the assessment year of the job goes in the user message.
import { z } from "zod";
import { CHECK_TASK_INSTRUCTIONS, type ModelTaskSpec } from "@/lib/agents/core/guardrails/scope";
import { INSUFFICIENT_EVIDENCE, ScopedVerdictSchema, type ScopedVerdict } from "@/lib/agents/core/guardrails/schema";
import { EvidenceSchema, INSUFFICIENT, quoteIn } from "@/lib/agents/core/guardrails/shared";
import { screenItems } from "@/lib/agents/core/guardrails/untrusted";
import { AIS_INCOME_CATEGORIES, isAisIncome, type AisMatch } from "./analyse";
import type { TaxRuleSet } from "./data";
import type { AisLine, OtherSource, TaxInput } from "./parse";

/** Income-tax department specifics, at the start of every Tax task prompt (after the framework's firm + department preambles). */
export const TAX_PREAMBLE = "Department: Indian income tax only (the Income-tax Act). Do not answer questions about GST, company law or anything outside income tax.";

/** The job's act / assessment year, stated in the user message (the system prompt is fixed per task version). */
export function taxYearLine(rules: Pick<TaxRuleSet, "act" | "ay" | "fy">): string {
  return `Law: the ${rules.act}, assessment year ${rules.ay} (financial year ${rules.fy}).`;
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

type PromptLine = { id: string; label: string; text: string };

/** Every AIS income line and books ledger as the model would see it (before the injection screen). */
export function aisPromptLines(ctx: AisMatchContext): { ais: (PromptLine & { line: AisLine })[]; books: (PromptLine & { book: OtherSource })[] } {
  const ais = ctx.ais
    .filter((x) => isAisIncome(x.category))
    .map((l) => {
      const label = aisLabel(ctx.ais, l);
      return { id: l.id, label, text: `${label}: ${l.id} | ${l.category} | ${l.source} | ${l.description}`, line: l };
    });
  const books = ctx.books.map((b) => {
    const label = bookLabel(ctx.books, b);
    return { id: b.id, label, text: `${label}: ${b.id} | ${b.nature} | ${b.payer}`, book: b };
  });
  return { ais, books };
}
export const AIS_SCREEN = { text: (l: PromptLine) => l.text, location: (l: PromptLine) => l.label };

/**
 * The text the model is shown: labelled AIS income lines and books ledgers, without amounts. A line
 * that reads like an instruction to the AI is withheld (ADR-009): not sent, never matched from an
 * answer, a reviewer question instead (`withheldAis`).
 */
export function aisPrompt(ctx: AisMatchContext): {
  aisLines: Map<string, { label: string; text: string; line: AisLine }>;
  bookLines: Map<string, { label: string; text: string; book: OtherSource }>;
  text: string;
  withheldAis: string[];
} {
  const all = aisPromptLines(ctx);
  const ais = screenItems(all.ais, AIS_SCREEN);
  const books = screenItems(all.books, AIS_SCREEN);
  const aisLines = new Map(ais.clean.map((v) => [v.id, { label: v.label, text: v.text, line: v.line }]));
  const bookLines = new Map(books.clean.map((v) => [v.id, { label: v.label, text: v.text, book: v.book }]));
  const text = `AIS income lines:\n${[...aisLines.values()].map((v) => v.text).join("\n")}\n\nBooks ledgers (other sources):\n${[...bookLines.values()].map((v) => v.text).join("\n")}`;
  return { aisLines, bookLines, text, withheldAis: ais.withheld.map((w) => w.item.id) };
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

/** One validated outcome per AIS income line: invalid or withheld by the injection screen → dropped, missing → unanswered. */
export function acceptedAisMatches(out: AisMatchOutput, ctx: AisMatchContext): AisMatch[] {
  const p = aisPrompt(ctx);
  const byId = new Map<string, AisMatchOutput["matches"]>();
  for (const m of out.matches) byId.set(m.aisId, [...(byId.get(m.aisId) ?? []), m]);
  const held = new Set(p.withheldAis);
  return [...new Set(aisPromptLines(ctx).ais.map((l) => l.id))].map((id): AisMatch => {
    if (held.has(id) && !p.aisLines.has(id)) return { aisId: id, outcome: "dropped", bookId: null };
    const answers = byId.get(id) ?? [];
    if (!answers.length) return { aisId: id, outcome: "unanswered", bookId: null };
    if (answers.length > 1 || itemIssues(answers[0], p).length) return { aisId: id, outcome: "dropped", bookId: null };
    return { aisId: id, outcome: answers[0].outcome, bookId: answers[0].bookId };
  });
}

export const MATCH_AIS_SYSTEM = [
  TAX_PREAMBLE,
  "Task: for each AIS income line, name the books ledger (other sources) that records the same income, judging by payer and nature only.",
  "outcome = matched with bookId and evidence quoting that ledger line; not_in_books when no ledger is that payer's income of that nature, with evidence quoting the AIS line; insufficient_evidence when the names do not let you decide (for example two ledgers could both be it), with evidence quoting the AIS line.",
  "evidence.location is the line label exactly as given (for example ais.csv row 3 or organiser.json otherSources[1]). Answer every AIS line once.",
].join(" ");

/** The AIS lines and books ledgers the matching task reads, from the parsed input. */
export const aisContextOf = (input: TaxInput): AisMatchContext => ({ ais: input.ais ?? [], books: input.organiser.otherSources });

/** User message for tax.match-ais: reviewer notes, the job's law / year, the labelled lines. */
export function matchAisUserMessage(rules: Pick<TaxRuleSet, "act" | "ay" | "fy">, ctx: AisMatchContext, notes: string | null): string {
  return `${notes ? `Reviewer notes: ${notes}\n\n` : ""}${taxYearLine(rules)}\n\n${aisPrompt(ctx).text}`;
}

export const TAX_MATCH_AIS_SPEC: ModelTaskSpec<AisMatchOutput, TaxInput, "tax"> = {
  name: "tax.match-ais",
  version: 2,
  schema: AisMatchSchema,
  systemPrompt: MATCH_AIS_SYSTEM,
  difficulty: "sop",
  ruleIds: ["tax.ais-not-in-books"],
  validate: (out, input) => validateAisMatches(out, aisContextOf(input)),
  privacy: "anonymize-then-cloud",
  profile: { documents: "AIS income lines (id, category, source, description) and books other-source ledgers (id, nature, payer), one labelled line each (screened per line); the Act and year; reviewer notes. No amounts." },
};

/** The foreign-asset verdict must quote the documents it was shown (abstaining needs no quote). */
export const validateForeignAssetVerdict = (out: ScopedVerdict, context: string): string[] =>
  out.status === INSUFFICIENT_EVIDENCE || !out.evidence ? [] : quoteIn(context, out.evidence.quote) ? [] : ["verdict quote not found in the documents"];

export const TAX_FOREIGN_ASSET_CHECK_SPEC: ModelTaskSpec<ScopedVerdict, string, "tax"> = {
  name: "tax.check:tax.foreign-asset",
  version: 2,
  schema: ScopedVerdictSchema,
  systemPrompt: [TAX_PREAMBLE, CHECK_TASK_INSTRUCTIONS].join("\n"),
  difficulty: "judgement",
  ruleIds: ["tax.foreign-asset"],
  validate: validateForeignAssetVerdict,
  privacy: "anonymize-then-cloud",
  profile: { documents: "LLM context: organiser profile notes, AIS rows and capital-gains asset names, one labelled line each." },
};

/** Every model task the Tax agent may run. */
export const TAX_MODEL_TASKS = [TAX_MATCH_AIS_SPEC, TAX_FOREIGN_ASSET_CHECK_SPEC] as const;
