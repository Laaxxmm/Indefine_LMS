// Grounding validators for the comms model tasks (Phase 10, ADR-008 §4–5). They run as the
// router's contradictions (any issue escalates FAST → SMART → HARD; after the last attempt the
// draft falls back to the template text). A rewrite may change wording only:
//
//   - every fact of the template paragraph (client name, period, date, amount, ack ref, return
//     name, staff-written numbers) is still there, character for character;
//   - every date / amount / reference / number in the rewrite equals a template fact (exact
//     match; amounts compared with the guardrails' numbersIn so a reformatted amount is named as
//     such), and nothing date-, money-, number- or contact-like is left once the facts are cut out;
//   - same paragraphs in the same order, no large growth (no new content), the same number of
//     asks, and no tone issue the template did not already have.
//
// Messages name the fact so the model can correct itself; the router masks them before any
// cloud call, like the prompt. Pure.
import { INSUFFICIENT_EVIDENCE, numbersIn } from "@/lib/agents/core/guardrails";
import { factTokens, factsIn, residualProblems, stripFacts, type Fact, type FactKind } from "./facts";
import { renderBody, type Template } from "./templates";
import { countAsks, countWords, lintTone, toneKey } from "./tone";
import type { TranslatedLanguage } from "./types";

export type PolishOutput = { status: "polished" | typeof INSUFFICIENT_EVIDENCE; subject: string; paragraphs: string[] };
export type PolishInput = { template: Template };

const subset = (a: Set<number>, b: Set<number>) => [...a].every((x) => b.has(x));

/** Problems with one rewritten piece of text against the template text it replaces. */
export function factProblems(label: string, out: string, tpl: string, facts: readonly Fact[]): string[] {
  const issues: string[] = [];
  for (const f of factsIn(tpl, facts)) {
    if (!out.includes(f.value)) issues.push(`${label}: keep ${f.kind === "name" ? "the name" : `the ${f.kind}`} "${f.value}" exactly as written`);
  }
  const values = facts.map((f) => f.value);
  const allowed = new Set([...values, ...values.flatMap((v) => factTokens(v).map((t) => t.value)), ...factTokens(tpl).map((t) => t.value)]);
  const factNumbers = numbersIn(values.join("\n"));
  for (const t of factTokens(out)) {
    if (allowed.has(t.value)) continue;
    if ((t.kind === "amount" || t.kind === "number") && subset(numbersIn(t.value), factNumbers)) issues.push(`${label}: "${t.value}" must be written exactly as in the facts`);
    else issues.push(`${label}: "${t.value}" is a new ${t.kind === "ref" ? "reference" : t.kind}; use only the facts given`);
  }
  for (const p of residualProblems(out, facts)) issues.push(`${label}: ${p}`);
  return [...new Set(issues)];
}

/** spec.validate of comms.polish.<department>. */
export function validatePolish(out: PolishOutput, input: PolishInput): string[] {
  if (out.status === INSUFFICIENT_EVIDENCE) return [];
  const t = input.template;
  if (out.paragraphs.length !== t.paragraphs.length) return [`return exactly ${t.paragraphs.length} paragraphs, one per template paragraph, in the same order (got ${out.paragraphs.length})`];
  const issues = [...factProblems("subject", out.subject, t.subject, t.facts)];
  out.paragraphs.forEach((p, i) => {
    const tpl = t.paragraphs[i];
    issues.push(...factProblems(`paragraph ${i + 1}`, p, tpl, t.facts));
    if (countWords(p) > Math.ceil(countWords(tpl) * 1.6) + 8) issues.push(`paragraph ${i + 1}: much longer than the template; do not add content`);
  });
  const want = countAsks(t.paragraphs.join("\n"));
  const got = countAsks(out.paragraphs.join("\n"));
  if (got !== want) issues.push(want === 0 ? "the template asks the client for nothing; do not add a request or a question" : `keep exactly ${want} request (got ${got})`);
  const before = new Set(lintTone(renderBody(t), { requireAsk: t.requiresAsk }).map(toneKey));
  for (const i of lintTone(renderBody({ ...t, paragraphs: out.paragraphs }), { requireAsk: t.requiresAsk })) if (!before.has(toneKey(i))) issues.push(`tone: ${i.message}`);
  return issues;
}

// ------------------------------------------------------------------ translation

export type TranslateOutput = { status: "translated" | typeof INSUFFICIENT_EVIDENCE; language: TranslatedLanguage; segments: string[] };
export type TranslateInput = { language: TranslatedLanguage; segments: string[]; facts: Fact[] };

/** Unicode block of each language's script (Kannada, Tamil, Devanagari). */
export const SCRIPT: Readonly<Record<TranslatedLanguage, RegExp>> = Object.freeze({ kn: /[ಀ-೿]/, ta: /[஀-௿]/, hi: /[ऀ-ॿ]/ });
/** Kannada, Tamil and Devanagari digits: dates and amounts stay in English digits. */
const NATIVE_DIGITS = /[೦-೯௦-௯०-९]/;
/** Facts copied verbatim into a translation (a topic or a document line is translated; its numbers are tokens). */
const VERBATIM: ReadonlySet<FactKind> = new Set(["name", "label", "period", "date", "amount", "ref", "token"]);

/** spec.validate of comms.translate.<department>. */
export function validateTranslation(out: TranslateOutput, input: TranslateInput): string[] {
  if (out.status === INSUFFICIENT_EVIDENCE) return [];
  if (out.language !== input.language) return [`translate into "${input.language}" (got "${out.language}")`];
  if (out.segments.length !== input.segments.length) return [`return exactly ${input.segments.length} segments, one per English segment, in the same order (got ${out.segments.length})`];
  const verbatim = input.facts.filter((f) => VERBATIM.has(f.kind));
  const issues: string[] = [];
  out.segments.forEach((seg, i) => {
    const en = input.segments[i];
    const label = `segment ${i + 1}`;
    for (const f of factsIn(en, verbatim)) if (!seg.includes(f.value)) issues.push(`${label}: copy ${f.kind === "name" ? "the name" : `the ${f.kind}`} "${f.value}" exactly, in English letters and digits`);
    if (NATIVE_DIGITS.test(seg)) issues.push(`${label}: write digits as 0-9, not in the native script`);
    for (const p of residualProblems(seg, input.facts)) issues.push(`${label}: ${p}`);
    if (/[A-Za-z]{2,}/.test(stripFacts(en, input.facts)) && !SCRIPT[input.language].test(seg)) issues.push(`${label}: not translated into the requested script`);
    for (const t of lintTone(seg, { english: false })) issues.push(`${label}: ${t.message}`);
  });
  return [...new Set(issues)];
}
