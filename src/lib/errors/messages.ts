// The sentences a person reads when something goes wrong, in one place. Each says what happened and
// what to do next, in the firm's words: no status numbers, no internal names, no blame, no
// exclamation marks (src/lib/errors/rules.ts is the check; tests/unit/plain-language-errors.test.ts
// runs it over this table and over every message in the repository).
//
// A message is a function of an optional context, so the same failure can name the thing it was
// working on ("The GST pack wasn't changed") and the by-hand alternative ("prepare it by hand").

export type MessageContext = {
  /** What was being worked on, in the person's words: "the GST pack", "the draft". Fills "… wasn't changed". */
  subject?: string;
  /** The by-hand alternative, as an instruction: "prepare it by hand", "answer the questions yourself". */
  byHand?: string;
  /** The sentence for an unexpected failure in this place, instead of DEFAULT_MESSAGE. */
  fallback?: string;
  /** For a wait: how long, already in words ("a minute", "40 minutes"). */
  wait?: string;
};

/** Only for genuinely unexpected failures — never in place of a known cause. */
export const DEFAULT_MESSAGE = "Something went wrong on our side. Try again, and if it keeps happening tell IT — nothing was changed.";

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** "The GST pack wasn't changed" / "Nothing was changed". */
const unchanged = (c: MessageContext) => (c.subject ? `${cap(c.subject)} wasn't changed` : "Nothing was changed");
const byHand = (c: MessageContext, dflt = "do this step by hand") => c.byHand ?? dflt;

export const USER_MESSAGES = {
  // ------------------------------------------------------------- who you are
  signIn: () => "Sign in to continue.",
  inactive: () => "Your account is not active. Ask an admin to reactivate it if you think this is wrong.",
  notAllowed: () => "You don't have permission to do this. Ask a partner or an admin if it needs doing.",
  adminsOnly: () => "Only admins can do this. Ask an admin if it needs doing.",
  adminsOrPartners: () => "Only admins and partners can do this. Ask one of them if it needs doing.",
  partnersOnly: () => "Only a partner can do this. Ask a partner.",
  managersOnly: () => "Only managers and partners can do this. Ask one of them.",
  noToolAccess: () => "You don't have access to this tool. Ask an admin to give you access.",
  noAgentAccess: () => "Your account can't use the agents. Ask an admin if you need them.",
  // ------------------------------------------------------------- the request
  badRequest: () => "Some details were missing or not in the right format. Check the form and try again.",
  unreadable: () => "The details sent could not be read. Reload the page and try again.",
  // ------------------------------------------------------------- records
  notFound: (c: MessageContext = {}) => `${c.subject ? cap(c.subject) : "That item"} wasn't found. It may have been removed — go back to the list and open it again.`,
  changedMeanwhile: () => "Someone else changed this while you were working on it. Reload the page to see the latest version, then try again.",
  alreadyExists: (c: MessageContext = {}) => `${c.subject ? cap(c.subject) : "That record"} already exists. Search for it instead of adding it again.`,
  // ------------------------------------------------------------- the platform
  busy: (c: MessageContext = {}) => `The system is busy. Wait ${c.wait ?? "a minute"}, then try again.`,
  offline: () => "The server could not be reached. Check your internet connection, then try again.",
  slow: () => "That took too long and was stopped. Try again in a minute; if it keeps happening, tell IT.",
  tooLarge: () => "That is too large to send in one go. Send a smaller file or fewer files at a time.",
  recordsUnavailable: () => "The firm's records could not be reached just now. Nothing was changed — wait a minute, then try again.",
  // ------------------------------------------------------------- the AI
  aiUnavailable: (c: MessageContext = {}) => `The AI service is unavailable right now. ${unchanged(c)} — try again in a few minutes, or ${byHand(c)}.`,
  aiBudget: (c: MessageContext = {}) => `Today's AI budget for the firm is used up. ${unchanged(c)} — ${byHand(c)}, or try again tomorrow.`,
  aiRunBudget: (c: MessageContext = {}) => `This run reached its AI spending limit before it finished. ${unchanged(c)} — ask a partner to raise the limit, or ${byHand(c)}.`,
  aiNotSetUp: (c: MessageContext = {}) => `The AI service is not set up on the server. ${unchanged(c)} — ask IT to add the AI key, or ${byHand(c)}.`,
  aiRefused: (c: MessageContext = {}) => `The AI service declined this request. ${unchanged(c)} — ${byHand(c)}.`,
  aiBadOutput: (c: MessageContext = {}) => `The AI service sent back an answer Firm OS could not use. ${unchanged(c)} — try again, or ${byHand(c)}.`,
  aiUngrounded: (c: MessageContext = {}) =>
    `The AI answer had figures or quotes that are not in the uploaded documents, so Firm OS set it aside. ${unchanged(c)} — check the documents and try again, or ${byHand(c)}.`,
  aiScope: (c: MessageContext = {}) => `The AI answer went outside what this job allows, so Firm OS set it aside. ${unchanged(c)} — try again, or ${byHand(c)}.`,
  aiLeakGate: (c: MessageContext = {}) =>
    `Firm OS stopped the AI step because client details could not be hidden from the AI. Nothing was sent, and ${unchanged(c).toLowerCase()} — try again; if it happens again, tell IT.`,
  aiHeldForReview: (c: MessageContext = {}) => `The AI answer was held for a person to check, so it was not used. ${unchanged(c)} — ${byHand(c)}, or try again later.`,
  aiRestricted: () => "This client has restricted AI processing. Prepare this by hand or ask a partner to lift the restriction.",
  // ------------------------------------------------------------- Microsoft 365
  microsoftNotConnected: () => "Connect your Microsoft 365 account on the Connect page first, then try again.",
  microsoftUnavailable: (c: MessageContext = {}) => `Microsoft 365 (SharePoint, OneDrive or Outlook) could not be reached just now. ${unchanged(c)} — try again in a few minutes.`,
  microsoftDenied: () => "Microsoft 365 refused access to that file or folder. Ask IT to check that Firm OS still has access to the firm's SharePoint.",
  microsoftMissing: (c: MessageContext = {}) => `${c.subject ? cap(c.subject) : "That file"} is no longer in SharePoint. It may have been moved or renamed — check the client's folder.`,
  microsoftNotSetUp: () => "The connection to Microsoft 365 is not set up on the server. Ask IT to finish the Microsoft 365 setup.",
  fileAlreadyThere: () => "A file with that name is already in the folder, and Firm OS never overwrites files. Rename the file, then upload it again.",
  // ------------------------------------------------------------- Turia
  turiaExpired: () => "The Turia sign-in saved in Firm OS has expired. Sign in to Turia again and paste the new session details on the Neo Centra page.",
  turiaUnavailable: () => "Turia could not be reached just now. Nothing was changed — try again in a few minutes.",
  // ------------------------------------------------------------- the default
  unexpected: (c: MessageContext = {}) => c.fallback ?? DEFAULT_MESSAGE,
} as const satisfies Record<string, (c?: MessageContext) => string>;

