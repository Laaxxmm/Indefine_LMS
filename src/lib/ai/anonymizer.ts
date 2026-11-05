// DPDP anonymizer (orchestrator NON-NEGOTIABLE #3). Every cloud model call goes through
// ModelRouter → mask() before and unmask() after. Client PII is replaced by reversible tokens
// such as ⟨PAN_1⟩; the same value maps to the same token within one TokenMap, and the map lives
// only in memory for the duration of the run — it is never sent, logged or stored.
//
// Policy: when unsure, mask. A false positive costs a little model accuracy; a false negative
// is a DPDP breach. Pure module: no I/O.
import type { DictionaryEntry } from "./types";

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
  | "DOB"
  | "NAME"
  | "ORG"
  | "ADDRESS"
  | "PIN";

export interface TokenMap {
  /** ⟨KIND_n⟩ → original text, exactly as it appeared. */
  byToken: Map<string, string>;
  /** KIND + original → token, so repeats reuse the token. */
  byValue: Map<string, string>;
  counters: Partial<Record<PiiKind, number>>;
}

export interface MaskContext {
  /** Client-master names, companies and addresses (matched case-insensitively, longest first). */
  dictionary?: DictionaryEntry[];
  /** Continue an existing map (several messages of one request share one map). */
  map?: TokenMap;
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
  const d = v.replace(/[\s-]/g, "");
  return /^[2-9]\d{11}$/.test(d) && verhoeffValid(d);
}

// ---------------------------------------------------------------- patterns

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const NUM_END = "(?![\\d]|[.,]\\d)"; // not followed by more digits / decimal part
const NUM_START = "(?<![\\d.,])"; // not inside an amount like 1,23,456.00

