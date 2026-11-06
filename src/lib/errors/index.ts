// Plain-language errors: turn whatever went wrong into the one sentence a person should read.
//
//   userMessage(err | code, context)  → a sentence: what happened and what to do next.
//   PlainError                        → throw this when the message is already written for a person.
//   runFailureMessage(stored)         → the sentence for an agent run's stored failure classification.
//   onboardingFailureMessage(stored)  → the same for an onboarding step's.
//
// Rules (README "Conventions"; the owner: "no codes on the error messages"):
//   - A JSON error body is { error: <sentence> }. A machine-readable `code` may sit beside it for
//     programs, but no page ever shows it (src/components/ui.ts call() returns only `error`).
//   - Never show an exception's own text: `(e as Error).message` can be a provider's raw reply, a
//     database code or a stack. Pass the error here instead; known causes get their sentence, and only
//     a genuinely unexpected one gets DEFAULT_MESSAGE (or the caller's `fallback`).
//   - The messages a module writes for people (PlainError and the classes in PLAIN_ERROR_NAMES) pass
//     through unchanged; the repo scan checks their wording at the source.
//
// Pure and client-safe: no server imports. Error classes are recognised by their `name`, which every
// class here sets explicitly (so it survives bundling).
import { isPlainMessage } from "./rules";
import { CODE_ALIASES, DEFAULT_MESSAGE, USER_MESSAGES, statusMessage, type MessageContext, type UserMessageCode } from "./messages";

export { DEFAULT_MESSAGE, USER_MESSAGES, CODE_ALIASES, statusMessage, type MessageContext, type UserMessageCode };
export { messageProblems, isPlainMessage } from "./rules";

/** An error whose message is a sentence written for the person who will read it. */
export class PlainError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, opts: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "PlainError";
    this.status = opts.status ?? 400;
    this.code = opts.code;
  }
}

/**
 * Error classes whose message is written for a person (each module's own sentences). Their message
 * is shown as it is; scripts/lib/plain-messages.ts scans every `new X(…)` of these for codes.
 */
export const PLAIN_ERROR_NAMES: readonly string[] = [
  "PlainError",
  "CloseLoopError",
  "OnboardingError",
  "SagaError",
  "TuriaConfirmError",
  "TuriaSessionError",
  "CompanionError",
  "CommsInputError",
  "OutlookDraftError",
  "ClientNameError",
  "ClientExistsError",
  "CertificateValidationError",
  "PlaceholderLeakError",
  "WrongDepartmentError",
  "WrongInputError",
  "InputTooLargeError",
  "XlsxLimitError",
  "BodyTooLargeError",
  "GstParseError",
  "OpinionLanguageError",
  "PathError",
  "NotProvisionedError",
  "HostRefusedError",
  "LegacyGateError",
  "InputRejectedError",
];

type ErrorLike = { name?: unknown; message?: unknown; code?: unknown; status?: unknown; kind?: unknown; scope?: unknown; action?: unknown };

const asErr = (e: unknown): ErrorLike | null => (e && typeof e === "object" ? (e as ErrorLike) : null);

function isCode(s: string): s is UserMessageCode {
  return Object.prototype.hasOwnProperty.call(USER_MESSAGES, s);
}

function fromCode(code: string, c: MessageContext): string | null {
  if (isCode(code)) return USER_MESSAGES[code](c);
  const alias = CODE_ALIASES[code];
  return alias ? USER_MESSAGES[alias](c) : null;
}

/** A Microsoft Graph / SharePoint / Outlook HTTP failure, by status. */
function microsoftMessage(status: number, c: MessageContext): string {
  if (status === 401 || status === 403) return USER_MESSAGES.microsoftDenied();
  if (status === 404) return USER_MESSAGES.microsoftMissing(c);
  if (status === 409) return USER_MESSAGES.fileAlreadyThere();
  if (status === 413) return USER_MESSAGES.tooLarge();
  return USER_MESSAGES.microsoftUnavailable(c);
}

/** A network-level failure (the browser or the server could not reach the other side). */
function networkMessage(e: ErrorLike): string | null {
  const name = String(e.name ?? "");
  const msg = String(e.message ?? "");
  if (name === "AbortError" || name === "TimeoutError" || /\b(?:ETIMEDOUT|timed? ?out)\b/i.test(msg)) return USER_MESSAGES.slow();
  if (/failed to fetch|fetch failed|networkerror|load failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg)) return USER_MESSAGES.offline();
  return null;
}

