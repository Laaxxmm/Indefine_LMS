// DPDP anonymizer (orchestrator NON-NEGOTIABLE #3). Every cloud model call goes through
// ModelRouter → mask() before and unmask() after. Client PII is replaced by reversible tokens
// such as ⟨PAN_1⟩; the same value maps to the same token within one TokenMap, and the map lives
// only in memory for the duration of the run — it is never sent, logged or stored.
//
// Policy: when unsure, mask. A false positive costs a little model accuracy; a false negative
// is a DPDP breach. Pure module: no I/O.
//
// How mask() works (security audit findings #3 / #26):
//   1. A normalised VIEW of the text is matched, never the text itself: NFKC (fullwidth → ASCII),
//      Unicode format characters removed (zero-width space / joiner, BOM, soft hyphen, bidi marks),
//      Cyrillic / Greek look-alikes folded to Latin, Indic digits to ASCII, dashes to "-". Every view
//      character remembers the original characters it came from, so a match replaces exactly the
//      original text (which also restores exactly on unmask).
//   2. Maskers run in priority order over the view; a claimed span is blanked in the view so later
//      maskers cannot match across or inside it. Shapes are tolerant: PAN / GSTIN / Aadhaar /
//      phone with space, dot or hyphen separators (and the letter-spaced PAN-card / Form 16
//      layout), UPI handles (name@okhdfcbank), passport and voter-ID numbers, bank accounts with
//      or without an "account" label, dates of birth with the label before or after, addresses
//      with a door number, payee names in bank narrations, and dictionary names with their usual
//      variants ("Kumar, Rajesh", "R. Kumar", the first name or surname alone, an organisation's
//      acronym "AWPL"), written with "_", "-" or "." between the words, in camelCase
//      ("RajeshKumarSharma"), glued ("RAJESHKUMARSHARMA") or in Devanagari / Kannada script
//      (transliterate.ts). Re-audit NEW-1: in "full" scope the free-text name extractor
//      (names.ts personNameSpans: honorifics, `Name of …:` labels, UPI / NEFT payees, runs of
//      capitalised non-business words) masks what is left in place; callers add the names it
//      finds to the dictionary first (withTextNames, the router's withMessageNames, the runner's
//      run dictionary) so every variant of such a name is masked too.
//   3. Text that already looks like a token ("⟨PAN_1⟩" typed into a document) can never collide
//      with a real token of the run: the router masks it as ⟨LITERAL_n⟩ (literals: "all"); by
//      default it is kept as written and its number reserved, so re-masking stored text is stable.
//
// detectPii() is an INDEPENDENT, stricter detector (its own patterns and its own dictionary
// check, run over the masked text): the router uses it as a post-mask leak gate and refuses to
// send a payload in which it finds anything. With `names: true` it also runs the free-text name
// extractor over the masked text: a probable person name that survived masking stops the call.
import type { DictionaryEntry } from "./types";
import { dedupeDictionary, isBusinessWord, ORG_GENERIC_WORDS, HONORIFICS, NAME_STOPWORDS, personNames, personNameSpans } from "./names";
import { INDIC_LETTER, INDIC_WORD, indicKey, phoneticKey } from "./transliterate";

export type PiiKind =
  | "PAN"
  | "GSTIN"
  | "AADHAAR"
  | "CIN"
  | "LLPIN"
  | "DIN"
  | "TAN"
  | "IFSC"
  | "BANK_AC"
  | "PHONE"
  | "EMAIL"
  | "UPI"
  | "DOB"
  | "PASSPORT"
  | "VOTER_ID"
  | "NAME"
  | "ORG"
  | "ADDRESS"
  | "PIN"
  | "LITERAL";

export interface TokenMap {
  /** ⟨KIND_n⟩ → original text, exactly as it appeared (first occurrence). */
  byToken: Map<string, string>;
  /** KIND + original (names: case- and spacing-insensitive) → token, so repeats reuse the token. */
  byValue: Map<string, string>;
  counters: Partial<Record<PiiKind, number>>;
}

/**
 * Token-looking text already in the input ("⟨PAN_1⟩"):
 *   "keep" (default)  left as written, and its number is reserved so no new token of this map can
 *                     ever equal it — re-masking stored masked text is idempotent (#26 safe);
 *   "all"             masked itself as ⟨LITERAL_n⟩ (the router does this for every client message:
 *                     the model never sees text that looks like one of the run's tokens);
 *   "none"            ignored (fixed firm text whose placeholder examples must stay as written).
 */
export type LiteralMode = "keep" | "all" | "none";

export interface MaskContext {
  /** Client-master names, companies and addresses (matched case-insensitively, longest first, with name variants). */
  dictionary?: DictionaryEntry[];
  /** Continue an existing map (several messages of one request share one map). */
  map?: TokenMap;
  /** Token-looking text in the input ("⟨PAN_1⟩"): see LiteralMode. Default "keep" ("none" for structured scope). */
  literals?: LiteralMode;
  /**
   * "full" (default) or "structured": identifiers and dictionary names only — no name heuristics
   * (narration payees, JSON name fields) and, by default, no literal escaping. For fixed firm text
   * such as a system prompt, where a capitalised phrase is not a person.
   */
  scope?: "full" | "structured";
  /** Clock for the date-of-birth heuristic (a full date this old is masked without a label). Default: now. */
  now?: Date;
}

export interface MaskResult {
  masked: string;
  map: TokenMap;
  /** Over-long values / message cut before masking (capLongRuns), or null when nothing was cut. */
  truncated: { runs: number; chars: number } | null;
}

// ---------------------------------------------------------------- size caps (audit #12)

/** Longest message mask() reads; the rest is cut (above every task's input limit, ADR-009). */
export const MAX_MASK_CHARS = 600_000;
/** Longest value without a space or delimiter (one CSV cell, one JSON string) sent as is. */
export const MAX_RUN_CHARS = 1_024;

const LONG_RUN = new RegExp(`[^\\s,;|"'{}\\[\\]()<>]{${MAX_RUN_CHARS + 1},}`, "g");
const grouped = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const cutMarker = (n: number) => ` […${grouped(n)} characters not sent]`;

/**
 * Cut a message to MAX_MASK_CHARS and every value longer than MAX_RUN_CHARS (a 64 KB register
 * cell, a pasted blob) to its first MAX_RUN_CHARS characters, with a visible marker. Keeps masking
 * linear and bounded; `runs` / `chars` let the caller flag what was not sent.
 */
export function capLongRuns(text: string, maxRun: number = MAX_RUN_CHARS, maxChars: number = MAX_MASK_CHARS): { text: string; runs: number; chars: number } {
  let runs = 0;
  let chars = 0;
  let s = text;
  if (s.length > maxChars) {
    runs++;
    chars += s.length - maxChars;
    s = s.slice(0, maxChars) + cutMarker(s.length - maxChars);
  }
  const re = maxRun === MAX_RUN_CHARS ? new RegExp(LONG_RUN.source, "g") : new RegExp(`[^\\s,;|"'{}\\[\\]()<>]{${maxRun + 1},}`, "g");
  s = s.replace(re, (run) => {
    let keep = maxRun;
    const code = run.charCodeAt(keep - 1);
    if (code >= 0xd800 && code <= 0xdbff) keep--; // never split a surrogate pair
    runs++;
    chars += run.length - keep;
    return run.slice(0, keep) + cutMarker(run.length - keep);
  });
  return { text: s, runs, chars };
}