export const PATTERNS = {
  EMAIL: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  DATE: new RegExp(
    [
      "\\b\\d{1,2}[\\/.\\-]\\d{1,2}[\\/.\\-]\\d{2,4}\\b",
      "\\b\\d{4}-\\d{2}-\\d{2}\\b",
      `\\b\\d{1,2}(?:st|nd|rd|th)?[\\s-]+${MONTH}\\.?,?[\\s-]+\\d{4}\\b`,
      `\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`,
    ].join("|"),
    "gi",
  ),
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

const CONTEXT = {
  DOB: /\b(?:dob|d\.o\.b|date\s+of\s+birth|birth\s*date|born(?:\s+on)?|birthday)\b/i,
  LLP: /\bLLP(?:IN)?\b/i,
  AADHAAR: /\b(?:aadh?aa?r|uid|uidai|uin)\b/i,
  ACCOUNT: /(?:\ba\/c\b|\bacct\b|\baccount\b|\bac\s*no\b|\bbank\b)/i,
  DIN: /\bDIN\b|director\s+identification/i,
  ADDRESS:
    /\b(?:address|addr|pin\s*code|pincode|pin|postal|road|rd|street|st|lane|nagar|layout|cross|main|floor|block|sector|colony|district|taluk|village|post|bengaluru|bangalore|mysuru|mysore|mumbai|delhi|chennai|hyderabad|kolkata|pune|ahmedabad|karnataka|maharashtra|tamil\s+nadu|kerala|telangana|gujarat)\b/i,
};

// ---------------------------------------------------------------- engine

function tokenFor(map: TokenMap, kind: PiiKind, value: string): string {
  const key = `${kind}\u0000${value}`;
  const existing = map.byValue.get(key);
  if (existing) return existing;
  const n = (map.counters[kind] ?? 0) + 1;
  map.counters[kind] = n;
  const token = `⟨${kind}_${n}⟩`;
  map.byValue.set(key, token);
  map.byToken.set(token, value);
  return token;
}

/** Text in the window before `index`, with tokens blanked (an ADDRESS token still reads as address). */
function contextBefore(text: string, index: number, width: number): string {
  return text
    .slice(Math.max(0, index - width), index)
    .replace(tokenRe(), (t) => (t.startsWith("⟨ADDRESS_") ? " address " : " "));
}

type Decide = (match: RegExpExecArray, index: number, text: string) => PiiKind | null;

/** Apply `re` to every stretch of text that is not already a token. */
function maskWith(text: string, re: RegExp, decide: Decide, map: TokenMap): string {
  const out: string[] = [];
  const tre = tokenRe();
  let last = 0;
  const segments: [number, number][] = [];
  for (let t = tre.exec(text); t; t = tre.exec(text)) {
    segments.push([last, t.index]);
    last = t.index + t[0].length;
  }
  segments.push([last, text.length]);
  let cursor = 0;
  for (const [start, end] of segments) {
    out.push(text.slice(cursor, start)); // the token between segments, unchanged
    const seg = text.slice(start, end);
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let segOut = "";
    let segLast = 0;
    for (let m = r.exec(seg); m; m = r.exec(seg)) {
      if (m[0].length === 0) {
        r.lastIndex++;
        continue;
      }
      const kind = decide(m, start + m.index, text);
      if (!kind) continue;
      segOut += seg.slice(segLast, m.index) + tokenFor(map, kind, m[0]);
      segLast = m.index + m[0].length;
    }
    out.push(segOut + seg.slice(segLast));
    cursor = end;
  }
  return out.join("");
}

const always =
  (kind: PiiKind): Decide =>
  () =>
    kind;
const inContext =
  (kind: PiiKind, ctx: RegExp, width: number): Decide =>
  (_m, index, text) =>
    ctx.test(contextBefore(text, index, width)) ? kind : null;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dictionaryPattern(value: string): RegExp {
  const words = value.trim().split(/\s+/).map(escapeRe);
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join("\\s+")}(?![\\p{L}\\p{N}])`, "giu");
}

/**
 * Replace PII in `text` with reversible tokens. Returns the masked text and the map needed to
 * reverse it. Order matters: e-mails and dictionary entries first (they contain digits and
 * words other maskers would split), then dates of birth, then structured identifiers from the
 * longest/most specific to the least, then context-dependent digit runs.
 */
export function mask(text: string, ctx: MaskContext = {}): { masked: string; map: TokenMap } {
  const map = ctx.map ?? createTokenMap();
  let s = text;

  s = maskWith(s, PATTERNS.EMAIL, always("EMAIL"), map);

  const entries = (ctx.dictionary ?? [])
    .map((e) => ({ ...e, value: e.value.trim() }))
    .filter((e) => e.value.length >= 2)
    .sort((a, b) => b.value.length - a.value.length);
  for (const e of entries) s = maskWith(s, dictionaryPattern(e.value), always(e.kind), map);

  s = maskWith(s, PATTERNS.DATE, inContext("DOB", CONTEXT.DOB, 40), map);
  s = maskWith(s, PATTERNS.GSTIN, always("GSTIN"), map); // incl. bad checksum / unknown state: defensive
  s = maskWith(s, PATTERNS.CIN, always("CIN"), map);
  s = maskWith(s, PATTERNS.LLPIN, inContext("LLPIN", CONTEXT.LLP, 40), map);
  s = maskWith(s, PATTERNS.TAN, always("TAN"), map);
  s = maskWith(s, PATTERNS.IFSC, always("IFSC"), map);
  s = maskWith(s, PATTERNS.PAN, always("PAN"), map);
  s = maskWith(
    s,
    PATTERNS.AADHAAR,
    (m, index, full) => {
      if (verhoeffValid(m[0].replace(/[\s-]/g, ""))) return "AADHAAR";
      if (m[1]) return "AADHAAR"; // grouped 4-4-4: looks like Aadhaar, mask defensively
      return CONTEXT.AADHAAR.test(contextBefore(full, index, 40)) ? "AADHAAR" : null;
    },
    map,
  );
  s = maskWith(s, PATTERNS.BANK_AC, inContext("BANK_AC", CONTEXT.ACCOUNT, 50), map);
  s = maskWith(s, PATTERNS.PHONE, always("PHONE"), map);
  s = maskWith(s, PATTERNS.DIN, inContext("DIN", CONTEXT.DIN, 30), map);
  s = maskWith(s, PATTERNS.PIN, inContext("PIN", CONTEXT.ADDRESS, 80), map);

  return { masked: s, map };
}

/** Put the original values back. Unknown tokens (not in this map) are left as they are. */
export function unmask(text: string, map: TokenMap): string {
  return text.replace(tokenRe(), (t) => map.byToken.get(t) ?? t);
}

/** unmask() every string inside a JSON-like value (model output objects). */
export function unmaskDeep<T>(value: T, map: TokenMap): T {
  if (typeof value === "string") return unmask(value, map) as T;
  if (Array.isArray(value)) return value.map((v) => unmaskDeep(v, map)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [unmask(k, map), unmaskDeep(v, map)])) as T;
  }
  return value;
}

/**
 * Detect structured PII still present in `text` (outside tokens). Used by the leak tests and
 * available to callers as a final check before anything leaves the building.
 */
export function detectPii(text: string): PiiKind[] {
  const plain = text.replace(tokenRe(), " ");
  const found = new Set<PiiKind>();
  const has = (re: RegExp, test?: (m: RegExpExecArray) => boolean) => {
    const r = new RegExp(re.source, re.flags);
    for (let m = r.exec(plain); m; m = r.exec(plain)) if (!test || test(m)) return true;
    return false;
  };
  if (has(PATTERNS.EMAIL)) found.add("EMAIL");
  if (has(PATTERNS.GSTIN)) found.add("GSTIN");
  if (has(PATTERNS.CIN)) found.add("CIN");
  if (has(PATTERNS.TAN)) found.add("TAN");
  if (has(PATTERNS.IFSC)) found.add("IFSC");
  if (has(PATTERNS.PAN)) found.add("PAN");
  if (has(PATTERNS.AADHAAR, (m) => Boolean(m[1]) || verhoeffValid(m[0].replace(/[\s-]/g, "")))) found.add("AADHAAR");
  if (has(PATTERNS.PHONE)) found.add("PHONE");
  return [...found];
}
