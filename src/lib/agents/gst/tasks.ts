// GST model-task registry (ADR-008). Every model call GST Prep makes is declared here: name
// `gst.<task>`, version, closed Zod output schema, system prompt (firm + GST preamble), the
// checklist rule ids it serves, and a deterministic validate(output, input) that returns issues.
// Validators run twice: as the router's `contradictions` hook (a failure escalates like a schema
// failure) and again after the call (anything still ungrounded is dropped to insufficient_evidence
// and becomes a reviewer question — never a silent default).
//
// Closed outputs: every classification enum includes "insufficient_evidence"; free text is limited
// to evidence quotes and notes of at most 300 characters. Grounding: each answer carries
// { quote, location } copied from the text we send; any number it extracts must appear in the quote.
//
// The registry below IS GST Prep's ADR-008 scope (index.ts): the framework prefixes every system
// prompt with its firm and GST department preambles, refuses any task not listed, runs each call's
// validators as the router's contradictions, grounds the output and locks name@version.
import { z } from "zod";
import { CHECK_TASK_INSTRUCTIONS, type AnyTaskSpec } from "@/lib/agents/core/guardrails/scope";
import { INSUFFICIENT_EVIDENCE, ScopedVerdictSchema, type ScopedVerdict } from "@/lib/agents/core/guardrails/schema";
import { BLOCKED_CATEGORIES, BLOCKED_CATEGORY_KEYS, RCM_SERVICES, RCM_SERVICE_KEYS } from "./config";

export const INSUFFICIENT = "insufficient_evidence" as const;
export const TEXT_CAP = 300;

export const GST_PREAMBLE = [
  "You work only on Indian GST (CGST, SGST/UTGST and IGST Acts and rules) for a chartered accountant's draft pack that a person reviews.",
  "Use only the documents supplied in this message.",
  "Never compute, add up or total any amount.",
  "Never give filing, legal or audit-opinion advice.",
  `If the documents do not contain the answer, return ${INSUFFICIENT}.`,
  "Output JSON only.",
].join(" ");

const EvidenceZ = z.object({ quote: z.string().trim().min(1).max(TEXT_CAP), location: z.string().trim().min(1).max(TEXT_CAP) });
export type Evidence = z.infer<typeof EvidenceZ>;

/** Whitespace- and case-normalised text for quote matching. */
export const normText = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const digits = (s: string) => s.replace(/\D/g, "");

// ------------------------------------------------------------------ gst.classify-ledgers

export const CLASSIFY_LEDGERS_TASK = "gst.classify-ledgers" as const;

export const LedgerClassOutputSchema = z.object({
  ledgers: z
    .array(
      z.object({
        ledger: z.string().min(1).max(TEXT_CAP),
        blockedCategory: z.enum([...BLOCKED_CATEGORY_KEYS, "none", INSUFFICIENT]),
        rcmService: z.enum([...RCM_SERVICE_KEYS, "none", INSUFFICIENT]),
        evidence: EvidenceZ,
        note: z.string().max(TEXT_CAP).optional(),
      }),
    )
    .max(2000),
});
export type LedgerClassOutput = z.infer<typeof LedgerClassOutputSchema>;

/** What the model is shown for one ledger: the text and where it came from. */
export type LedgerPrompt = { key: string; sample: string; location: string };

export const LEDGER_SYSTEM = [
  GST_PREAMBLE,
  "Task: for each purchase ledger, give blockedCategory (the s.17(5) CGST Act head it falls in, none, or insufficient_evidence) and rcmService (the reverse-charge service it is, none, or insufficient_evidence).",
  "Heads: " + Object.entries(BLOCKED_CATEGORIES).map(([k, v]) => `${k} = ${v}`).join("; ") + ".",
  "Reverse-charge services: " + Object.entries(RCM_SERVICES).map(([k, v]) => `${k} = ${v.label}`).join("; ") + ".",
  "Goods vehicles and vehicles used for transporting goods or passengers as a business are not motor-vehicle.",
  "Answer none only when the ledger text clearly shows an ordinary business input; when the text is too vague to tell (e.g. 'Miscellaneous', 'Sundry'), answer insufficient_evidence.",
  "Copy each ledger exactly. evidence.quote: words copied verbatim from that ledger's line; evidence.location: the [location] shown for it. note: at most one short sentence.",
].join(" ");

