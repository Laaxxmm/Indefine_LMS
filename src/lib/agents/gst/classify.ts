// The model's only jobs in GST Prep (tasks.ts has the registry, prompts and validators):
//   gst.classify-ledgers  free-text purchase ledger → s.17(5) head / reverse-charge service
//   gst.read-hsn          an HSN/SAC code written in a messy description → digits
// Both go through ctx.model() — a scoped call (ADR-008): the framework supplies the system prompt
// (firm + GST preambles + the task prompt from tasks.ts), anonymises, validates the schema, runs
// the call's validators as `contradictions` (escalating on an issue) and drops ungrounded items.
// After a final validator failure the router still returns its last output (needs review), so
// the validators are applied per item here: an answer that is not grounded in the text we sent
// becomes insufficient_evidence with a note, and every
// insufficient_evidence answer is a reviewer question (rule gst.model-questions) and a client
// document request — never a silent default. An HSN printed plainly ("HSN 7318") is read by code
// and never sent to the model. The model never sees or returns an amount.
import type { ModelCaller } from "@/lib/agents/core/runner";
import {
  CLASSIFY_LEDGERS_TASK,
  HsnReadOutputSchema,
  INSUFFICIENT,
  LedgerClassOutputSchema,
  READ_HSN_TASK,
  hsnUserMessage,
  ledgerUserMessage,
  validateHsn,
  validateHsnItem,
  validateLedgerItem,
  validateLedgers,
  type HsnPrompt,
  type LedgerPrompt,
} from "./tasks";
import type { GstExtract, HsnRead, LedgerClass, PurchaseDoc, SalesDoc } from "./types";

export { CLASSIFY_LEDGERS_TASK, READ_HSN_TASK } from "./tasks";

/** The text the model classifies for one purchase document. */
export function ledgerKeyOf(p: Pick<PurchaseDoc, "ledger" | "lines">): string {
  return (p.ledger || p.lines.find((l) => l.description)?.description || "(no ledger)").trim();
}

/** Sorted, de-duplicated ledger keys with one sample description and the first row they appear on. */
export function ledgerPrompts(purchases: PurchaseDoc[]): LedgerPrompt[] {
  const m = new Map<string, LedgerPrompt>();
  for (const p of purchases) {
    const key = ledgerKeyOf(p);
    if (!m.has(key)) m.set(key, { key, sample: p.lines.map((l) => l.description).filter(Boolean).join("; ").slice(0, 200), location: p.loc });
  }
  return [...m.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

const EXPLICIT_HSN = /\b(?:HSN|SAC)\s*(?:code)?\s*[:#-]?\s*(\d{4}(?:\d{2}){0,2})\b/i;

/** HSN printed plainly in the description, read by code. */
export function hsnFromText(description: string): string | null {
  return EXPLICIT_HSN.exec(description)?.[1] ?? null;
}

/** Sales line descriptions that still need an HSN after the register and the code reader. */
export function hsnPrompts(sales: SalesDoc[]): HsnPrompt[] {
  const out = new Map<string, HsnPrompt>();
  for (const d of sales) for (const l of d.lines) if (!l.hsn && l.description && !hsnFromText(l.description) && !out.has(l.description)) out.set(l.description, { description: l.description, location: d.loc });
  return [...out.values()].sort((a, b) => (a.description < b.description ? -1 : 1));
}

const insufficientLedger = (key: string, note: string): LedgerClass => ({ ledger: key, blockedCategory: INSUFFICIENT, rcmService: INSUFFICIENT, evidence: null, note });

export async function classifyLedgers(purchases: PurchaseDoc[], model: ModelCaller, notes: string | null): Promise<LedgerClass[]> {
  const prompts = ledgerPrompts(purchases);
  if (!prompts.length) return [];
  const out = await model({
    task: CLASSIFY_LEDGERS_TASK,
    privacy: "anonymize-then-cloud",
    difficulty: "judgement",
    schema: LedgerClassOutputSchema,
    contradictions: (o) => validateLedgers(o, prompts),
    messages: [{ role: "user", content: ledgerUserMessage(prompts, notes) }],
  });
  const byKey = new Map(prompts.map((p) => [p.key, p]));
  const got = new Map<string, LedgerClass>();
  for (const item of out.ledgers) {
    const key = item.ledger.trim();
    if (!byKey.has(key) || got.has(key)) continue; // not ours / repeated answer: dropped
    const issues = validateLedgerItem(item, byKey);
    got.set(key, issues.length ? insufficientLedger(key, `ungrounded answer dropped: ${issues[0]}`) : { ledger: key, blockedCategory: item.blockedCategory, rcmService: item.rcmService, evidence: item.evidence, note: item.note ?? "" });
  }
  return prompts.map((p) => got.get(p.key) ?? insufficientLedger(p.key, "the model gave no answer for this ledger"));
}

export async function readHsn(sales: SalesDoc[], model: ModelCaller): Promise<HsnRead[]> {
  const prompts = hsnPrompts(sales);
  if (!prompts.length) return [];
  const out = await model({
    task: READ_HSN_TASK,
    privacy: "anonymize-then-cloud",
    difficulty: "sop",
    schema: HsnReadOutputSchema,
    contradictions: (o) => validateHsn(o, prompts),
    messages: [{ role: "user", content: hsnUserMessage(prompts) }],
  });
  const byDesc = new Map(prompts.map((p) => [p.description, p]));
  const got = new Map<string, HsnRead>();
  for (const item of out.items) {
    const p = byDesc.get(item.description);
    if (!p || got.has(item.description)) continue;
    const issues = validateHsnItem(item, byDesc);
    if (issues.length) got.set(p.description, { description: p.description, location: p.location, hsn: null, status: INSUFFICIENT, evidence: null, note: `ungrounded answer dropped: ${issues[0]}` });
    else if (item.hsn === INSUFFICIENT) got.set(p.description, { description: p.description, location: p.location, hsn: null, status: INSUFFICIENT, evidence: item.evidence, note: "no HSN/SAC written in the description" });
    else got.set(p.description, { description: p.description, location: p.location, hsn: item.hsn, status: "read", evidence: item.evidence, note: "" });
  }
  return prompts.map((p) => got.get(p.description) ?? { description: p.description, location: p.location, hsn: null, status: INSUFFICIENT, evidence: null, note: "the model gave no answer for this description" });
}

/** Model classifications on top of parsed data. */
export async function classify(data: GstExtract, model: ModelCaller, notes: string | null): Promise<GstExtract> {
  const ledgers = await classifyLedgers(data.purchases, model, notes);
  const hsnReads = await readHsn(data.sales, model);
  return { ...data, ledgers, hsnReads };
}