export function createTokenMap(): TokenMap {
  return { byToken: new Map(), byValue: new Map(), counters: {} };
}

const PLACEHOLDER_SOURCE = "⟨[A-Z]+(?:_[A-Z]+)*_\\d+⟩";
const tokenRe = () => new RegExp(PLACEHOLDER_SOURCE, "g");

// ---------------------------------------------------------------- validators (pure, exported)

/** GST state / UT codes: 01–38, plus 97 (Other Territory) and 99 (Centre Jurisdiction). */
export const GST_STATE_CODES: ReadonlySet<string> = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, "0")),
  "97",
  "99",
]);

const PAN_SHAPE = /^[A-Z]{5}\d{4}[A-Z]$/;
export function isPanShape(v: string): boolean {
  return PAN_SHAPE.test(v);
}

const B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** GSTIN check character (mod-36, weights alternating 1/2 from the left over the first 14 chars). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = B36.indexOf(first14[i]);
    if (v < 0) throw new Error(`invalid GSTIN character ${first14[i]}`);
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return B36[(36 - (sum % 36)) % 36];
}

const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** Valid state code + embedded PAN shape + entity char + 'Z' + correct checksum. */
export function isValidGstin(v: string): boolean {
  return GSTIN_SHAPE.test(v) && GST_STATE_CODES.has(v.slice(0, 2)) && gstinCheckChar(v.slice(0, 14)) === v[14];
}

// Verhoeff tables (dihedral group D5).
const VD = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VP = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VINV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const r = digits.split("").reverse();
  for (let i = 0; i < r.length; i++) c = VD[c][VP[i % 8][Number(r[i])]];
  return c === 0;
}

export function verhoeffCheckDigit(digits: string): string {
  let c = 0;
  const r = digits.split("").reverse();
  for (let i = 0; i < r.length; i++) c = VD[c][VP[(i + 1) % 8][Number(r[i])]];
  return String(VINV[c]);
}

/** 12 digits, first 2–9, Verhoeff-valid (separators allowed). */
export function isValidAadhaar(v: string): boolean {
  const d = v.replace(/[\s.-]/g, "");
  return /^[2-9]\d{11}$/.test(d) && verhoeffValid(d);
}

// ---------------------------------------------------------------- normalised view

const ASCII_ONLY = /^[\x00-\x7F]*$/;
const FORMAT_CHAR = /^\p{Cf}$/u;
const DASH_CHAR = /^[‐-―−﹘﹣]$/;
/** Indic and Arabic-Indic digit blocks (zero code points); NFKC leaves these alone. */
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x1040];
/** Cyrillic and Greek letters that look like Latin ones. */
const CONFUSABLE: Readonly<Record<string, string>> = {
  А: "A", В: "B", С: "C", Е: "E", Н: "H", І: "I", Ј: "J", К: "K", М: "M", О: "O", Р: "P", Ѕ: "S", Т: "T", Х: "X", У: "Y", Ԛ: "Q", Ԝ: "W",
  а: "a", с: "c", е: "e", һ: "h", і: "i", ј: "j", ӏ: "l", о: "o", р: "p", ԛ: "q", ѕ: "s", ԝ: "w", х: "x", у: "y",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  ο: "o", ν: "v", ι: "i", κ: "k", ρ: "p", υ: "u",
};

function foldCodePoint(ch: string, cp: number): string {
  if (FORMAT_CHAR.test(ch)) return "";
  for (const z of DIGIT_ZEROS) if (cp >= z && cp <= z + 9) return String(cp - z);
  let out = "";
  for (const c of ch.normalize("NFKC")) out += CONFUSABLE[c] ?? (DASH_CHAR.test(c) ? "-" : FORMAT_CHAR.test(c) ? "" : c);
  return out;
}

/** The text as maskers match it, and where each view character came from in the original. */
interface View {
  norm: string;
  /** Original start / end index of each view character; null when the view is the text (ASCII). */
  starts: Int32Array | null;
  ends: Int32Array | null;
}

function normalizeView(text: string): View {
  if (ASCII_ONLY.test(text)) return { norm: text, starts: null, ends: null };
  const parts: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) as number;
    const len = cp > 0xffff ? 2 : 1;
    const ch = len === 1 ? text[i] : text.slice(i, i + 2);
    const f = cp < 0x80 ? ch : foldCodePoint(ch, cp);
    for (let k = 0; k < f.length; k++) {
      starts.push(i);
      ends.push(i + len);
    }
    parts.push(f);
    i += len;
  }
  return { norm: parts.join(""), starts: Int32Array.from(starts), ends: Int32Array.from(ends) };
}

/** The normalised form maskers compare against (exported for the leak gate and tests). */
export function normalizeForMatching(text: string): string {
  return normalizeView(text).norm;
}

// ---------------------------------------------------------------- patterns

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const NUM_END = "(?![\\d]|[.,]\\d)"; // not followed by more digits / decimal part
const NUM_START = "(?<![\\d.,])"; // not inside an amount like 1,23,456.00
// For runs of 8+ digits a neighbouring comma cannot be Indian digit grouping (groups are 2–3
// digits), so a comma there is a CSV delimiter: "name,9876543210,500" is a phone in a cell.
const CELL_END = "(?![\\d]|\\.\\d)";
const CELL_START = "(?<![\\d.])";
const DATE_SOURCE = [
  "\\b\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4}\\b",
  "\\b\\d{4}-\\d{2}-\\d{2}\\b",
  `\\b\\d{1,2}(?:st|nd|rd|th)?[\\s-]{1,3}${MONTH}\\.?,?[\\s-]{1,3}\\d{4}\\b`,
  `\\b${MONTH}\\.?\\s{1,3}\\d{1,2}(?:st|nd|rd|th)?,?\\s{1,3}\\d{4}\\b`,
].join("|");

/**
 * Pattern shapes (exported for callers that look for one kind, e.g. comms/pii.ts, and for the
 * timing tests). Every quantifier is bounded or anchored so a long run without delimiters stays
 * linear. mask() uses the tolerant variants in M below.
 */