/**
 * The sentence a person reads for `err`: an Error, a code ("NOT_FOUND", "P2002", "aiBudget") or an
 * HTTP status. Known causes get their own sentence; anything else gets `context.fallback` or
 * DEFAULT_MESSAGE. Never returns an exception's raw text.
 */
export function userMessage(err: unknown, context: MessageContext = {}): string {
  if (typeof err === "number") return statusMessage(err, context);
  if (typeof err === "string") return fromCode(err, context) ?? (/\s/.test(err.trim()) && isPlainMessage(err) ? err : USER_MESSAGES.unexpected(context));
  const e = asErr(err);
  if (!e) return USER_MESSAGES.unexpected(context);
  const name = String(e.name ?? "");
  const message = typeof e.message === "string" ? e.message : "";

  // Messages written for a person.
  if (PLAIN_ERROR_NAMES.includes(name) && message && isPlainMessage(message)) return message;
  if ((name === "BlockedError" || name === "TuriaBlockedError") && typeof e.action === "string") return isPlainMessage(e.action) ? e.action : USER_MESSAGES.microsoftNotSetUp();

  // The AI router and the guardrails.
  if (name === "BudgetExceededError") return e.scope === "run" ? USER_MESSAGES.aiRunBudget(context) : USER_MESSAGES.aiBudget(context);
  if (name === "ProviderUnavailableError") return USER_MESSAGES.aiNotSetUp(context);
  if (name === "NoProviderAvailableError") return USER_MESSAGES.aiUnavailable(context);
  if (name === "ProviderError") {
    if (e.kind === "refusal") return USER_MESSAGES.aiRefused(context);
    if (e.kind === "auth") return USER_MESSAGES.aiNotSetUp(context);
    if (e.kind === "bad_request") return USER_MESSAGES.aiBadOutput(context);
    return USER_MESSAGES.aiUnavailable(context);
  }
  if (name === "ProviderOutputError") return USER_MESSAGES.aiBadOutput(context);
  if (name === "GroundingError") return USER_MESSAGES.aiUngrounded(context);
  if (name === "ScopeViolationError") return USER_MESSAGES.aiScope(context);
  if (name === "DictionaryUnavailableError") return USER_MESSAGES.aiLeakGate(context);

  // Microsoft 365, Turia, uploads.
  if (name === "GraphError" && typeof e.status === "number") return microsoftMessage(e.status, context);
  if (name === "ConflictError") return USER_MESSAGES.fileAlreadyThere();

  // The database (Prisma errors carry a code such as P2002; recognised without importing Prisma).
  if (typeof e.code === "string" && /^P\d{4}$/.test(e.code)) return fromCode(e.code, context) ?? USER_MESSAGES.recordsUnavailable();
  if (/^PrismaClient(?:Initialization|RustPanic|Unknown)/.test(name)) return USER_MESSAGES.recordsUnavailable();

  return networkMessage(e) ?? USER_MESSAGES.unexpected(context);
}

const AI_CAUSES: Record<string, string> = {
  NoProviderAvailableError: "The AI service was unavailable.",
  ProviderUnavailableError: "The AI service is not set up on the server.",
  ProviderOutputError: "The AI answer could not be used.",
  GroundingError: "The AI answer quoted figures or text that are not in the documents.",
  ScopeViolationError: "The AI answer went outside what this job allows.",
  DictionaryUnavailableError: "Client names could not be hidden from the AI, so nothing was sent to it.",
};

/**
 * The cause of a failure as one short sentence, for a line inside a larger result (a checklist row,
 * an onboarding note), or null when nothing safe can be said. A message written for a person is kept;
 * an error's own text is kept only when it reads as plain words (never a code, a stack or jargon).
 */
