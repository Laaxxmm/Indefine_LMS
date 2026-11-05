// Deterministic name helpers for the anonymizer dictionary (DPDP, ADR-006 class A: names of
// individuals; a proprietor's trade name identifies the proprietor, so party names are masked too).
//
//   partyEntry(value)           one value from a parsed party / supplier / customer / employer /
//                               payer / holder column → a dictionary entry, or null for non-names
//                               ("Cash", "-", "Rent", a number)
//   narrationNameSpans(text)    payee / payer names inside bank narrations after a payment-rail
//                               keyword ("NEFT-RAJESH KUMAR SHARMA-SAL OCT" → RAJESH KUMAR SHARMA)
//   narrationNames(text)        the same as dictionary entries (agents' dictionaryTerms hooks)
//   dedupeDictionary(entries)   one entry per value (case-insensitive), longest first
//
// Used by the runner's per-run dictionary (agents' dictionaryTerms hooks) and by the anonymizer's
// narration masker (a backstop for names no dictionary knows). Pure: no I/O.
import type { DictionaryEntry, DictionaryKind } from "./types";

/** Words that make a name an organisation (upper case, punctuation stripped). */
export const ORG_SUFFIX_WORDS: ReadonlySet<string> = new Set([
  "PVT", "PRIVATE", "LTD", "LIMITED", "LLP", "CO", "COMPANY", "CORP", "CORPORATION", "INC", "PLC", "OPC",
  "TRADERS", "TRADING", "ENTERPRISES", "ENTERPRISE", "INDUSTRIES", "INDUSTRY", "AGENCIES", "AGENCY", "ASSOCIATES",
  "SERVICES", "SOLUTIONS", "SYSTEMS", "TECHNOLOGIES", "TECHNOLOGY", "INFOTECH", "EXPORTS", "IMPORTS", "STORES",
  "MART", "CENTRE", "CENTER", "HOSPITAL", "CLINIC", "PHARMA", "PHARMACY", "FOODS", "MOTORS", "ELECTRICALS",
  "ELECTRONICS", "TEXTILES", "CONSTRUCTIONS", "CONSTRUCTION", "BUILDERS", "DEVELOPERS", "TRUST", "SOCIETY",
  "FOUNDATION", "SONS", "BROS", "BROTHERS", "GROUP", "HUF", "BANK", "FINANCE", "FINANCIAL", "INSURANCE",
  "LOGISTICS", "SUPPLIES", "SUPPLY", "TRANSPORT", "VENTURES", "HOLDINGS", "CONSULTANTS", "CONSULTANCY",
]);

/** Generic organisation words left out of an organisation's distinctive core ("HDFC Bank Ltd" → "HDFC"). */
export const ORG_GENERIC_WORDS: ReadonlySet<string> = new Set([
  "PVT", "PRIVATE", "LTD", "LIMITED", "LLP", "CO", "COMPANY", "CORP", "CORPORATION", "INC", "PLC", "OPC", "THE", "AND",
  "OF", "INDIA", "M", "S", "MS", "MESSRS", "BANK", "HUF",
]);

/** Honorifics stripped before a person's name is varied. */
export const HONORIFICS: ReadonlySet<string> = new Set(["MR", "MRS", "MS", "MISS", "DR", "SHRI", "SRI", "SMT", "KUM", "KUMARI", "KM", "M", "S", "MESSRS", "CA", "ADV"]);

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "SEPT", "OCT", "NOV", "DEC", "JANUARY", "FEBRUARY", "MARCH", "APRIL", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/**
 * Words that are never (part of) a person's name in a register or narration: payment rails,
 * banking and accounting terms, expense heads, months. Upper case.
 */
