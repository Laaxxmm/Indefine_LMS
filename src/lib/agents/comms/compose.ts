// One client message draft, end to end (Phase 10): protect identifiers in staff-written input →
// deterministic template → model polish (or the template wording, with a note) → English body →
// identifiers protected again → tone lint. Pure apart from the injected router; the caller stores
// the result as a CommsDraft. Nothing here sends anything.
import type { FirmService } from "@prisma/client";
import type { DictionaryEntry } from "@/lib/ai/router";
import { commsSession, polishTemplate, sessionStats, type DraftModelDeps, type PartSource } from "./drafting";
import type { GuardrailStats } from "@/lib/agents/core/guardrails";
import { protectIdentifiers, type IdKind } from "./pii";
import { buildTemplate, renderBody, type Template, type TemplateInput } from "./templates";
import { lintTone, type ToneIssue } from "./tone";
import type { CommsKind, CommsLanguage } from "./types";

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
  sources: { wording: PartSource };
  /** Staff-facing notes (fallbacks, identifiers left out). Never part of the message. */
  notes: string[];
  /** Tone issues left in the English text (shown to staff as warnings). */
  tone: ToneIssue[];
  identifiers: { kind: IdKind; replacement: string }[];
  stats: GuardrailStats;
};

/** Names the anonymizer must mask before any cloud call (client master). */
export function dictionaryFor(req: Pick<DraftRequest, "clientName" | "contactName">): DictionaryEntry[] {
  const out: DictionaryEntry[] = [{ value: req.clientName, kind: "ORG" }];
  if (req.contactName?.trim()) out.push({ value: req.contactName.trim(), kind: "NAME" });
  return out;
}

const ackOf = (req: TemplateInput): string[] => ("job" in req && req.job?.ackRef ? [req.job.ackRef] : []);

/** Staff-written text with PAN / Aadhaar protected before it reaches the template (or any model). */
function protectInput(req: DraftRequest, found: DraftResult["identifiers"]): TemplateInput {
  const keep = ackOf(req);
  const p = (s: string) => {
    const r = protectIdentifiers(s, { clientRequested: req.clientRequestedIds, keep });
    found.push(...r.found);
    return r.text;
  };
  switch (req.kind) {
    case "doc-chase":
      return { ...req, items: req.items.map(p) };
    case "query-response":
      return { ...req, topic: p(req.topic), answer: p(req.answer) };
    default:
      return req;
  }
}

function protectOut(text: string, req: DraftRequest, found: DraftResult["identifiers"]): string {
  const r = protectIdentifiers(text, { clientRequested: req.clientRequestedIds, keep: ackOf(req) });
  found.push(...r.found);
  return r.text;
}

/** Build the template only (no model): the deterministic draft and its facts. */
export function templateFor(req: DraftRequest): { template: Template; identifiers: DraftResult["identifiers"] } {
  const identifiers: DraftResult["identifiers"] = [];
  return { template: buildTemplate(protectInput(req, identifiers)), identifiers };
}

export async function draftMessage(req: DraftRequest, deps: DraftModelDeps | null): Promise<DraftResult> {
  const { template: t, identifiers } = templateFor(req);
  const notes: string[] = [];
  const session = deps ? commsSession(req.department, deps) : null;
  const dictionary = dictionaryFor(req);

  const polished = session ? await polishTemplate(t, session, req.department, dictionary) : { subject: t.subject, paragraphs: t.paragraphs, source: "template" as const, note: "Template wording: no model was asked." };
  if (polished.note) notes.push(polished.note);
  const english: MessageText = {
    subject: protectOut(polished.subject, req, identifiers),
    body: protectOut(renderBody({ ...t, paragraphs: polished.paragraphs }), req, identifiers),
  };

  if (identifiers.length) {
    notes.push(
      req.clientRequestedIds
        ? `${identifiers.length} identity number(s) masked to the last 4 characters, as the client asked.`
        : `${identifiers.length} identity number(s) (PAN / Aadhaar) left out of the message. Tick "the client asked for it" to include them masked to the last 4.`,
    );
  }
  return {
    kind: t.kind,
    language: "en",
    requestedLanguage: req.language,
    english,
    sources: { wording: polished.source },
    notes,
    tone: lintTone(english.body, { requireAsk: t.requiresAsk }),
    identifiers,
    stats: sessionStats(session),
  };
}
