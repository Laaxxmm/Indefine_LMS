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
import { factTokens, factsIn, residualProblems, type Fact } from "./facts";
import { renderBody, type Template } from "./templates";
import { countAsks, countWords, lintTone, toneKey } from "./tone";

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