export function causeSentence(err: unknown): string | null {
  const e: ErrorLike | null = typeof err === "string" ? { message: err } : asErr(err);
  if (!e) return null;
  const name = String(e.name ?? "");
  const message = typeof e.message === "string" ? e.message.trim() : "";
  if (name === "AgentRunError") return /queued for a human/i.test(message) ? "The AI answer was held for a person to check." : "The AI answer could not be used.";
  if (name === "AbortError" || name === "TimeoutError" || /\btimed? ?out\b/i.test(message)) return "It took too long and was stopped.";
  if (name === "BudgetExceededError") return e.scope === "run" ? "This run's AI budget was used up." : "Today's AI budget for the firm is used up.";
  if (name === "ProviderError") return e.kind === "refusal" ? "The AI service declined the request." : e.kind === "auth" ? "The AI service is not set up on the server." : "The AI service was unavailable.";
  if (AI_CAUSES[name]) return AI_CAUSES[name];
  if (name === "GraphError") return "Microsoft 365 could not be reached.";
  if (message && message.length <= 300 && !/[\r\n]/.test(message) && isPlainMessage(message)) {
    // A sentence starts with a capital, unless it starts with a file name ("auditor.json is missing").
    const s = /^[\w.-]+\.[a-z]{2,5}\b/i.test(message) ? message : message[0].toUpperCase() + message.slice(1);
    return /[.?]$/.test(s) ? s : `${s}.`;
  }
  return null;
}

/**
 * For a catch block: what could not be done, why (when it can be said plainly), and what to do.
 *   failureSentence(e, "The return PDFs could not be read.", "Check that you uploaded the right PDFs and try again.")
 * A known cause (the AI, Microsoft 365, the database, the network, a module's own sentence) replaces
 * both parts with its own sentence; an error whose text reads as plain words is kept as the "why";
 * anything else gives `what` + `next` alone. The raw error is never shown.
 */
export function failureSentence(err: unknown, what: string, next: string, context: MessageContext = {}): string {
  const SENTINEL = "\u0000";
  const known = userMessage(err, { ...context, fallback: SENTINEL });
  if (known !== SENTINEL) return known;
  const cause = causeSentence(err);
  return [what, cause, next].filter(Boolean).join(" ");
}

/** The JSON body and status for a caught error in a route handler: `NextResponse.json(errorBody(e, { fallback }), { status })`. */
export function errorBody(err: unknown, context: MessageContext = {}): { error: string } {
  return { error: userMessage(err, context) };
}

/**
 * The sentence to show for a failed response: its JSON `error` (always a sentence from our routes),
 * otherwise the sentence for its status. Only `error` is read — never `code`, `reason` or the body.
 */
export function responseError(status: number, data: unknown, context: MessageContext = {}): string {
  const error = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
  return typeof error === "string" && error.trim() ? error : statusMessage(status, context);
}

/** For pages that call fetch() themselves: the sentence for a non-OK response (reads its JSON once). */
export async function readResponseError(res: Response, context: MessageContext = {}): Promise<string> {
  const data: unknown = await res.json().catch(() => null);
  return responseError(res.status, data, context);
}

// ------------------------------------------------------------------ form checks

/** Zod's own wording ("Required", "Expected string, received number", "Invalid enum value…"): never shown. */
const ZOD_DEFAULT = /^(?:Required|Invalid|Expected\b|String must|Number must|Array must|Unrecognized key|Too (?:small|big)|Unexpected|Input not instance|Date must|BigInt must|Set must|Value must|Function must)/;

/**
 * The first form-check problem as a sentence: the message a schema wrote for a person, or
 * `fallback` (USER_MESSAGES.badRequest) when the schema left zod's default wording.
 * Takes a ZodError (or anything with `issues`) without importing zod.
 */
export function validationMessage(err: { issues?: readonly { message?: string }[] } | null | undefined, fallback: string = USER_MESSAGES.badRequest()): string {
  const msg = err?.issues?.[0]?.message?.trim() ?? "";
  if (!msg || ZOD_DEFAULT.test(msg) || !/\s/.test(msg) || !isPlainMessage(msg)) return fallback;
  return msg;
}

// ------------------------------------------------------------------ agent runs

/**
 * An agent run stores a classification of its failure for IT and the audit (AgentRun.error: e.g.
 * "Model output not usable (schema: invalid at …)", "Scope violation: …", "provider: Claude
 * unavailable (529)"). This is the sentence the run page and the run API show instead.
 */
export function runFailureMessage(stored: string | null | undefined, context: MessageContext = {}): string {
  return storedFailureMessage(stored, { subject: "the pack", byHand: "prepare the pack by hand", fallback: RUN_FALLBACK, ...context });
}

/**
 * Any stored failure text (an agent run's, an onboarding step's) as the sentence to show: known
 * technical forms get their plain sentence, text already written for a person is kept, anything
 * else gets `context.fallback` (or DEFAULT_MESSAGE).
 */