export const PATTERNS = {
  // Bounded local part / labels and anchored at the start of a run: linear on a long run with no '@' (audit #12).
  EMAIL: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g,
  DATE: new RegExp(DATE_SOURCE, "gi"),
  GSTIN: /(?<![A-Za-z0-9])\d{2}[A-Za-z]{5}\d{4}[A-Za-z][0-9A-Za-z][Zz][0-9A-Za-z](?![A-Za-z0-9])/g,
  CIN: /(?<![A-Za-z0-9])[LUlu]\d{5}[A-Za-z]{2}\d{4}[A-Za-z]{3}\d{6}(?![A-Za-z0-9])/g,
  LLPIN: /(?<![A-Za-z0-9-])[A-Za-z]{3}-\d{4}(?![\d-])/g,
  TAN: /(?<![A-Za-z0-9])[A-Za-z]{4}\d{5}[A-Za-z](?![A-Za-z0-9])/g,
  IFSC: /(?<![A-Za-z0-9])[A-Za-z]{4}0[A-Za-z0-9]{6}(?![A-Za-z0-9])/g,
  // Letters-only lookarounds so a PAN glued to digits (a malformed GSTIN) is still caught.
  PAN: /(?<![A-Za-z])[A-Za-z]{5}\d{4}[A-Za-z](?![A-Za-z])/g,
  AADHAAR: new RegExp(`${NUM_START}[2-9]\\d{3}([ -]?)\\d{4}\\1\\d{4}${NUM_END}`, "g"),
  BANK_AC: new RegExp(`${NUM_START}\\d(?:[ -]?\\d){8,17}${NUM_END}`, "g"),
  PHONE: new RegExp(`(?<![\\d+.,])(?:(?:\\+|00)\\s?91[\\s-]?|0)?[6-9](?:[\\s-]?\\d){9}${NUM_END}`, "g"),
  DIN: new RegExp(`${NUM_START}\\d{8}${NUM_END}`, "g"),
  PIN: new RegExp(`${NUM_START}[1-9]\\d{2}\\s?\\d{3}${NUM_END}`, "g"),
} as const;

/** Five-letter words that start an ordinary "MARCH 2026 A" phrase, not a spaced PAN (shared by mask() and the leak gate so they agree). */
const NOT_PAN_WORD = "(?!(?:MARCH|APRIL|TOTAL|SALES|BATCH|CLASS|PHASE|BLOCK|LEVEL|FLOOR|SHEET|STAGE|GRADE|TABLE|FORMS|ITEMS|UNITS|NOTES|ROUND)[\\s.-])";

/** The tolerant shapes mask() matches on the normalised view. */
const M = {
  LITERAL: /⟨[^⟨⟩\n]{0,64}⟩/g,
  EMAIL_SPOKEN: new RegExp(
    "(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}\\s{0,2}(?:\\(at\\)|\\[at\\]|\\sat\\s)\\s{0,2}[A-Za-z0-9-]{1,63}" +
      "(?:\\s{0,2}(?:\\(dot\\)|\\[dot\\]|\\sdot\\s|\\.)\\s{0,2}[A-Za-z0-9-]{1,63}){0,3}\\s{0,2}(?:\\(dot\\)|\\[dot\\]|\\sdot\\s)\\s{0,2}" +
      "(?:com|in|org|net|co|gov|edu|io|biz|info|me)(?![A-Za-z0-9])",
    "gi",
  ),
  DATE: new RegExp(DATE_SOURCE, "gi"),
  GSTIN: /(?<![A-Za-z0-9])\d{2}[\s.-]?[A-Za-z]{5}[\s.-]?\d{4}[\s.-]?[A-Za-z][\s.-]?[0-9A-Za-z][Zz][0-9A-Za-z](?![A-Za-z0-9])/g,
  CIN: PATTERNS.CIN,
  LLPIN: PATTERNS.LLPIN,
  TAN: PATTERNS.TAN,
  IFSC: PATTERNS.IFSC,
  /** PAN-card / Form 16 layout: one character per box ("A B C D E 1 2 3 4 F"). */
  PAN_BOXED: /(?<![A-Za-z0-9])[A-Z](?:[ .-][A-Z]){4}[ .-]{1,3}\d(?:[ .-]?\d){3}[ .-]{1,3}[A-Z](?![A-Za-z0-9])/g,
  /** "ABCDE 1234 F", "ABCDE.1234.F", "ABCDE-1234-F". */
  PAN_SPACED: new RegExp(`(?<![A-Za-z0-9])${NOT_PAN_WORD}[A-Z]{5}[\\s.-]{1,2}\\d{4}[\\s.-]{0,2}[A-Z](?![A-Za-z0-9])|(?<![A-Za-z0-9])[A-Z]{5}\\d{4}[\\s.-]{1,2}[A-Z](?![A-Za-z0-9])`, "g"),
  /** Any case; may be glued to digits (a malformed GSTIN) or to a following word ("…1234Fbank.pdf"). */
  PAN: /(?<![A-Za-z])[A-Za-z]{5}\d{4}[A-Za-z]/g,
  PASSPORT: /(?<![A-Za-z0-9])[A-Za-z][\s-]?\d{7}(?![A-Za-z0-9])/g,
  VOTER_ID: /(?<![A-Za-z0-9])[A-Za-z]{3}[\s-]?\d{7}(?![A-Za-z0-9])/g,
  AADHAAR: new RegExp(`${CELL_START}[2-9]\\d{3}([\\s.-]?)\\d{4}\\1\\d{4}${CELL_END}`, "g"),
  BANK_AC: new RegExp(`${CELL_START}\\d(?:[ -]?\\d){8,17}${CELL_END}`, "g"),
  PHONE: new RegExp(`(?<![\\d+.])(?:(?:\\+|00)\\s?91[\\s.-]?|\\(\\+?91\\)\\s?|0[\\s-]?)?(?:[6-9](?:[\\s-]?\\d){9}|[6-9]\\d{4}\\.\\d{5})${CELL_END}`, "g"),
  /** 11–18 digits, no label: a bank account unless the context says invoice / e-way bill / amount. */
  BANK_AC_FREE: new RegExp(`(?<![\\dA-Za-z.])\\d{11,18}(?![\\dA-Za-z]|\\.\\d)`, "g"),
  DIN: new RegExp(`${CELL_START}\\d{8}${CELL_END}`, "g"),
  PIN: PATTERNS.PIN,
  /** JSON string values of name-like keys ("employee": "…"). */
  NAME_KEY: /"([A-Za-z][A-Za-z_-]{1,39})"\s{0,3}:\s{0,3}"([^"\\\n\uE000\uE001]{2,160})"/g,
} as const;

