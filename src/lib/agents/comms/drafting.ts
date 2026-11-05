// Drafting a client message (Phase 10): template first, then (optionally) the model polishes the
// wording through the ADR-008 guardrail session — declared task only, FIRM_PREAMBLE + department
// preamble, closed schema, grounding validators as router contradictions — and the ModelRouter
// (privacy anonymize-then-cloud: names masked through the dictionary, identifiers by the
// anonymizer, unmasked before validation). If the model is unavailable (no key, outage, budget)
// or its wording fails the checks, the draft is the template text and says so in its notes.
// No I/O of its own: the router is injected (default: the env-configured ModelRouter).
import type { FirmService } from "@prisma/client";
import { BudgetExceededError, NoProviderAvailableError, type DictionaryEntry, type ModelRequest, type RouterResult } from "@/lib/ai/router";
import { INSUFFICIENT_EVIDENCE, createGuardrailSession, emptyGuardrailStats, type GuardrailStats } from "@/lib/agents/core/guardrails";
import { factsIn, type Fact } from "./facts";
import type { PolishOutput, TranslateOutput } from "./grounding";
import { COMMS_SCOPES, polishTaskName, translateTaskName } from "./tasks";
import type { Template } from "./templates";
import { sentences } from "./tone";
import { LANGUAGE_LABELS, type TranslatedLanguage } from "./types";

/** The part of the ModelRouter a draft needs (the real router, or a recording in tests). */
export type CommsRouter = { run<T>(req: ModelRequest<T>): Promise<RouterResult<T>> };

export type DraftModelDeps = {
  router: CommsRouter;
  /** ModelCall.runId for every call of this draft ("comms:<uuid>"). */
  runId: string;
  /** Per-draft cost cap in ₹ (the router's per-run budget guard). */
  maxCostInr?: number;
};

/** The model answered, but not with a usable rewrite (needs-review after the last escalation, or queued). */
export class CommsModelRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommsModelRejected";
  }
}

export type PartSource = "model" | "template";
export type Polished = { subject: string; paragraphs: string[]; source: PartSource; note: string | null };

/** A staff-facing note for a model step that fell back (never shown to the client). */
export function fallbackNote(step: "wording" | "translation", e: unknown): string {
  const what = step === "wording" ? "Template wording" : "No translation";
  if (e instanceof NoProviderAvailableError) return `${what}: the drafting model is not available (no model key is configured, or the provider is down).`;
  if (e instanceof BudgetExceededError) return `${what}: the AI budget for today (or for this draft) is used up.`;
  if (e instanceof CommsModelRejected) return `${what}: the model's ${step === "wording" ? "wording" : "translation"} did not pass the fact and tone checks.`;
  return `${what}: the drafting model failed (${e instanceof Error ? e.name : "error"}).`;
}

/** One guardrail session per draft: the department's comms scope, the router bound to the draft's runId. */
export function commsSession(department: FirmService, deps: DraftModelDeps) {
  const owner = COMMS_SCOPES[department];
  return createGuardrailSession({
    agent: owner,
    scope: owner.scope!,
    route: <T>(req: Omit<ModelRequest<T>, "runId">) => deps.router.run<T>({ ...req, runId: deps.runId, maxCostInr: req.maxCostInr ?? deps.maxCostInr }),
    unwrap: <T>(res: RouterResult<T>): T => {
      if (res.status === "ok") return res.output;
      throw new CommsModelRejected(res.status === "queued" ? res.reason : res.issues.join("; "));
    },
  });
}
export type CommsSession = ReturnType<typeof commsSession>;

/** Ask the department's comms.polish task to reword the template; fall back to the template on any failure. */
export async function polishTemplate(t: Template, session: CommsSession, department: FirmService, dictionary: DictionaryEntry[]): Promise<Polished> {
  const template: Polished = { subject: t.subject, paragraphs: [...t.paragraphs], source: "template", note: null };
  const facts = factsIn([t.subject, ...t.paragraphs].join("\n"), t.facts).map((f) => f.value);
  session.setInput({ template: t });
  try {
    const out = await session.model<PolishOutput>({
      task: polishTaskName(department),
      privacy: "anonymize-then-cloud",
      difficulty: "sop",
      dictionary,
      maxTokens: 1500,
      messages: [{ role: "user", content: JSON.stringify({ subject: t.subject, paragraphs: t.paragraphs, facts }) }],
    });
    if (out.status === INSUFFICIENT_EVIDENCE) return { ...template, note: "Template wording: the model left the wording unchanged." };
    return { subject: out.subject.trim(), paragraphs: out.paragraphs.map((p) => p.trim()), source: "model", note: null };
  } catch (e) {
    if (!(e instanceof NoProviderAvailableError || e instanceof CommsModelRejected || e instanceof BudgetExceededError)) console.error("comms polish failed:", e instanceof Error ? e.message : e);
    return { ...template, note: fallbackNote("wording", e) };
  }
}

export const sessionStats = (s: CommsSession | null): GuardrailStats => (s ? { ...s.stats } : emptyGuardrailStats());

// ------------------------------------------------------------------ translation

/** The translatable parts of a message (the signature stays as written). */
export type MessageParts = { subject: string; greeting: string; paragraphs: string[]; items: string[]; closing: string };

/** Subject, greeting, each sentence, each list item, closing — and how to put translated segments back. */
export function toSegments(p: MessageParts): { segments: string[]; fromSegments: (s: readonly string[]) => MessageParts } {
  const segments = [p.subject, p.greeting];
  const paragraphAt: number[][] = [];
  for (const para of p.paragraphs) {
    const ss = sentences(para);
    const parts = ss.length ? ss : [para];
    paragraphAt.push(parts.map((_, k) => segments.length + k));
    segments.push(...parts);
  }
  const itemsFrom = segments.length;
  segments.push(...p.items);
  const closingAt = segments.length;
  segments.push(p.closing);
  return {
    segments,
    fromSegments: (s) => ({
      subject: s[0],
      greeting: s[1],
      paragraphs: paragraphAt.map((ix) => ix.map((i) => s[i].trim()).join(" ")),
      items: p.items.map((_, k) => s[itemsFrom + k].trim()),
      closing: s[closingAt],
    }),
  };
}

/** Ask the department's comms.translate task for the message in `language`; null (with a note) on any failure. */
export async function translateMessage(
  parts: MessageParts,
  facts: Fact[],
  language: TranslatedLanguage,
  session: CommsSession,
  department: FirmService,
  dictionary: DictionaryEntry[],
): Promise<{ parts: MessageParts | null; note: string | null }> {
  const { segments, fromSegments } = toSegments(parts);
  session.setInput({ language, segments, facts });
  try {
    const out = await session.model<TranslateOutput>({
      task: translateTaskName(department),
      privacy: "anonymize-then-cloud",
      difficulty: "judgement",
      dictionary,
      maxTokens: 4000,
      messages: [{ role: "user", content: JSON.stringify({ language, segments }) }],
    });
    if (out.status === INSUFFICIENT_EVIDENCE) return { parts: null, note: `No translation: the model could not translate this message faithfully into ${LANGUAGE_LABELS[language]}; the English is used on its own.` };
    return { parts: fromSegments(out.segments), note: null };
  } catch (e) {
    if (!(e instanceof NoProviderAvailableError || e instanceof CommsModelRejected || e instanceof BudgetExceededError)) console.error("comms translate failed:", e instanceof Error ? e.message : e);
    return { parts: null, note: `${fallbackNote("translation", e)} The English is used on its own.` };
  }
}