export type UserMessageCode = keyof typeof USER_MESSAGES;

/**
 * Internal codes other modules use, mapped to the sentence a person sees: the state machine's deny
 * codes, close-loop / companion / onboarding error codes, Prisma error codes. Codes stay in logs and
 * in a JSON `code` field for programs; this is the only way they turn into text.
 */
export const CODE_ALIASES: Readonly<Record<string, UserMessageCode>> = {
  UNAUTHORIZED: "signIn",
  UNAUTHENTICATED: "signIn",
  FORBIDDEN: "notAllowed",
  forbidden: "notAllowed",
  NOT_FOUND: "notFound",
  "not-found": "notFound",
  CONFLICT: "changedMeanwhile",
  conflict: "changedMeanwhile",
  state: "changedMeanwhile",
  STALE: "changedMeanwhile",
  INVALID: "badRequest",
  invalid: "badRequest",
  BAD_REQUEST: "badRequest",
  RATE_LIMITED: "busy",
  busy: "busy",
  AI_RESTRICTED: "aiRestricted",
  restricted: "aiRestricted",
  // Prisma: unique constraint, record missing, write conflict, pool timeout, database unreachable.
  P2002: "alreadyExists",
  P2025: "notFound",
  P2034: "changedMeanwhile",
  P2024: "busy",
  P1001: "recordsUnavailable",
  P1002: "recordsUnavailable",
  P1008: "recordsUnavailable",
  P1017: "recordsUnavailable",
};

/** The sentence for an HTTP status when the response carried no message of its own. */
export function statusMessage(status: number, c: MessageContext = {}): string {
  if (status === 401) return USER_MESSAGES.signIn();
  if (status === 403) return USER_MESSAGES.notAllowed();
  if (status === 404) return USER_MESSAGES.notFound(c);
  if (status === 409) return USER_MESSAGES.changedMeanwhile();
  if (status === 413) return USER_MESSAGES.tooLarge();
  if (status === 429) return USER_MESSAGES.busy(c);
  if (status === 400 || status === 422) return USER_MESSAGES.badRequest();
  if (status === 502 || status === 503 || status === 504) return USER_MESSAGES.busy(c);
  return USER_MESSAGES.unexpected(c);
}