export const NAME_STOPWORDS: ReadonlySet<string> = new Set([
  ...MONTHS,
  "NEFT", "RTGS", "IMPS", "UPI", "NACH", "ECS", "ACH", "MMT", "INFT", "INF", "TRF", "TFR", "CHQ", "CHEQUE", "CLG", "CMS", "BIL", "BILLPAY", "POS", "INB", "MOB", "ATM",
  "P2A", "P2M", "P2P", "CR", "DR", "TO", "BY", "FROM", "FOR", "THE", "AND", "OF", "IN", "AT", "ON", "A", "AN", "VIA", "AGAINST", "TOWARDS",
  "HDFC", "ICICI", "SBI", "AXIS", "KOTAK", "YES", "PNB", "BOB", "CANARA", "UNION", "IDFC", "INDUSIND", "FEDERAL", "RBL", "IOB", "UCO", "BOI", "CBI",
  "IFSC", "REF", "REFNO", "NO", "TXN", "UTR", "RRN", "ID", "PAYMENT", "PAYMENTS", "PAY", "PAID", "RECEIVED", "RECEIPT", "TRANSFER", "FUND", "FUNDS",
  "CREDIT", "DEBIT", "CASH", "DEPOSIT", "WITHDRAWAL", "CHARGES", "CHGS", "CHG", "FEE", "FEES", "GST", "IGST", "CGST", "SGST", "TDS", "TCS", "TAX", "TAXES",
  "INTEREST", "INT", "SALARY", "SALARIES", "SAL", "WAGES", "BONUS", "RENT", "EMI", "LOAN", "BILL", "BILLS", "INVOICE", "INV", "ADVANCE", "REFUND",
  "REVERSAL", "RETURN", "RETURNS", "FILED", "TURNOVER", "RECEIPTS", "DIVIDEND", "DIVIDENDS", "SAVINGS", "DEPOSITS", "SELF", "OWN", "ACCOUNT", "AC", "SB", "CA", "OD", "CC", "ELECTRICITY", "BESCOM", "WATER", "PHONE", "MOBILE", "INTERNET",
  "BROADBAND", "RECHARGE", "PREMIUM", "OFFICE", "EXPENSE", "EXPENSES", "EXP", "PURCHASE", "PURCHASES", "SALES", "SALE", "MATERIAL", "MATERIALS",
  "FUEL", "PETROL", "DIESEL", "TRAVEL", "FOOD", "MAINTENANCE", "REPAIR", "REPAIRS", "MISC", "OTHERS", "OTHER", "SUNDRY", "VENDOR", "SUPPLIER",
  "CUSTOMER", "PARTY", "AMOUNT", "BAL", "BALANCE", "OPENING", "CLOSING", "BROUGHT", "FORWARD", "TOTAL", "NET", "GROSS", "CAPITAL", "DRAWINGS",
  "SUSPENSE", "DEBTORS", "CREDITORS", "PAYABLE", "RECEIVABLE", "PROVISION", "DEPRECIATION", "STOCK", "INVENTORY", "JOURNAL", "CONTRA", "VOUCHER",
  "NA", "NIL", "NONE", "UNKNOWN", "MISCELLANEOUS", "GENERAL", "MONTHLY", "QUARTERLY", "ANNUAL", "PAYTM", "GPAY", "PHONEPE", "BHIM", "AMAZON",
]);

const PUNCT = /[.,'’&()/-]+/g;
const upperWord = (w: string) => w.replace(PUNCT, "").toUpperCase();

/** Client-master and staff names for one job's masking dictionary (production: name-directory.ts). */
export type NameDirectory = {
  forJob(job: { jobTaskId: string; clientCode: string; clientName: string }): Promise<DictionaryEntry[]>;
};

/** Does any word of the name mark an organisation ("Pvt", "Ltd", "LLP", "Traders", "Bank" …)? */
export function isOrgName(value: string): boolean {
  return value.split(/[\s,]+/).some((w) => ORG_SUFFIX_WORDS.has(upperWord(w)));
}

/**
 * A party value from a parsed column → a dictionary entry, or null when it is not a name: too
 * short, no letters, a stopword ("Cash", "Rent", "Sundry"), or only stopwords and numbers.
 */
export function partyEntry(value: string | null | undefined, kind?: DictionaryKind): DictionaryEntry | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (v.length < 3 || v.length > 160 || !/\p{L}/u.test(v)) return null;
  const words = v.split(/[\s,]+/).map(upperWord).filter(Boolean);
  if (!words.length) return null;
  if (words.length === 1 && (words[0].length < 4 || NAME_STOPWORDS.has(words[0]))) return null;
  if (words.every((w) => NAME_STOPWORDS.has(w) || /\d/.test(w) || w.length < 2)) return null;
  return { value: v, kind: kind ?? (isOrgName(v) ? "ORG" : "NAME") };
}

/** Each value through partyEntry; nulls dropped. */
export function partyEntries(values: Iterable<string | null | undefined>, kind?: DictionaryKind): DictionaryEntry[] {
  const out: DictionaryEntry[] = [];
  for (const v of values) {
    const e = partyEntry(v, kind);
    if (e) out.push(e);
  }
  return out;
}

// ------------------------------------------------------------------ narrations

