// Words and phrases a client message must not use (Phase 10 tone rules), as data. Each entry says
// why and what to write instead; tone.ts matches them case-insensitively on word boundaries.
// Add to this list rather than to the code. Kept plain: the reader is a busy business owner.

export type BannedCategory = "jargon" | "legalese" | "vague-time" | "vague-amount" | "pressure";
export type BannedWord = { phrase: string; category: BannedCategory; instead: string };

export const BANNED_WORDS: readonly BannedWord[] = Object.freeze([
  // Office jargon and Indian-English stock phrases with a plainer equivalent.
  { phrase: "kindly", category: "jargon", instead: "please" },
  { phrase: "revert", category: "jargon", instead: "reply" },
  { phrase: "do the needful", category: "jargon", instead: "say exactly what is needed" },
  { phrase: "intimate", category: "jargon", instead: "tell" },
  { phrase: "intimation", category: "jargon", instead: "notice" },
  { phrase: "furnish", category: "jargon", instead: "send" },
  { phrase: "remit", category: "jargon", instead: "pay" },
  { phrase: "prior to", category: "jargon", instead: "before" },
  { phrase: "as per", category: "jargon", instead: "under / according to" },
  { phrase: "we request you to", category: "jargon", instead: "please" },
  { phrase: "at your end", category: "jargon", instead: "(leave out)" },
  { phrase: "PFA", category: "jargon", instead: "attached" },
  { phrase: "FYI", category: "jargon", instead: "(leave out)" },
  { phrase: "ITC", category: "jargon", instead: "input tax credit" },
  { phrase: "RCM", category: "jargon", instead: "reverse charge" },
  { phrase: "assessee", category: "jargon", instead: "you" },
  { phrase: "compliances", category: "jargon", instead: "filings" },
  { phrase: "u/s", category: "jargon", instead: "under section" },
  { phrase: "w.e.f.", category: "jargon", instead: "from" },
  { phrase: "w.r.t.", category: "jargon", instead: "about" },
  // Legalese.
  { phrase: "herewith", category: "legalese", instead: "(leave out)" },
  { phrase: "hereby", category: "legalese", instead: "(leave out)" },
  { phrase: "hereunder", category: "legalese", instead: "below" },
  { phrase: "aforesaid", category: "legalese", instead: "this" },
  { phrase: "aforementioned", category: "legalese", instead: "this" },
  { phrase: "abovementioned", category: "legalese", instead: "this" },
  { phrase: "thereof", category: "legalese", instead: "of it" },
  { phrase: "therein", category: "legalese", instead: "in it" },
  { phrase: "pursuant to", category: "legalese", instead: "under" },
  { phrase: "henceforth", category: "legalese", instead: "from now on" },
  { phrase: "notwithstanding", category: "legalese", instead: "despite" },
  { phrase: "inter alia", category: "legalese", instead: "including" },
  { phrase: "viz.", category: "legalese", instead: "namely" },
  { phrase: "vide", category: "legalese", instead: "by" },
  { phrase: "the undersigned", category: "legalese", instead: "I / we" },
  // Vague timing: give the date instead.
  { phrase: "asap", category: "vague-time", instead: "a specific date" },
  { phrase: "as soon as possible", category: "vague-time", instead: "a specific date" },
  { phrase: "at the earliest", category: "vague-time", instead: "a specific date" },
  { phrase: "at your earliest convenience", category: "vague-time", instead: "a specific date" },
  { phrase: "at your convenience", category: "vague-time", instead: "a specific date" },
  { phrase: "in due course", category: "vague-time", instead: "a specific date" },
  { phrase: "shortly", category: "vague-time", instead: "a specific date" },
  { phrase: "soon", category: "vague-time", instead: "a specific date" },
  // Vague amounts: give the amount instead.
  { phrase: "approximately", category: "vague-amount", instead: "the exact amount" },
  { phrase: "approx", category: "vague-amount", instead: "the exact amount" },
  { phrase: "roughly", category: "vague-amount", instead: "the exact amount" },
  { phrase: "ballpark", category: "vague-amount", instead: "the exact amount" },
  // Pressure and promises the firm cannot make in a draft.
  { phrase: "urgent", category: "pressure", instead: "the due date" },
  { phrase: "urgently", category: "pressure", instead: "the due date" },
  { phrase: "immediately", category: "pressure", instead: "the due date" },
  { phrase: "guarantee", category: "pressure", instead: "(leave out)" },
  { phrase: "guaranteed", category: "pressure", instead: "(leave out)" },
]);