export function ledgerUserMessage(prompts: LedgerPrompt[], reviewerNotes: string | null): string {
  return `${reviewerNotes ? `Reviewer notes: ${reviewerNotes}\n\n` : ""}Ledgers:\n${prompts.map(ledgerLine).join("\n")}`;
}
export const ledgerLine = (p: LedgerPrompt) => `- [${p.location}] ledger "${p.key}"${p.sample && p.sample !== p.key ? ` | description "${p.sample}"` : ""}`;

export function validateLedgerItem(item: LedgerClassOutput["ledgers"][number], prompts: Map<string, LedgerPrompt>): string[] {
  const p = prompts.get(item.ledger.trim());
  if (!p) return [`ledger "${item.ledger}" was not in the input`];
  const issues: string[] = [];
  if (!normText(ledgerLine(p)).includes(normText(item.evidence.quote))) issues.push(`ledger "${item.ledger}": quote is not in its input line`);
  if (normText(item.evidence.location) !== normText(p.location)) issues.push(`ledger "${item.ledger}": location ${item.evidence.location} is not ${p.location}`);
  return issues;
}

export function validateLedgers(out: LedgerClassOutput, prompts: LedgerPrompt[]): string[] {
  const byKey = new Map(prompts.map((p) => [p.key, p]));
  const issues = out.ledgers.flatMap((l) => validateLedgerItem(l, byKey));
  const answered = new Set(out.ledgers.map((l) => l.ledger.trim()));
  for (const p of prompts) if (!answered.has(p.key)) issues.push(`ledger "${p.key}" was not answered`);
  return issues;
}

// ------------------------------------------------------------------ gst.read-hsn

export const READ_HSN_TASK = "gst.read-hsn" as const;
export const HSN_RE = /^\d{4}(\d{2}){0,2}$/;

export const HsnReadOutputSchema = z.object({
  items: z
    .array(
      z.object({
        description: z.string().min(1).max(TEXT_CAP),
        hsn: z.union([z.string().max(8).regex(HSN_RE, "HSN/SAC must be 4, 6 or 8 digits"), z.literal(INSUFFICIENT)]),
        evidence: EvidenceZ,
      }),
    )
    .max(2000),
});
export type HsnReadOutput = z.infer<typeof HsnReadOutputSchema>;
export type HsnPrompt = { description: string; location: string };

export const HSN_SYSTEM = [
  GST_PREAMBLE,
  "Task: read the HSN or SAC code written in each sales line description (it may be written as 'tariff 1905.31', 'HS 8471-30', 'SAC: 998314').",
  "Return the code digits only when they are written in the description; never infer a code from the product name — then return insufficient_evidence.",
  "Codes are 4, 6 or 8 digits. Copy each description exactly. evidence.quote: the words of the description containing the code (or the description when insufficient_evidence); evidence.location: the [location] shown.",
].join(" ");

export const hsnLine = (p: HsnPrompt) => `- [${p.location}] "${p.description}"`;
export const hsnUserMessage = (prompts: HsnPrompt[]) => `Descriptions:\n${prompts.map(hsnLine).join("\n")}`;

export function validateHsnItem(item: HsnReadOutput["items"][number], prompts: Map<string, HsnPrompt>): string[] {
  const p = prompts.get(item.description);
  if (!p) return [`description "${item.description}" was not in the input`];
  const issues: string[] = [];
  if (!normText(p.description).includes(normText(item.evidence.quote))) issues.push(`"${item.description}": quote is not in the description`);
  if (normText(item.evidence.location) !== normText(p.location)) issues.push(`"${item.description}": location ${item.evidence.location} is not ${p.location}`);
  if (item.hsn !== INSUFFICIENT && !digits(item.evidence.quote).includes(item.hsn)) issues.push(`"${item.description}": HSN ${item.hsn} does not appear in the quote`);
  return issues;
}

