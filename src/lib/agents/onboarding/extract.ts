// Extractor: one plain-English sentence → a partial OnboardingSpec, through the ModelRouter only
// (privacy 'anonymize-then-cloud', difficulty 'sop'). The router masks PII before the model sees
// it and unmasks the answer; the dictionary built here adds staff names and the client's
// company name so those are masked too. Everything after the model is deterministic code.
//
// ADR-009 (prompt injection): the sentence may be pasted from a client e-mail, so it is untrusted
// data. It is screened first (a hit is never sent: the person answers the clarifier's questions
// and is told why) and fenced as data in the message the model receives.
import type { DictionaryEntry, ModelRequest, RouterResult } from "@/lib/ai/router";
import { UNTRUSTED_DATA_INSTRUCTION, fenceUntrusted, patternLabel, screenText, visibleExcerpt, type WithheldItem } from "@/lib/agents/core/guardrails/untrusted";
import { limitsFor } from "@/lib/agents/core/guardrails/limits";
import { resolvePeople, type Person } from "./people";
import { ENTITY_TYPES, ExtractedSpec, FIRM_SERVICES, mergeSpec, normalizeExtracted, type PartialSpec } from "./spec";
import { causeSentence } from "@/lib/errors";

export interface ExtractRouter {
  run<T>(req: ModelRequest<T>): Promise<RouterResult<T>>;
}

export interface ExtractOptions {
  router: ExtractRouter;
  runId: string;
  /** Active people, for the masking dictionary and for resolving assignee / reviewer names. */
  people?: Person[];
  /** Spec gathered so far (a follow-up sentence refines it). */
  base?: PartialSpec;
  maxCostInr?: number;
}

export interface ExtractResult {
  spec: PartialSpec;
  /** Candidates when a name matched several people. */
  candidates: { assigneeId: Person[]; reviewerId: Person[] };
  /** The router could not give a confident answer: a partner should check the fields. */
  needsReview: boolean;
  /** Plain-language notes for the person (queued, low confidence…). */
  notes: string[];
  /** Set when the injection screen kept the sentence away from the model (ADR-009). */
  withheld?: WithheldItem[];
}

export const EXTRACT_TASK = "onboarding.extract-spec" as const;

export const EXTRACT_SYSTEM = [
  "You turn one onboarding request written by a chartered accountant in India into structured onboarding fields for a new client.",
  UNTRUSTED_DATA_INSTRUCTION,
  "Fill only what the instruction states. Leave a field out when it is not stated; never guess codes, numbers or names.",
  `entityType is one of: ${Object.entries(ENTITY_TYPES).map(([k, v]) => `${k} (${v})`).join(", ")}.`,
  `services[].service is one of: ${FIRM_SERVICES.join(", ")}. "Income tax"/ITR → IncomeTax; "bookkeeping"/"accounts" → Books; "annual filing"/"MCA" → ROC; "GST returns" → GST; "engagement letter" → Engagement.`,
  "services[].frequency is MONTHLY, QUARTERLY or ANNUAL when stated. QRMP or quarterly GST → QUARTERLY.",
  "fy is the financial year as YYYY-YY, e.g. 2026-27. firstPeriod is the first month as YYYY-MM (or Q1–Q4 if a quarter is given).",
  "assigneeName is who will do the work (\"assign X\"); reviewerName is who reviews it.",
  "turnoverInr is the annual turnover in rupees as a number (1 crore = 10000000, 1 lakh = 100000).",
  "booksSoftware is Tally, Zoho or Other.",
].join("\n");

const ORG_SUFFIX = "(?:Private\\s+Limited|Pvt\\.?\\s*Ltd\\.?|Public\\s+Limited|Limited|Ltd\\.?|LLP|& Co\\.?|and Co\\.?|& Associates|Associates|Enterprises|Industries|Traders|Trust|Foundation|Society)";
const ORG_RE = new RegExp(`((?:[A-Z][\\w&.'-]*\\s+){0,5}[A-Z][\\w&.'-]*\\s+${ORG_SUFFIX})(?![\\w])`, "g");
const LEADING_VERB = /^(?:Onboard|Add|Create|Set\s+up|Setup|New|Client|Register)\s+/i;