const CONTEXT = {
  DOB: /\b(?:dob|d\.o\.b|date\s+of\s+birth|birth\s*date|born(?:\s+on)?|birthday)\b/i,
  DOB_AFTER: /^\s{0,3}[([]?\s{0,2}(?:dob|d\.o\.b\.?|date\s+of\s+birth|birth\s*date|born)\b/i,
  LLP: /\bLLP(?:IN)?\b/i,
  AADHAAR: /\b(?:aadh?aa?r|uid|uidai|uin)\b/i,
  ACCOUNT: /(?:\ba\/c|\bacct|\baccount|\bac\s*no\b|\bbank\b|\bsb\s*a\/?c)/i,
  DIN: /\bDIN\b|director\s+identification|\bdirector\b/i,
  PASSPORT: /\bpass\s?port\b|\bppt\s*no\b/i,
  VOTER: /\bvoter\b|\bepic\b|\belection\s+(?:id|card|commission)\b/i,
  CURRENCY_END: /(?:₹|\brs\.?|\binr)\s{0,2}$/i,
  /** A labelled document number, not an account: invoice, bill, e-way bill, IRN, ARN, order… */
  NOT_ACCOUNT: /(?:\binv(?:oice)?|\bbill\b|\bvoucher|\bvch\b|\bchallan|\be-?\s?way|\bewb|\back(?:nowledgement)?\b|\birn\b|\barn\b|\breceipt|\border\b|\bpo\b|\bgrn\b|\bhsn\b|\bsac\b|\bcin\b|\bsrn\b|\bdoc(?:ument)?\b)[^\n]{0,24}$/i,
  ADDRESS:
    /\b(?:address|addr|pin\s*code|pincode|pin|postal|road|rd|street|st|lane|nagar|layout|cross|main|floor|block|sector|colony|district|taluk|village|post|bengaluru|bangalore|mysuru|mysore|mumbai|delhi|chennai|hyderabad|kolkata|pune|ahmedabad|karnataka|maharashtra|tamil\s+nadu|kerala|telangana|gujarat)\b/i,
  /** A door / house / flat number: where a postal address starts. */
  DOOR: /(?:\b(?:no|door|flat|plot|house|h|d|site|shop|unit|apt|apartment)\.?\s?(?:no\.?)?\s?[:#-]?\s?\d{1,5}[a-z]?\b|#\s?\d{1,5}\b)/gi,
};

/** JSON keys whose string value is a person or organisation name. */
const NAME_KEYS: ReadonlySet<string> = new Set(
  [
    "fullname", "personname", "partyname", "party", "payee", "payer", "employee", "employeename", "employer", "employername", "deductor",
    "deductorname", "deductee", "deducteename", "director", "directorname", "proprietor", "proprietorname", "partner", "partnername",
    "contact", "contactname", "contactperson", "customer", "customername", "supplier", "suppliername", "vendor", "vendorname", "buyer",
    "seller", "tenant", "landlord", "signatory", "beneficiary", "nominee", "holder", "accountholder", "relatedparty", "counterparty",
    "tradename", "legalname", "father", "fathername", "mother", "mothername", "spouse", "spousename", "guardian", "taxpayer", "assessee",
  ],
);

// ---------------------------------------------------------------- engine

const FILL = "\uE000";
const FILL_ADDR = "\uE001";

type Claim = { start: number; end: number; kind: PiiKind | null; addr?: boolean };

/** The view being masked: claimed spans are blanked with FILL (same length, so offsets never move). */
class Work {
  w: string;
  readonly claims: Claim[] = [];
  constructor(norm: string) {
    this.w = norm;
  }
  apply(found: Claim[]) {
    if (!found.length) return;
    found.sort((a, b) => a.start - b.start || b.end - a.end);
    const kept: Claim[] = [];
    let lastEnd = -1;
    for (const c of found) {
      if (c.end <= c.start || c.start < lastEnd) continue;
      kept.push(c);
      lastEnd = c.end;
    }
    const out: string[] = [];
    let pos = 0;
    for (const c of kept) {
      out.push(this.w.slice(pos, c.start), (c.kind === "ADDRESS" || c.addr ? FILL_ADDR : FILL).repeat(c.end - c.start));
      pos = c.end;
    }
    out.push(this.w.slice(pos));
    this.w = out.join("");
    this.claims.push(...kept);
  }
}

/** Context text with claimed spans blanked (an ADDRESS span still reads as "address"). */
const readable = (s: string) => s.replace(/\uE001+/g, " address ").replace(/\uE000+/g, " ");
const before = (w: string, index: number, width: number) => readable(w.slice(Math.max(0, index - width), index));
const after = (w: string, index: number, width: number) => readable(w.slice(index, index + width));

type Hit = PiiKind | { kind: PiiKind; start: number; end: number } | null;
type Decide = (m: RegExpExecArray, w: string) => Hit;

function regexPass(work: Work, re: RegExp, decide: Decide) {
  const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  const w = work.w;
  const found: Claim[] = [];
  for (let m = r.exec(w); m; m = r.exec(w)) {
    if (m[0].length === 0) {
      r.lastIndex++;
      continue;
    }
    const h = decide(m, w);
    if (!h) continue;
    if (typeof h === "string") found.push({ start: m.index, end: m.index + m[0].length, kind: h });
    else found.push({ start: h.start, end: h.end, kind: h.kind });
  }
  work.apply(found);
}

const always =
  (kind: PiiKind): Decide =>
  () =>
    kind;
const inContext =
  (kind: PiiKind, ctx: RegExp, width: number): Decide =>
  (m, w) =>
    ctx.test(before(w, m.index, width)) ? kind : null;

/** Names are matched and keyed case- and spacing-insensitively, so "RAJESH KUMAR" and "Rajesh Kumar" share a token. */
const NAME_KINDS: ReadonlySet<PiiKind> = new Set(["NAME", "ORG", "ADDRESS"]);
const valueKey = (kind: PiiKind, value: string) =>
  NAME_KINDS.has(kind) ? `${kind}\u0000${normalizeForMatching(value).toLowerCase().replace(/[\s,.]+/g, " ").trim()}` : `${kind}\u0000${value}`;

/** Raw text → token per map, so a value repeated thousands of times is normalised once. */
const rawTokens = new WeakMap<TokenMap, Map<string, string>>();

function tokenFor(map: TokenMap, kind: PiiKind, value: string): string {
  let raw = rawTokens.get(map);
  if (!raw) rawTokens.set(map, (raw = new Map()));
  const rawKey = `${kind}\u0000${value}`;
  const seen = raw.get(rawKey);
  if (seen && map.byToken.has(seen)) return seen;
  const token = tokenForKey(map, kind, value);
  if (raw.size < 50_000) raw.set(rawKey, token);
  return token;
}

function tokenForKey(map: TokenMap, kind: PiiKind, value: string): string {
  const key = valueKey(kind, value);
  const existing = map.byValue.get(key);
  if (existing) return existing;
  const n = (map.counters[kind] ?? 0) + 1;
  map.counters[kind] = n;
  const token = `⟨${kind}_${n}⟩`;
  map.byValue.set(key, token);
  map.byToken.set(token, value);
  return token;
}

// ---------------------------------------------------------------- '@': e-mail and UPI handles

const isLocalCode = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 46 || c === 95 || c === 37 || c === 43 || c === 45;
const isDomainCode = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 46 || c === 45;
const isLetterCode = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const EMAIL_DOMAIN = /^[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}$/;

/** Every "local@host" whose host starts with a letter: an e-mail when the host has a TLD, else a UPI handle. Linear: each '@' expands at most 64 / 255 characters. */
function atPass(work: Work) {
  const w = work.w;
  const found: Claim[] = [];
  let floor = 0;
  for (let at = w.indexOf("@"); at >= 0; at = w.indexOf("@", at + 1)) {
    let s = at;
    while (s > floor && at - s < 64 && isLocalCode(w.charCodeAt(s - 1))) s--;
    if (s === at) continue;
    let e = at + 1;
    while (e < w.length && e - at - 1 < 255 && isDomainCode(w.charCodeAt(e))) e++;
    while (e > at + 1 && (w[e - 1] === "." || w[e - 1] === "-")) e--;
    if (e === at + 1 || !isLetterCode(w.charCodeAt(at + 1))) continue;
    found.push({ start: s, end: e, kind: EMAIL_DOMAIN.test(w.slice(at + 1, e)) ? "EMAIL" : "UPI" });
    floor = e;
    at = e - 1;
  }
  work.apply(found);
}

// ---------------------------------------------------------------- dictionary (word trie)

type TrieNode = { next: Map<string, TrieNode>; kind?: PiiKind };
type CompiledDictionary = {
  /** Lower-case word sequences of every entry and variant. */
  root: TrieNode;
  /** Full names and multi-word variants, words joined by one space (the leak gate's list). */
  phrases: Map<string, PiiKind>;
  /** Full names and multi-word variants written without separators ("rajeshkumarsharma"), ≥ 6 letters. */
  glued: Map<string, PiiKind>;
  /** Organisation acronyms ("AWPL" for Acme Widgets Pvt Ltd), 4–8 capitals. */
  acronyms: Map<string, PiiKind>;
  /** Phonetic keys of the entries' words (transliterate.ts), for Devanagari / Kannada text. */
  indic: TrieNode;
  /** Multi-word phonetic key phrases (the leak gate's Indic list). */
  indicPhrases: Map<string, PiiKind>;
  maxWords: number;
};

const WORD_RE = /[\p{L}\p{M}\p{N}]+/gu;
/** A word as the dictionary matches it: lower case; `glue` = split from the previous word at a camelCase boundary. */
type DictWord = { s: number; e: number; lw: string; glue: boolean };
/** Lower→upper ("rajeshKumar", "RajeshKumar") is a word boundary inside one run of letters. */
const CAMEL_BOUNDARY = /(?<=[a-z])(?=[A-Z])/;

/** Words of `w` for dictionary matching: letter / digit runs, camelCase parts split off (glued to the previous part). */
function dictWords(w: string): DictWord[] {
  const out: DictWord[] = [];
  const re = new RegExp(WORD_RE.source, "gu");
  for (let m = re.exec(w); m; m = re.exec(w)) {
    const word = m[0];
    if (word.length <= 64 && CAMEL_BOUNDARY.test(word)) {
      let p = m.index;
      word.split(CAMEL_BOUNDARY).forEach((part, k) => {
        out.push({ s: p, e: p + part.length, lw: part.toLowerCase(), glue: k > 0 });
        p += part.length;
      });
    } else out.push({ s: m.index, e: m.index + word.length, lw: word.toLowerCase(), glue: false });
  }
  return out;
}
const wordsOf = (s: string) => dictWords(normalizeForMatching(s)).map((x) => x.lw);
/** Separators allowed between the words of one dictionary name in the text ("_" for file names). */
const NAME_SEPARATOR = /^[\s,.'’&\-/_]{1,12}$/;
/** Separators the leak gate accepts between the words of a full name. */
const GATE_SEPARATOR = /^(?:\s{1,3}|[_.-]{1,2})$/;
const COMMON_FIRST_WORDS: ReadonlySet<string> = new Set(["state", "national", "central", "union", "indian", "india", "new", "general", "united", "first", "global", "royal", "city", "the", "sri", "shree", "om", "sai"]);

/** May one word of a person's name be masked on its own (a first name, a middle name, the surname)? */
const soloWord = (w: string) => w.length >= 3 && /^\p{L}+$/u.test(w) && !NAME_STOPWORDS.has(w.toUpperCase()) && !isBusinessWord(w) && !COMMON_FIRST_WORDS.has(w) && !HONORIFICS.has(w.toUpperCase());

/**
 * The word sequences one entry masks: the name itself plus, for a person, "Last, First", initials
 * and each name word alone (first name, middle name, surname); for an organisation, its distinctive core.
 */
function variantsOf(e: DictionaryEntry): string[][] {
  const words: string[] = [...wordsOf(e.value)];
  if (!words.length) return [];
  const out: string[][] = [words];
  if (e.kind === "NAME") {
    let core: string[] = words;
    while (core.length > 1 && HONORIFICS.has((core[0] ?? "").toUpperCase())) core = core.slice(1);
    if (core !== words) out.push(core);
    if (core.length >= 2 && core.every((w) => /^\p{L}+$/u.test(w))) {
      const last = core[core.length - 1] ?? "";
      const rest = core.slice(0, -1);
      out.push([last, ...rest]); // "Kumar, Rajesh"
      if (rest.some((w) => w.length > 1)) out.push([...rest.map((w) => w.charAt(0)), last]); // "R. Kumar", "R K Sharma"
      if (last.length > 1) out.push([...rest, last.charAt(0)]); // "Rajesh K"
      for (const w of core) if (soloWord(w)) out.push([w]); // "Rajesh", "Sharma" (a name split across cells, the surname alone)
    }
  } else if (e.kind === "ORG") {
    // The distinctive core ("HDFC Bank Ltd" → "HDFC"): several words, or one all-capitals acronym.
    const raw = (normalizeForMatching(e.value).match(WORD_RE) ?? []).filter((w) => !ORG_GENERIC_WORDS.has(w.toUpperCase()));
    const core = raw.map((w) => w.toLowerCase());
    const acronym = raw.length === 1 && /^[A-Z]{3,}$/.test(raw[0]);
    if (core.length && core.length < words.length && (core.length >= 2 || acronym) && !COMMON_FIRST_WORDS.has(core[0])) out.push(core);
  }
  return out;
}

/** Acronyms of an organisation ("Acme Widgets Pvt Ltd" → AWPL; its core "Acme Widgets Logistics Pvt Ltd" → AWL too), 4–8 letters, never a business word. */
function acronymsOf(e: DictionaryEntry): string[] {
  if (e.kind !== "ORG") return [];
  const words = (normalizeForMatching(e.value).match(/\p{L}+/gu) ?? []).filter((w) => /^[A-Za-z]/.test(w));
  const core = words.filter((w) => !ORG_GENERIC_WORDS.has(w.toUpperCase()));
  const out = new Set<string>();
  for (const list of [words, core]) {
    if (list.length < 3) continue;
    const a = list.map((w) => w[0].toUpperCase()).join("");
    if (a.length >= 4 && a.length <= 8 && !isBusinessWord(a)) out.add(a);
  }
  return [...out];
}

const compiledCache = new WeakMap<readonly DictionaryEntry[], CompiledDictionary>();

function insert(root: TrieNode, words: readonly string[], kind: PiiKind) {
  let node = root;
  for (const w of words) {
    let next = node.next.get(w);
    if (!next) node.next.set(w, (next = { next: new Map() }));
    node = next;
  }
  node.kind ??= kind;
}

function compileDictionary(entries: readonly DictionaryEntry[]): CompiledDictionary {
  const cached = compiledCache.get(entries);
  if (cached) return cached;
  const root: TrieNode = { next: new Map() };
  const indic: TrieNode = { next: new Map() };
  const phrases = new Map<string, PiiKind>();
  const glued = new Map<string, PiiKind>();
  const acronyms = new Map<string, PiiKind>();
  const indicPhrases = new Map<string, PiiKind>();
  let maxWords = 1;
  const sorted = entries
    .map((e) => ({ ...e, value: e.value.trim() }))
    .filter((e) => e.value.length >= 2)
    .sort((a, b) => b.value.length - a.value.length);
  // Full names first, so a variant never overrides another entry's own name.
  const all = [...sorted.map((e) => ({ e, words: wordsOf(e.value), full: true })), ...sorted.flatMap((e) => variantsOf(e).slice(1).map((words) => ({ e, words, full: false })))];
  for (const { e, words, full } of all) {
    if (!words.length || (!full && words.join("").length < 3)) continue;
    insert(root, words, e.kind);
    if (full || words.length > 1) {
      const key = words.join(" ");
      if (!phrases.has(key)) phrases.set(key, e.kind);
      maxWords = Math.max(maxWords, words.length);
    }
    if (words.length > 1 && words.every((w) => /^\p{L}+$/u.test(w))) {
      const g = words.join("");
      if (g.length >= 6 && !glued.has(g)) glued.set(g, e.kind);
    }
    // Devanagari / Kannada: the same words as phonetic keys (a lone word needs a key of 4+ letters).
    const keys = words.map(phoneticKey);
    if (keys.every((k) => k.length > 0) && (keys.length > 1 ? keys.join("").length >= 5 : keys[0].length >= 4)) {
      insert(indic, keys, e.kind);
      if (keys.length > 1 || full) indicPhrases.set(keys.join(" "), e.kind);
    }
  }
  for (const e of sorted) for (const a of acronymsOf(e)) if (!acronyms.has(a)) acronyms.set(a, e.kind);
  const compiled = { root, phrases, glued, acronyms, indic, indicPhrases, maxWords };
  compiledCache.set(entries, compiled);
  return compiled;
}

/** Longest trie match starting at words[i]; `sep(j)` says whether words[j] and words[j+1] may belong to one name. */
function longestMatch(root: TrieNode, words: readonly { lw: string }[], i: number, sep: (j: number) => boolean): { end: number; kind: PiiKind } | null {
  let node = root.next.get(words[i].lw);
  let best: { end: number; kind: PiiKind } | null = null;
  let j = i;
  while (node) {
    if (node.kind) best = { end: j, kind: node.kind };
    if (j + 1 >= words.length || !sep(j)) break;
    j++;
    node = node.next.get(words[j].lw);
  }
  return best;
}

/** Devanagari / Kannada words of `w` as phonetic keys. */
function indicWords(w: string): { s: number; e: number; lw: string }[] {
  if (!INDIC_LETTER.test(w)) return [];
  const out: { s: number; e: number; lw: string }[] = [];
  const re = new RegExp(INDIC_WORD.source, "g");
  for (let m = re.exec(w); m; m = re.exec(w)) {
    const key = indicKey(m[0]);
    if (key) out.push({ s: m.index, e: m.index + m[0].length, lw: key });
  }
  return out;
}

function dictionaryPass(work: Work, dict: CompiledDictionary) {
  const w = work.w;
  const found: Claim[] = [];
  const words = dictWords(w);
  for (let i = 0; i < words.length; i++) {
    const m = longestMatch(dict.root, words, i, (j) => words[j + 1].glue || NAME_SEPARATOR.test(w.slice(words[j].e, words[j + 1].s)));
    if (m) {
      found.push({ start: words[i].s, end: words[m.end].e, kind: m.kind });
      i = m.end;
    }
  }
  // Glued names ("RAJESHKUMARSHARMA", "rajeshkumarsharma2526") and organisation acronyms ("AWPL").
  if (dict.glued.size || dict.acronyms.size) {
    const re = /[A-Za-z]{4,}/g; // glued keys are 6+ letters and acronyms 4+, both Latin script
    for (let m = re.exec(w); m; m = re.exec(w)) {
      const g = dict.glued.get(m[0].toLowerCase()) ?? (/^[A-Z]{4,8}$/.test(m[0]) ? dict.acronyms.get(m[0]) : undefined);
      if (g) found.push({ start: m.index, end: m.index + m[0].length, kind: g });
    }
  }
  // The same names written in Devanagari / Kannada (transliterate.ts).
  const indic = indicWords(w);
  for (let i = 0; i < indic.length; i++) {
    const m = longestMatch(dict.indic, indic, i, (j) => /^[\s,.]{1,3}$/.test(w.slice(indic[j].e, indic[j + 1].s)));
    if (m) {
      found.push({ start: indic[i].s, end: indic[m.end].e, kind: m.kind });
      i = m.end;
    }
  }
  work.apply(found);
}

// ---------------------------------------------------------------- context-aware deciders

function dobDecider(cutoffYear: number): Decide {
  return (m, w) => {
    if (CONTEXT.DOB.test(before(w, m.index, 40))) return "DOB";
    if (CONTEXT.DOB_AFTER.test(after(w, m.index + m[0].length, 24))) return "DOB";
    // A full date old enough to be a date of birth is masked without a label.
    const years = m[0].match(/(?:19|20)\d{2}/g);
    const y = years ? Number(years[years.length - 1]) : NaN;
    return y >= 1900 && y <= cutoffYear ? "DOB" : null;
  };
}

const aadhaarDecider: Decide = (m, w) => {
  if (verhoeffValid(m[0].replace(/[\s.-]/g, ""))) return "AADHAAR";
  if (m[1]) return "AADHAAR"; // grouped 4-4-4: looks like Aadhaar, mask defensively
  return CONTEXT.AADHAAR.test(before(w, m.index, 40)) ? "AADHAAR" : null;
};

const freeAccountDecider: Decide = (m, w) => {
  const b = before(w, m.index, 40);
  if (CONTEXT.NOT_ACCOUNT.test(b) || CONTEXT.CURRENCY_END.test(b)) return null;
  // An unquoted JSON number ("amountPaise": 12345678901) is an amount; account numbers are strings.
  if (/"\s{0,2}:\s{0,2}$/.test(b) && /^\s{0,2}(?:[,}\]]|$)/.test(w.slice(m.index + m[0].length, m.index + m[0].length + 3))) return null;
  return "BANK_AC";
};

const dinDecider: Decide = (m, w) => {
  const b = before(w, m.index, 30);
  return CONTEXT.DIN.test(b) && !CONTEXT.CURRENCY_END.test(b) ? "DIN" : null;
};

/** A PIN code in an address; with a door number earlier on the line, the whole address is one ADDRESS. */
const pinDecider: Decide = (m, w) => {
  if (!CONTEXT.ADDRESS.test(before(w, m.index, 80))) return null;
  // Only the 160 characters before the PIN, cut at the line start (searching a bounded slice keeps this linear).
  let segStart = Math.max(0, m.index - 160);
  let seg = w.slice(segStart, m.index);
  const cut = Math.max(seg.lastIndexOf("\n"), seg.lastIndexOf(FILL), seg.lastIndexOf(FILL_ADDR), seg.lastIndexOf("|"), seg.lastIndexOf("\t"), seg.lastIndexOf(";"));
  if (cut >= 0) {
    segStart += cut + 1;
    seg = seg.slice(cut + 1);
  }
  CONTEXT.DOOR.lastIndex = 0;
  const door = CONTEXT.DOOR.exec(seg);
  if (door) return { kind: "ADDRESS", start: segStart + door.index, end: m.index + m[0].length };
  return "PIN";
};

/** String values of name-like JSON keys. */
const nameKeyDecider: Decide = (m) => {
  const key = m[1].toLowerCase().replace(/[_-]/g, "");
  const value = m[2];
  if (!NAME_KEYS.has(key) || !/\p{L}/u.test(value) || value.trim().length < 2) return null;
  const start = m.index + m[0].length - 1 - value.length;
  return { kind: /\b(?:pvt|private|ltd|limited|llp|co|company|corp|corporation|inc|traders|enterprises|industries|bank|trust)\b/i.test(value) ? "ORG" : "NAME", start, end: start + value.length };
};

/** Narration payees and (re-audit NEW-1) every other name the free-text extractor still finds in what is left: labels, honorifics, UPI / NEFT payees, capitalised runs. */
function personNamePass(work: Work) {
  work.apply(personNameSpans(work.w).map((s) => ({ start: s.start, end: s.end, kind: s.kind })));
}

// ---------------------------------------------------------------- mask / unmask

/** Original-text slice of a view span. */
function original(text: string, view: View, start: number, end: number): [number, number] {
  return view.starts && view.ends ? [view.starts[start], view.ends[end - 1]] : [start, end];
}

/**
 * Replace PII in `text` with reversible tokens. Returns the masked text and the map needed to
 * reverse it. Order matters: token-looking text, e-mail / UPI handles and dictionary names first
 * (they contain digits and words other maskers would split), then dates of birth, then structured
 * identifiers from the longest / most specific to the least, then context-dependent digit runs,
 * addresses and narration names.
 */
export function mask(input: string, ctx: MaskContext = {}): MaskResult {
  const map = ctx.map ?? createTokenMap();
  const full = ctx.scope !== "structured";
  const literals: LiteralMode = ctx.literals ?? (full ? "keep" : "none");
  // Size caps first (audit #12): every masker below then works on bounded, linear input.
  const capped = capLongRuns(input);
  const text = capped.text;
  const truncated = capped.runs ? { runs: capped.runs, chars: capped.chars } : null;
  const view = normalizeView(text);
  const work = new Work(view.norm);

  if (literals !== "none") {
    // "keep": left as written, its number reserved; "all": escaped as ⟨LITERAL_n⟩ (see LiteralMode).
    const found: Claim[] = [];
    const r = new RegExp(M.LITERAL.source, "g");
    for (let m = r.exec(view.norm); m; m = r.exec(view.norm)) {
      if (literals === "keep") {
        const shape = /^⟨([A-Za-z]+(?:_[A-Za-z]+)*)_(\d+)⟩$/.exec(m[0]);
        if (shape) {
          const kind = shape[1].toUpperCase() as PiiKind;
          map.counters[kind] = Math.max(map.counters[kind] ?? 0, Number(shape[2]));
        }
      }
      found.push({ start: m.index, end: m.index + m[0].length, kind: literals === "keep" ? null : "LITERAL", addr: literals === "keep" && /^⟨ADDRESS_/i.test(m[0]) });
    }
    work.apply(found);
  }

  atPass(work);
  if (ctx.dictionary?.length) dictionaryPass(work, compileDictionary(ctx.dictionary));
  if (full) regexPass(work, M.NAME_KEY, nameKeyDecider);
  regexPass(work, M.EMAIL_SPOKEN, always("EMAIL"));

  const now = ctx.now ?? new Date();
  regexPass(work, M.DATE, dobDecider(now.getUTCFullYear() - 16));
  regexPass(work, M.GSTIN, always("GSTIN")); // incl. bad checksum / unknown state: defensive
  regexPass(work, M.CIN, always("CIN"));
  regexPass(work, M.LLPIN, inContext("LLPIN", CONTEXT.LLP, 40));
  regexPass(work, M.TAN, always("TAN"));
  regexPass(work, M.IFSC, always("IFSC"));
  regexPass(work, M.PAN_BOXED, always("PAN"));
  regexPass(work, M.PAN_SPACED, always("PAN"));
  regexPass(work, M.PAN, always("PAN"));
  regexPass(work, M.VOTER_ID, inContext("VOTER_ID", CONTEXT.VOTER, 40));
  regexPass(work, M.PASSPORT, inContext("PASSPORT", CONTEXT.PASSPORT, 40));
  regexPass(work, M.AADHAAR, aadhaarDecider);
  regexPass(work, M.BANK_AC, inContext("BANK_AC", CONTEXT.ACCOUNT, 50));
  regexPass(work, M.PHONE, always("PHONE"));
  regexPass(work, M.BANK_AC_FREE, freeAccountDecider);
  regexPass(work, M.DIN, dinDecider);
  regexPass(work, M.PIN, pinDecider);
  if (full) personNamePass(work);

  // Render: the original text with every claimed span replaced by its token.
  const claims = [...work.claims].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let pos = 0;
  for (const c of claims) {
    const [os, oe] = original(text, view, c.start, c.end);
    if (os < pos) continue;
    parts.push(text.slice(pos, os));
    const raw = text.slice(os, oe);
    parts.push(c.kind === null ? raw : tokenFor(map, c.kind, raw));
    pos = oe;
  }
  parts.push(text.slice(pos));
  return { masked: parts.join(""), map, truncated };
}

/**
 * Re-audit NEW-1: `dictionary` plus the names the free-text extractor finds in `texts`, so every
 * variant of a name typed in free text (the surname alone, "R K Sharma", the glued form) is masked
 * wherever it appears, not only where the extractor saw it. The router does this per request
 * (withMessageNames); single-text callers (stored notes, the legacy Gemini gate) call it directly.
 */
export function withTextNames(dictionary: readonly DictionaryEntry[] | undefined, ...texts: string[]): DictionaryEntry[] {
  const found = texts.flatMap((t) => personNames(t));
  return found.length ? dedupeDictionary([...(dictionary ?? []), ...found]) : [...(dictionary ?? [])];
}

/** Put the original values back. Unknown tokens (not in this map) are left as they are. */
export function unmask(text: string, map: TokenMap): string {
  return text.replace(tokenRe(), (t) => map.byToken.get(t) ?? t);
}

/** unmask() every string inside a JSON-like value, keys included (legacy helper; the router unmasks only grounded fields, see unmask-policy.ts). */
export function unmaskDeep<T>(value: T, map: TokenMap): T {
  if (typeof value === "string") return unmask(value, map) as T;
  if (Array.isArray(value)) return value.map((v) => unmaskDeep(v, map)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [unmask(k, map), unmaskDeep(v, map)])) as T;
  }
  return value;
}

/** Does the text contain a token of the PLACEHOLDER shape? */
export function hasToken(text: string): boolean {
  return new RegExp(PLACEHOLDER_SOURCE).test(text);
}

// ---------------------------------------------------------------- independent leak detector

// The leak gate's own patterns (deliberately not M or PATTERNS): broad shapes that mask() always
// replaces, so finding one in a masked payload means masking failed and the payload must not go.
const G = {
  AT: /[A-Za-z0-9._%+-]@(?=[A-Za-z])/g,
  EMAIL_AT: /[A-Za-z0-9-]{1,253}\.[A-Za-z]{2,24}/y,
  PAN: /(?<![A-Za-z])[A-Za-z]{5}\d{4}[A-Za-z]/,
  PAN_SPACED: new RegExp(`(?<![A-Za-z0-9])${NOT_PAN_WORD}[A-Z]{5}[\\s.-]{0,2}\\d{4}[\\s.-]{0,2}[A-Z](?![A-Za-z0-9])`),
  PAN_BOXED: /(?<![A-Za-z0-9])[A-Z](?:[ .-][A-Z]){4}[ .-]{1,3}\d(?:[ .-]?\d){3}[ .-]{1,3}[A-Z](?![A-Za-z0-9])/,
  GSTIN: /(?<![A-Za-z0-9])\d{2}[\s.-]?[A-Za-z]{5}[\s.-]?\d{4}[\s.-]?[A-Za-z][\s.-]?[0-9A-Za-z][Zz][0-9A-Za-z](?![A-Za-z0-9])/,
  CIN: /(?<![A-Za-z0-9])[LUlu]\d{5}[A-Za-z]{2}\d{4}[A-Za-z]{3}\d{6}(?![A-Za-z0-9])/,
  TAN: /(?<![A-Za-z0-9])[A-Za-z]{4}\d{5}[A-Za-z](?![A-Za-z0-9])/,
  IFSC: /(?<![A-Za-z0-9])[A-Za-z]{4}0[A-Za-z0-9]{6}(?![A-Za-z0-9])/,
  AADHAAR: /(?<![\d.])[2-9]\d{3}([\s.-]?)\d{4}\1\d{4}(?![\d]|\.\d)/g,
  PHONE: /(?<![\d+.])(?:(?:\+|00)\s?91[\s.-]?|0[\s-]?)?(?:[6-9](?:[\s-]?\d){9}|[6-9]\d{4}\.\d{5})(?![\d]|\.\d)/,
  DOB_LABEL: /\b(?:dob|d\.o\.b|date\s+of\s+birth|birth\s*date|born)\b/gi,
  DATE: new RegExp(DATE_SOURCE, "i"),
  PASSPORT_LABEL: /\bpass\s?port\b[^\n]{0,20}?(?<![A-Za-z0-9])[A-Za-z][\s-]?\d{7}(?![A-Za-z0-9])/i,
  VOTER_LABEL: /\b(?:voter|epic)\b[^\n]{0,20}?(?<![A-Za-z0-9])[A-Za-z]{3}[\s-]?\d{7}(?![A-Za-z0-9])/i,
  DIN_LABEL: /\bDIN\b[^\n\d]{0,12}(?<![\d.])\d{8}(?![\d]|\.\d)/,
};

export interface DetectOptions {
  /**
   * Client-master names: a full name still present is a leak — words separated by spaces, "_",
   * "-" or ".", in camelCase or glued, an organisation's acronym, or the name in Devanagari / Kannada.
   */
  dictionary?: DictionaryEntry[];
  /**
   * Re-audit NEW-1: also run the free-text name extractor (names.ts personNameSpans) — a probable
   * person or firm name still in the text is a leak. For client text masked in "full" scope (the
   * router's user / assistant messages, the legacy Gemini gate), never for fixed firm text.
   */
  names?: boolean;
}

/**
 * The leak gate: PII still present in `text` outside tokens. Independent of mask() — its own
 * broader patterns, run over the normalised text — so a masker regression or bypass is caught
 * here. Returns the kinds found (never the values). Used by the router before every cloud call.
 */
export function detectPii(text: string, opts: DetectOptions = {}): PiiKind[] {
  // A token becomes a blank that is neither a word nor a space, so it never joins its neighbours.
  const plain = normalizeForMatching(text.replace(tokenRe(), FILL));
  const found = new Set<PiiKind>();
  for (const m of plain.matchAll(G.AT)) {
    G.EMAIL_AT.lastIndex = (m.index ?? 0) + m[0].length;
    found.add(G.EMAIL_AT.test(plain) ? "EMAIL" : "UPI");
  }
  if (G.GSTIN.test(plain)) found.add("GSTIN");
  if (G.CIN.test(plain)) found.add("CIN");
  if (G.TAN.test(plain)) found.add("TAN");
  if (G.IFSC.test(plain)) found.add("IFSC");
  if (G.PAN.test(plain) || G.PAN_SPACED.test(plain) || G.PAN_BOXED.test(plain)) found.add("PAN");
  for (const m of plain.matchAll(G.AADHAAR)) if (m[1] || verhoeffValid(m[0].replace(/[\s.-]/g, ""))) found.add("AADHAAR");
  if (G.PHONE.test(plain)) found.add("PHONE");
  for (const m of plain.matchAll(G.DOB_LABEL)) {
    const end = (m.index ?? 0) + m[0].length;
    if (G.DATE.test(plain.slice(end, end + 20))) found.add("DOB");
  }
  if (G.PASSPORT_LABEL.test(plain)) found.add("PASSPORT");
  if (G.VOTER_LABEL.test(plain)) found.add("VOTER_ID");
  if (G.DIN_LABEL.test(plain)) found.add("DIN");
  if (opts.dictionary?.length) for (const k of dictionaryLeaks(plain, opts.dictionary)) found.add(k);
  if (opts.names) for (const s of personNameSpans(plain)) found.add(s.kind);
  return [...found];
}

/** n-gram lookup of `phrases` over `words` (the separator test decides which neighbours join). */
function phraseLeaks(words: readonly { s: number; e: number; lw: string; glue?: boolean }[], phrases: Map<string, PiiKind>, maxWords: number, sep: (gap: string) => boolean, plain: string, out: Set<PiiKind>) {
  for (let i = 0; i < words.length; i++) {
    let key = "";
    for (let n = 0; n < maxWords && i + n < words.length; n++) {
      if (n > 0 && !words[i + n].glue && !sep(plain.slice(words[i + n - 1].e, words[i + n].s))) break;
      key = n === 0 ? words[i].lw : `${key} ${words[i + n].lw}`;
      const kind = phrases.get(key);
      if (kind && (n > 0 || key.length >= 3)) out.add(kind);
    }
  }
}

/**
 * Dictionary names still present (n-gram lookup, not the masker's trie): full names and multi-word
 * variants with spaces, "_", "-" or "." between the words or in camelCase, glued names, acronyms,
 * and the same names in Devanagari / Kannada.
 */
function dictionaryLeaks(plain: string, dictionary: readonly DictionaryEntry[]): PiiKind[] {
  const d = compileDictionary(dictionary);
  const out = new Set<PiiKind>();
  if (d.phrases.size) phraseLeaks(dictWords(plain), d.phrases, d.maxWords, (g) => GATE_SEPARATOR.test(g), plain, out);
  if (d.glued.size || d.acronyms.size) {
    for (const m of plain.matchAll(/[A-Za-z]{4,}/g)) {
      const k = d.glued.get(m[0].toLowerCase()) ?? (/^[A-Z]{4,8}$/.test(m[0]) ? d.acronyms.get(m[0]) : undefined);
      if (k) out.add(k);
    }
  }
  if (d.indicPhrases.size) phraseLeaks(indicWords(plain), d.indicPhrases, d.maxWords, (g) => /^\s{1,3}$/.test(g), plain, out);
  return [...out];
}