export function validateHsn(out: HsnReadOutput, prompts: HsnPrompt[]): string[] {
  const byDesc = new Map(prompts.map((p) => [p.description, p]));
  const issues = out.items.flatMap((i) => validateHsnItem(i, byDesc));
  const answered = new Set(out.items.map((i) => i.description));
  for (const p of prompts) if (!answered.has(p.description)) issues.push(`description "${p.description}" was not answered`);
  return issues;
}

// ------------------------------------------------------------------ gst.check:gst.free-supplies (LLM rule)

export const FREE_SUPPLIES_TASK = "gst.check:gst.free-supplies" as const;
export type Verdict = ScopedVerdict;

/** The framework builds this call (rule question + documents); the verdict must quote and locate a row it was shown. */
export function validateVerdict(v: Verdict, context: string): string[] {
  if (v.status === INSUFFICIENT_EVIDENCE || !v.evidence) return [];
  const issues: string[] = [];
  if (!normText(context).includes(normText(v.evidence.quote))) issues.push("verdict quote is not in the documents");
  if (!normText(context).includes(normText(v.evidence.location))) issues.push("verdict location is not a row shown in the documents");
  return issues;
}

/** GST specifics for the free-supplies LLM rule (the framework adds the firm and GST department preambles). */
export const FREE_SUPPLIES_SYSTEM = [GST_PREAMBLE, CHECK_TASK_INSTRUCTIONS, 'When the documents do not show it either way, answer "na".'].join("\n");

// ------------------------------------------------------------------ registry

/** One GST model task: the framework's ModelTaskSpec plus who builds the call. */
export type GstModelTask = AnyTaskSpec & {
  name: `gst.${string}`;
  /** Back-compat alias of systemPrompt. */
  system: string;
  ruleIds: readonly string[];
  /** Built by the framework runner (LLM rules) rather than by this agent. */
  builtBy: "agent" | "runner";
};

export const GST_MODEL_TASKS: readonly GstModelTask[] = Object.freeze([
  {
    name: CLASSIFY_LEDGERS_TASK,
    version: 2,
    schema: LedgerClassOutputSchema,
    systemPrompt: LEDGER_SYSTEM,
    system: LEDGER_SYSTEM,
    difficulty: "judgement",
    // gst.negative-rcm too: a credit note is reverse charge when the books mark it or the model classifies its ledger as an RCM service.
    ruleIds: ["gst.blocked-credit", "gst.rcm-liability", "gst.model-questions", "gst.negative-rcm"],
    builtBy: "agent",
    privacy: "anonymize-then-cloud",
    profile: {
      documents: "Purchase ledger names, each with one sample description and the purchase-register row it first appears on (screened per ledger line); reviewer notes. No amounts.",
      validators: "validateLedgers per call: every ledger answered once, quote copied from that ledger's line, location is that row; ungrounded answers become insufficient_evidence.",
    },
  },
  {
    name: READ_HSN_TASK,
    version: 2,
    schema: HsnReadOutputSchema,
    systemPrompt: HSN_SYSTEM,
    system: HSN_SYSTEM,
    difficulty: "sop",
    ruleIds: ["gst.hsn-digits", "gst.model-questions"],
    builtBy: "agent",
    privacy: "anonymize-then-cloud",
    profile: {
      documents: "Sales-line descriptions with no HSN/SAC in the register and none printed plainly, with their sales-register row (screened per description). No amounts.",
      validators: "validateHsn per call: quote in the description, location is its row, the HSN digits appear in the quote.",
    },
  },
  {
    name: FREE_SUPPLIES_TASK,
    version: 2,
    schema: ScopedVerdictSchema,
    systemPrompt: FREE_SUPPLIES_SYSTEM,
    system: FREE_SUPPLIES_SYSTEM,
    difficulty: "judgement",
    ruleIds: ["gst.free-supplies"],
    builtBy: "runner",
    privacy: "anonymize-then-cloud",
    profile: { documents: "LLM context: purchase rows (supplier, ledger, description) and sales rows (customer, document, description), one labelled line each. No amounts." },
    validate: (v: Verdict, context: string) => validateVerdict(v, context),
  },
]);

export function gstTask(name: string): GstModelTask {
  const t = GST_MODEL_TASKS.find((x) => x.name === name);
  if (!t) throw new Error(`GST Prep has no model task "${name}" (ADR-008 scope)`);
  return t;
}