/**
 * Masking dictionary for one prompt: every active person's full and first name (class B staff
 * data never needs to reach a model) and company-like spans ("Acme Widgets Pvt Ltd").
 */
export function buildDictionary(prompt: string, people: Person[] = []): DictionaryEntry[] {
  const out = new Map<string, DictionaryEntry>();
  for (const p of people) {
    const full = p.name.trim();
    if (full.length >= 3) out.set(full.toLowerCase(), { value: full, kind: "NAME" });
    const first = full.split(/\s+/)[0];
    if (first && first.length >= 3) out.set(first.toLowerCase(), { value: first, kind: "NAME" });
  }
  for (const m of prompt.matchAll(ORG_RE)) {
    const org = m[1].replace(/\s+/g, " ").replace(LEADING_VERB, "").trim();
    if (org.split(/\s+/).length >= 2) out.set(org.toLowerCase(), { value: org, kind: "ORG" });
  }
  return [...out.values()];
}

/** What the person reads when the text is longer than the AI may read in one call. */
export const TOO_LONG_NOTE = "This text is longer than the AI may read at once, so only its first part was read. Check every field below, and add anything that is missing.";

/** What the person reads when the screen keeps their sentence away from the model. */
export const WITHHELD_NOTE =
  "Part of this sentence reads like an instruction to the AI system rather than a description of the client, so it was not sent for automatic reading. Answer the questions below instead.";

export async function extractSpec(prompt: string, opts: ExtractOptions): Promise<ExtractResult> {
  const people = opts.people ?? [];
  const notes: string[] = [];
  const patterns = screenText(prompt);
  if (patterns.length) {
    const withheld: WithheldItem[] = [{ location: "onboarding request", patterns, excerpt: visibleExcerpt(prompt) }];
    const { spec, candidates } = resolvePeople(mergeSpec(opts.base ?? {}, {}), people);
    return { spec, candidates, needsReview: true, notes: [`${WITHHELD_NOTE} (The text ${patternLabel(patterns[0])}.)`], withheld };
  }
  // ADR-009 (LLM10): the task's input and output limits apply; a longer text is cut and the person is told.
  const limits = limitsFor(EXTRACT_TASK);
  const maxChars = limits.maxInputTokens * 4;
  const sent = prompt.length > maxChars ? prompt.slice(0, maxChars) : prompt;
  if (sent !== prompt) notes.push(TOO_LONG_NOTE);
  // A router failure (no API key, provider outage, budget used up) must not stop onboarding:
  // the person answers the clarifier's questions instead. The reason is shown, never hidden.
  const result = await opts.router
    .run<ExtractedSpec>({
      task: EXTRACT_TASK,
      privacy: "anonymize-then-cloud",
      difficulty: "sop",
      maxTokens: limits.maxOutputTokens,
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: fenceUntrusted(sent) },
      ],
      schema: ExtractedSpec,
      dictionary: buildDictionary(prompt, people),
      runId: opts.runId,
      maxCostInr: opts.maxCostInr,
    })
    .catch((e: unknown) => ({ status: "error" as const, reason: causeSentence(e) ?? "" }));

  let extracted: ExtractedSpec | null = null;
  let needsReview = false;
  if (result.status === "error") {
    notes.push(`The description could not be read automatically.${result.reason ? ` ${result.reason}` : ""} Answer the questions below instead.`);
  } else if (result.status === "ok") {
    extracted = result.output;
    needsReview = result.needsPartnerReview;
  } else if (result.status === "needs-review") {
    extracted = result.output;
    needsReview = true;
    notes.push("The model was not confident about this sentence. Check every field before creating anything.");
  } else {
    notes.push("Automatic reading is not available right now. Answer the questions below instead.");
  }

  const patch = extracted ? normalizeExtracted(extracted) : {};
  const merged = mergeSpec(opts.base ?? {}, patch);
  const { spec, candidates } = resolvePeople(merged, people);
  return { spec, candidates, needsReview, notes };
}