export function storedFailureMessage(stored: string | null | undefined, context: MessageContext = {}): string {
  const c = context;
  const s = (stored ?? "").trim();
  if (!s) return USER_MESSAGES.unexpected(context);
  // Technical classifications first (they can contain words that read as plain).
  if (/^Scope violation\b/i.test(s)) return USER_MESSAGES.aiScope(c);
  if (/is not grounded in the documents|\bungrounded\b/i.test(s)) return USER_MESSAGES.aiUngrounded(c);
  if (/queued for a human/i.test(s)) return USER_MESSAGES.aiHeldForReview(c);
  if (/Model output not usable|not valid JSON|\bvalidator:|\bschema:|\bconfidence:/i.test(s)) return USER_MESSAGES.aiBadOutput(c);
  if (/AI budget for this run is exhausted/i.test(s)) return USER_MESSAGES.aiRunBudget(c);
  if (/Daily AI budget is exhausted/i.test(s)) return USER_MESSAGES.aiBudget(c);
  if (/^provider:/i.test(s)) {
    if (/declined the request|refusal/i.test(s)) return USER_MESSAGES.aiRefused(c);
    if (/rejected the credentials|not available \(not configured/i.test(s)) return USER_MESSAGES.aiNotSetUp(c);
    return USER_MESSAGES.aiUnavailable(c);
  }
  if (/\bNo provider\b|is unavailable and .* is not configured/i.test(s)) return USER_MESSAGES.aiUnavailable(c);
  if (/^BLOCKED\b|does not exist yet/i.test(s)) return USER_MESSAGES.microsoftNotSetUp();
  const graph = /\b(?:GET|POST|PUT|PATCH|DELETE) \S+ failed: (\d{3})\b/.exec(s);
  if (graph) return microsoftMessage(Number(graph[1]), c);
  if (/\btimed out\b/i.test(s)) return /Turia/i.test(s) ? USER_MESSAGES.turiaUnavailable() : USER_MESSAGES.slow();
  // Sentences written for a person (the guardrails' budget and masking sentences, input refusals).
  if (/\s/.test(s) && isPlainMessage(s)) return s;
  return USER_MESSAGES.unexpected(context);
}

/**
 * An onboarding step's stored failure classification (src/lib/agents/onboarding/run-errors.ts:
 * "Microsoft 365: GET request failed: 404", "database: P2002", "LMS client: a client with the same
 * name …") as the sentence the onboarding page shows. A classification with no sentence of its own
 * gets `context.fallback`; anything else is read as storedFailureMessage reads it.
 */
export function onboardingFailureMessage(stored: string | null | undefined, context: MessageContext = {}): string {
  const s = (stored ?? "").trim();
  const prisma = /^database: (P\d{4})\b/.exec(s);
  if (prisma) return fromCode(prisma[1], context) ?? USER_MESSAGES.recordsUnavailable();
  if (/^database: /.test(s)) return USER_MESSAGES.recordsUnavailable();
  if (/^LMS client: a client with the same\b/.test(s)) return USER_MESSAGES.alreadyExists({ subject: "a client with this name, folder name or PAN" });
  if (/^SharePoint: a file already exists\b/.test(s)) return USER_MESSAGES.fileAlreadyThere();
  if (/^Turia: (?:could not be reached|timed out)/.test(s)) return USER_MESSAGES.turiaUnavailable();
  if (/^Microsoft 365: could not be reached/.test(s)) return USER_MESSAGES.microsoftUnavailable(context);
  if (/^(?:SharePoint|Microsoft 365|LMS client|network|A request): /.test(s) && !/\b(?:GET|POST|PUT|PATCH|DELETE) \S+ failed: \d{3}\b|\btimed out\b/.test(s)) return USER_MESSAGES.unexpected(context);
  return storedFailureMessage(s, context);
}

/** A step's "what a person must do" text (BlockedError.action), or a plain stand-in when it names server settings. */
export function plainAction(action: string): string {
  return isPlainMessage(action) ? action : SETUP_ACTION;
}

const SETUP_ACTION = "This step needs IT to finish setting up the connection to Microsoft 365 or Turia. Nothing was lost — use Resume once IT has done it.";
const RUN_FALLBACK = "The agent could not finish this run, and nothing was approved or filed. Run it again, or prepare the pack by hand; if it keeps happening, tell IT.";
