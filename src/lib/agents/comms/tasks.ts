// Comms model tasks (Phase 10, ADR-008). The model never writes a client message: code writes it
// from a template, and the model may only polish the wording within strict limits. The tasks are
// declared like any agent's scope so the framework's guardrails apply unchanged:
//
//   comms.polish.<department>@1   rephrase the template's subject and paragraphs; same facts,
//                                 same paragraphs, same ask (closed schema, capped strings,
//                                 insufficient_evidence = keep the template wording)
//
// One task per department (GST, ROC, income tax, TDS, books, audit, engagement letters): every
// system prompt is FIRM_PREAMBLE + the department preamble (core/guardrails) + COMMS_PREAMBLE +
// the task prompt, so a message about a GST job is drafted inside the GST department and the
// prompt lock hashes exactly what the model is given. `validate` (grounding.ts) runs as the
// router's contradictions. Privacy is always anonymize-then-cloud (names masked via the
// dictionary, identifiers masked by the anonymizer). Pure.
import type { FirmService } from "@prisma/client";
import { z } from "zod";
import { DEPARTMENT_LABELS, abstainable, note, type ModelTaskSpec, type ScopedAgentLike } from "@/lib/agents/core/guardrails";
import { validatePolish, type PolishInput, type PolishOutput } from "./grounding";
import { FIRM_SERVICES } from "./types";

export const COMMS_KEY = "comms" as const;

/** The comms function inside each department, after the framework's firm + department preambles. */
export const COMMS_PREAMBLE = [
  "Function: client communication. You help the firm's staff word a short message from the firm to its own client about this department's work for that client.",
  "Code wrote the message from a fixed template and filled every fact; the firm's staff checked the content and will read your wording before anything is sent. You never send anything.",
  "You only change wording. Never add a fact, a promise, a reason, advice or an opinion, and never drop one.",
].join("\n");

const POLISH_PROMPT = [
  COMMS_PREAMBLE,
  "",
  'Task: polish the wording of the message. You receive JSON with "subject", "paragraphs" (the template text) and "facts" (values that must stay exactly as written).',
  "Rules:",
  "- Return the same number of paragraphs in the same order; paragraph n of your answer says what paragraph n of the template says.",
  "- Copy every fact exactly, character for character: names and ⟨…⟩ placeholders, dates, amounts, reference numbers, return names and periods. Do not reformat a date or an amount.",
  "- Do not add any date, day, amount, number, deadline, reference, document, name, link or e-mail address, and do not drop any.",
  "- Plain, polite, short sentences for a busy business owner. No jargon, no legal or tax terms the template does not use, no emoji, no exclamation marks.",
  "- If the template asks the client for something, keep that as the only request. Do not add another request or a question.",
  "- Each paragraph at most 300 characters; the subject at most 300 characters.",
  '- If you cannot improve the wording without breaking a rule, return status "insufficient_evidence" with the template subject and paragraphs unchanged.',
  'Answer: { "status": "polished" | "insufficient_evidence", "subject": "...", "paragraphs": ["..."] }',
].join("\n");

export const PolishOutputSchema = z.object({
  status: abstainable(z.enum(["polished"])),
  subject: note(),
  paragraphs: z.array(note()).min(1).max(6),
});

const SLUG: Readonly<Record<FirmService, string>> = Object.freeze({ GST: "gst", ROC: "roc", IncomeTax: "incometax", TDS: "tds", Books: "books", Audit: "audit", Engagement: "engagement" });

export const polishTaskName = (d: FirmService) => `${COMMS_KEY}.polish.${SLUG[d]}` as const;

export type CommsTaskSpecs = { polish: ModelTaskSpec<PolishOutput, PolishInput, typeof COMMS_KEY> };

function specsFor(d: FirmService): CommsTaskSpecs {
  return {
    polish: {
      name: polishTaskName(d),
      version: 1,
      schema: PolishOutputSchema as unknown as ModelTaskSpec<PolishOutput, PolishInput>["schema"],
      systemPrompt: POLISH_PROMPT,
      difficulty: "sop",
      validate: validatePolish,
    },
  };
}

const byService = <T,>(f: (d: FirmService) => T): Readonly<Record<FirmService, T>> =>
  Object.freeze(Object.fromEntries(FIRM_SERVICES.map((d) => [d, f(d)])) as unknown as Record<FirmService, T>);

/** Task specs per department, built once (stable objects for the prompt lock and the session). */
export const COMMS_TASKS = byService(specsFor);

/**
 * The comms tasks of one department as a scoped "agent" (key `comms`): what the guardrail
 * session enforces and what scripts/verify-prompts.ts locks. Not a task agent: it has no
 * checklist, takes no input files and never appears in the agent registry.
 */
export const COMMS_SCOPES = byService(
  (d): ScopedAgentLike => ({
    key: COMMS_KEY,
    title: `Client comms drafts — ${DEPARTMENT_LABELS[d]}`,
    service: d,
    internal: false,
    scope: { department: d, tasks: Object.values(COMMS_TASKS[d]), ruleIds: [], inputSniff: () => ({ ok: true }) },
    defaultChecklist: { schemaVersion: 1, key: COMMS_KEY, version: "1.0.0", rules: [] },
  }),
);

/** For scripts/verify-prompts.ts: one entry per department (keys are labels only). */
export const COMMS_PROMPT_OWNERS: Readonly<Record<string, ScopedAgentLike>> = Object.freeze(
  Object.fromEntries(FIRM_SERVICES.map((d) => [`comms-${SLUG[d]}`, COMMS_SCOPES[d]])),
);