/** Payment-rail keywords after which a bank narration names the payee / payer. */
const RAILS = "NEFT|RTGS|IMPS|UPI|NACH|ECS|ACH|MMT|INFT|TRF|TFR|CHQ|CHEQUE|CLG|CMS|BIL|BILLPAY|INB|MOB";
const RAIL_RE = new RegExp(`(?<![A-Za-z0-9])(?:${RAILS})(?![A-Za-z0-9])`, "gi");
const RAIL_WORD = new RegExp(`^(?:${RAILS})$`, "i");
/** Segment breaks inside a narration; the anonymizer's claimed spans (U+E000 / U+E001) count as breaks too. */
const BREAK_CODES = new Set([0x2d, 0x2f, 0x3a, 0x7c, 0x2a, 0x23, 0x5f, 0x2c, 0x3b, 0x0a, 0x09, 0x28, 0x29, 0x5b, 0x5d, 0xe000, 0xe001]);
const NAME_WORD = /^[A-Z][A-Za-z.'’&]*$/;
/** How far after the rail keyword a name may start. */
const NARRATION_REACH = 160;

export type NameSpan = { start: number; end: number; kind: DictionaryKind };

/**
 * Names in bank narrations: after a payment-rail keyword, skip reference segments (digits, short
 * codes, stopwords), then take up to six capitalised words that are not stopwords. Two or more
 * words (or a word plus an organisation suffix) make a name. Offsets index `text`.
 */
export function narrationNameSpans(text: string): NameSpan[] {
  const out: NameSpan[] = [];
  let after = 0;
  RAIL_RE.lastIndex = 0;
  for (let m = RAIL_RE.exec(text); m; m = RAIL_RE.exec(text)) {
    if (m.index < after) continue;
    const span = nameAfter(text, m.index + m[0].length);
    if (span) {
      out.push(span);
      after = span.end;
      RAIL_RE.lastIndex = Math.max(RAIL_RE.lastIndex, span.end);
    }
  }
  return out;
}

function nameAfter(text: string, from: number): NameSpan | null {
  const limit = Math.min(text.length, from + NARRATION_REACH);
  let i = from;
  let segments = 0;
  while (i < limit && segments < 6) {
    // one segment: up to the next break
    let j = i;
    while (j < limit && !BREAK_CODES.has(text.charCodeAt(j))) j++;
    const found = nameInSegment(text, i, j);
    if (found === "stop") return null; // the next narration starts here: it gets its own scan (keeps this linear)
    if (found) return found;
    segments++;
    i = j + 1;
  }
  return null;
}

function nameInSegment(text: string, start: number, end: number): NameSpan | "stop" | null {
  const words: { s: number; e: number; w: string }[] = [];
  for (let i = start; i < end; ) {
    while (i < end && text.charCodeAt(i) <= 32) i++;
    const s = i;
    while (i < end && text.charCodeAt(i) > 32) i++;
    if (i > s) words.push({ s, e: i, w: text.slice(s, i) });
  }
  let k = 0;
  // leading junk: references, digits, short codes, stopwords
  while (k < words.length && (/\d/.test(words[k].w) || upperWord(words[k].w).length < 2 || NAME_STOPWORDS.has(upperWord(words[k].w)) || !NAME_WORD.test(words[k].w))) {
    if (RAIL_WORD.test(words[k].w)) return "stop";
    k++;
  }
  const name: typeof words = [];
  let org = false;
  for (; k < words.length && name.length < 6; k++) {
    const w = words[k].w;
    const u = upperWord(w);
    if (!NAME_WORD.test(w) || !u) break;
    if (ORG_SUFFIX_WORDS.has(u)) {
      if (!name.length) break;
      org = true;
      name.push(words[k]);
      continue;
    }
    if (NAME_STOPWORDS.has(u)) break;
    if (org) break; // nothing after the suffix
    name.push(words[k]);
  }
  const core = name.filter((w) => !ORG_SUFFIX_WORDS.has(upperWord(w.w))).length;
  if (core >= 2 || (core >= 1 && org)) return { start: name[0].s, end: name[name.length - 1].e, kind: org ? "ORG" : "NAME" };
  return null;
}

/** Narration names as dictionary entries. */
export function narrationNames(text: string | null | undefined): DictionaryEntry[] {
  if (!text) return [];
  return narrationNameSpans(text).flatMap((s) => {
    const e = partyEntry(text.slice(s.start, s.end), s.kind);
    return e ? [e] : [];
  });
}

/** One entry per value (case- and whitespace-insensitive; the first kind wins), longest first. */
export function dedupeDictionary(entries: Iterable<DictionaryEntry | null | undefined>): DictionaryEntry[] {
  const seen = new Map<string, DictionaryEntry>();
  for (const e of entries) {
    if (!e) continue;
    const value = e.value.replace(/\s+/g, " ").trim();
    if (value.length < 2) continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, { value, kind: e.kind });
  }
  return [...seen.values()].sort((a, b) => b.value.length - a.value.length || (a.value < b.value ? -1 : 1));
}
