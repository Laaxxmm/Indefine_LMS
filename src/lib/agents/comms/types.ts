// Client comms drafts (Phase 10): the shared vocabulary. A draft is always a draft: the firm's
// staff copy it or open it as an Outlook draft in their own mailbox and send it themselves.
// Nothing in src/lib/agents/comms sends anything (non-negotiable 1). Pure.
import type { FirmService } from "@prisma/client";

/** CommsDraft.kind values (prisma/schema.prisma comment). */
export const COMMS_KINDS = ["status", "doc-chase", "due-reminder", "filing-completed", "query-response"] as const;
export type CommsKind = (typeof COMMS_KINDS)[number];

export const KIND_LABELS: Readonly<Record<CommsKind, string>> = Object.freeze({
  status: "Status update",
  "doc-chase": "Documents needed",
  "due-reminder": "Due-date reminder",
  "filing-completed": "Filing completed",
  "query-response": "Answer to a question",
});

/** FirmClient.preferredLanguage values. English is the default and is always kept alongside a translation. */
export const COMMS_LANGUAGES = ["en", "kn", "ta", "hi"] as const;
export type CommsLanguage = (typeof COMMS_LANGUAGES)[number];
export type TranslatedLanguage = Exclude<CommsLanguage, "en">;

export const LANGUAGE_LABELS: Readonly<Record<CommsLanguage, string>> = Object.freeze({ en: "English", kn: "Kannada", ta: "Tamil", hi: "Hindi" });

export const isCommsLanguage = (v: unknown): v is CommsLanguage => typeof v === "string" && (COMMS_LANGUAGES as readonly string[]).includes(v);

/** The ask of a due-date reminder (one ask per message). */
export const REMINDER_ASKS = ["confirm", "documents", "payment"] as const;
export type ReminderAsk = (typeof REMINDER_ASKS)[number];

/** Every FirmService, in schema order (department of a comms model task). */
export const FIRM_SERVICES: readonly FirmService[] = ["GST", "ROC", "IncomeTax", "TDS", "Books", "Audit", "Engagement"];

/** Limits that keep one message to one screen and one ask. */
export const LIMITS = Object.freeze({
  /** English body, greeting to signature. */
  maxWords: 180,
  /** Documents listed in one doc-chase message. */
  maxItems: 8,
  itemChars: 160,
  topicChars: 80,
  answerChars: 600,
  /** One template paragraph (the model's per-paragraph cap is NOTE_MAX, 300). */
  paragraphChars: 280,
});
