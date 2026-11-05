// One client message draft, end to end (Phase 10): protect identifiers in staff-written input →
// deterministic template → model polish (or the template wording, with a note) → English body →
// identifiers protected again → tone lint → optional translation (Kannada / Tamil / Hindi, a
// separate scoped task) kept together with the English for the staff member to check. Pure apart
// from the injected router; the caller stores the result as a CommsDraft. Nothing here sends.
import type { FirmService } from "@prisma/client";
import type { DictionaryEntry } from "@/lib/ai/router";
import type { GuardrailStats } from "@/lib/agents/core/guardrails";
import { commsSession, polishTemplate, sessionStats, translateMessage, type DraftModelDeps, type MessageParts, type PartSource } from "./drafting";
import { protectIdentifiers, type IdKind } from "./pii";
import { buildTemplate, renderBody, type Template, type TemplateInput } from "./templates";
import { lintTone, type ToneIssue } from "./tone";
import { LANGUAGE_LABELS, type CommsKind, type CommsLanguage } from "./types";

export type DraftRequest = TemplateInput & {
  /** The department the message is about (the job's service; chosen by staff for a client-level answer). */
  department: FirmService;
  language: CommsLanguage;
  /** The client asked for their PAN / Aadhaar in this message: masked to the last 4 instead of left out. */
  clientRequestedIds: boolean;
};

export type MessageText = { subject: string; body: string };

export type DraftResult = {
  kind: CommsKind;
  /** Language of the stored draft (English when a translation was asked for but is not available). */
  language: CommsLanguage;
  requestedLanguage: CommsLanguage;
  english: MessageText;
  translated: MessageText | null;
  /** What CommsDraft stores: the English, or the translation followed by the English. */
  stored: MessageText;
  sources: { wording: PartSource; translation: "model" | "none" | "failed" };
  /** Staff-facing notes (fallbacks, identifiers left out). Never part of the message. */
  notes: string[];
  /** Tone issues left in the English text (shown to staff as warnings). */
  tone: ToneIssue[];
  identifiers: { kind: IdKind; replacement: string }[];
  stats: GuardrailStats;
};

/** Line between the translation and the English in a bilingual draft. */
export const ENGLISH_DIVIDER = "----- English -----";

export function bilingual(translated: MessageText, english: MessageText): MessageText {
  return { subject: `${translated.subject} / ${english.subject}`, body: `${translated.body}\n\n${ENGLISH_DIVIDER}\n\n${english.body}` };
}

/** A stored body → its translated part (null for an English draft) and its English part. */
export function splitBilingual(body: string): { translated: string | null; english: string } {
  const at = body.indexOf(`\n\n${ENGLISH_DIVIDER}\n\n`);
  if (at < 0) return { translated: null, english: body };
  return { translated: body.slice(0, at), english: body.slice(at + ENGLISH_DIVIDER.length + 4) };
}

/** Names the anonymizer must mask before any cloud call (client master). */
export function dictionaryFor(req: Pick<DraftRequest, "clientName" | "contactName">): DictionaryEntry[] {
  const out: DictionaryEntry[] = [{ value: req.clientName, kind: "ORG" }];
  if (req.contactName?.trim()) out.push({ value: req.contactName.trim(), kind: "NAME" });
  return out;
}

const ackOf = (req: TemplateInput): string[] => ("job" in req && req.job?.ackRef ? [req.job.ackRef] : []);

type Found = DraftResult["identifiers"];

function protector(req: DraftRequest, found: Found) {
  const keep = ackOf(req);
  return (s: string) => {
    const r = protectIdentifiers(s, { clientRequested: req.clientRequestedIds, keep });
    found.push(...r.found);
    return r.text;
  };
}

/** Staff-written text with PAN / Aadhaar protected before it reaches the template (or any model). */
function protectInput(req: DraftRequest, found: Found): TemplateInput {
  const p = protector(req, found);
  switch (req.kind) {
    case "doc-chase":
      return { ...req, items: req.items.map(p) };
    case "query-response":
      return { ...req, topic: p(req.topic), answer: p(req.answer) };
    default:
      return req;
  }
}

/** Build the template only (no model): the deterministic draft and its facts. */
export function templateFor(req: DraftRequest): { template: Template; identifiers: Found } {
  const identifiers: Found = [];
  return { template: buildTemplate(protectInput(req, identifiers)), identifiers };
}

const textOf = (t: Template, parts: MessageParts): MessageText => ({ subject: parts.subject, body: renderBody({ ...t, ...parts }) });

export async function draftMessage(req: DraftRequest, deps: DraftModelDeps | null): Promise<DraftResult> {
  const { template: t, identifiers } = templateFor(req);
  const protect = protector(req, identifiers);
  const notes: string[] = [];
  const session = deps ? commsSession(req.department, deps) : null;
  const dictionary = dictionaryFor(req);

  // 1. English: the model's wording, or the template's.
  const polished = session ? await polishTemplate(t, session, req.department, dictionary) : { subject: t.subject, paragraphs: t.paragraphs, source: "template" as const, note: "Template wording: no model was asked." };
  if (polished.note) notes.push(polished.note);
  const englishParts: MessageParts = { subject: protect(polished.subject), greeting: t.greeting, paragraphs: polished.paragraphs.map(protect), items: t.items, closing: t.closing };
  const english = textOf(t, englishParts);

  // 2. Translation (a separate scoped task), only when the client prefers another language.
  let translated: MessageText | null = null;
  let translation: DraftResult["sources"]["translation"] = "none";
  if (req.language !== "en") {
    const tr = session ? await translateMessage(englishParts, t.facts, req.language, session, req.department, dictionary) : { parts: null, note: `No translation into ${LANGUAGE_LABELS[req.language]}: no model was asked. The English is used on its own.` };
    if (tr.parts) {
      const p = tr.parts;
      translated = textOf(t, { subject: protect(p.subject), greeting: protect(p.greeting), paragraphs: p.paragraphs.map(protect), items: p.items.map(protect), closing: protect(p.closing) });
      translation = "model";
    } else {
      translation = "failed";
      if (tr.note) notes.push(tr.note);
    }
  }

  if (identifiers.length) {
    notes.push(
      req.clientRequestedIds
        ? `${identifiers.length} identity number(s) masked to the last 4 characters, as the client asked.`
        : `${identifiers.length} identity number(s) (PAN / Aadhaar) left out of the message. Tick "the client asked for it" to include them masked to the last 4.`,
    );
  }
  return {
    kind: t.kind,
    language: translated ? req.language : "en",
    requestedLanguage: req.language,
    english,
    translated,
    stored: translated ? bilingual(translated, english) : english,
    sources: { wording: polished.source, translation },
    notes,
    tone: lintTone(english.body, { requireAsk: t.requiresAsk }),
    identifiers,
    stats: sessionStats(session),
  };
}
