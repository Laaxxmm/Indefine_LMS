// Facts of a comms draft and the fact-like tokens of any text (Phase 10). A template's facts are
// filled by code (client name, period, dates DD MMM YYYY, amounts in ₹ with Indian grouping, ack
// refs, document lists); the model may only rephrase around them. These helpers find every
// date / amount / reference / number in a text so the validators (grounding.ts) can require that
// each one equals a template fact, and that nothing date-, money- or number-like is left over
// once the facts are taken out. Pure.

/** A value the message must carry exactly as code wrote it. */
export type FactKind =
  /** Client or contact name (masked by the router before any cloud call). */
  | "name"
  /** Return / job title such as GSTR-3B. */
  | "label"
  /** "October 2026", "Q2 of FY 2026-27", "FY 2026-27". */
  | "period"
  /** DD MMM YYYY. */
  | "date"
  /** ₹1,23,456.00. */
  | "amount"
  /** Acknowledgement reference (ARN / SRN / ack no.) as the human recorded it. */
  | "ref"
  /** Staff-written topic of a question (translated, not copied, in another language). */
  | "topic"
  /** A document line of a doc-chase list (fixed in English; translated, not copied). */
  | "item"
  /** A date / amount / number / reference found inside staff-written text or a document line. */
  | "token";

export type Fact = { kind: FactKind; value: string };

const MONTHS_FULL = "January|February|March|April|May|June|July|August|September|October|November|December";
const MONTHS_ABBR = "Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";
const MONTH = `(?:${MONTHS_FULL}|${MONTHS_ABBR}|May)`;

/** Date-like spans: 20 Nov 2026, Nov 20, 2026, October 2026, 20/11/2026, 2026-11-20. */
const DATE_SOURCES = [
  `(?<![\\w])\\d{1,2}(?:st|nd|rd|th)?[\\s-]+${MONTH}\\.?,?[\\s-]+\\d{4}(?![\\w])`,
  `(?<![\\w])${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}(?![\\w])`,
  `(?<![\\w])${MONTH}\\.?,?\\s+\\d{4}(?![\\w])`,
  `(?<![\\w])\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}(?![\\w])`,
  `(?<![\\w])\\d{4}-\\d{2}-\\d{2}(?![\\w])`,
];
/** Amount-like spans: ₹1,23,456.00, Rs. 500, INR 10,000, 2.5 lakh. */
const AMOUNT_SOURCES = [`(?:₹|(?<![A-Za-z])Rs\\.?|(?<![A-Za-z])INR)\\s?\\d[\\d,]*(?:\\.\\d+)?`, `(?<![\\w.,])\\d[\\d,]*(?:\\.\\d+)?\\s?(?:lakhs?|crores?|rupees)(?![A-Za-z])`];
/** Reference-like tokens: letters and digits mixed (AA2910260123456, GSTR-3B, INV-104, 26AS). */
const REF_SOURCE = "(?<![A-Za-z0-9])(?=[A-Za-z0-9/-]*\\d)(?=[A-Za-z0-9/-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9/-]{1,}[A-Za-z0-9](?![A-Za-z0-9])";
/** Any other number (a percentage keeps its sign: "18%"). */
const PERCENT_SOURCE = "\\d+(?:\\.\\d+)?\\s?%";
const NUMBER_SOURCE = "\\d[\\d,]*(?:\\.\\d+)?";

const re = (source: string, flags = "g") => new RegExp(source, flags);

export type TokenKind = "date" | "amount" | "ref" | "number";
export type Token = { kind: TokenKind; value: string; start: number; end: number };

/**
 * Every date / amount / reference / number in `text`, longest-first by kind priority, without
 * overlaps. Month names alone ("by November") are not tokens; residualProblems() catches them.
 */
export function factTokens(text: string): Token[] {
  const taken: [number, number][] = [];
  const out: Token[] = [];
  const free = (s: number, e: number) => taken.every(([a, b]) => e <= a || s >= b);
  const scan = (kind: TokenKind, sources: string[]) => {
    for (const src of sources) {
      for (const m of text.matchAll(re(src, kind === "date" ? "g" : "gi"))) {
        const start = m.index ?? 0;
        const end = start + m[0].length;
        if (m[0].length === 0 || !free(start, end)) continue;
        taken.push([start, end]);
        out.push({ kind, value: m[0], start, end });
      }
    }
  };
  scan("date", DATE_SOURCES);
  scan("amount", AMOUNT_SOURCES);
  scan("ref", [REF_SOURCE]);
  scan("number", [PERCENT_SOURCE, NUMBER_SOURCE]);
  return out.sort((a, b) => a.start - b.start);
}

/** The fact-like tokens of staff-written text or a document line, as facts that must survive verbatim. */
export function tokenFacts(text: string): Fact[] {
  return factTokens(text).map((t) => ({ kind: "token" as const, value: t.value }));
}

/** Unique facts, longest value first (so removal never splits a longer fact). */
export function normalizeFacts(facts: readonly Fact[]): Fact[] {
  const seen = new Set<string>();
  const out: Fact[] = [];
  for (const f of facts) {
    const value = f.value.trim();
    const key = `${f.kind}\u0000${value}`;
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: f.kind, value });
  }
  return out.sort((a, b) => b.value.length - a.value.length);
}

/** `text` with every fact value cut out (longest first), so only the model's own words remain. */
export function stripFacts(text: string, facts: readonly Fact[]): string {
  let s = text;
  for (const f of normalizeFacts(facts)) s = s.split(f.value).join(" ");
  return s;
}

const MONTH_WORD = re(`(?<![A-Za-z])(?:${MONTHS_FULL.replace("May|", "")}|${MONTHS_ABBR})(?![A-Za-z])`);
const WEEKDAY = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i;
const RELATIVE_TIME = /\b(?:today|tomorrow|yesterday|tonight|next\s+(?:week|month|year|quarter)|this\s+(?:week|month|year|quarter)|end\s+of\s+(?:the\s+)?(?:day|week|month|year|quarter)|within\s+\w+\s+(?:days?|weeks?|hours?))\b/i;
const CURRENCY = /₹|(?<![A-Za-z])(?:Rs|INR)(?![A-Za-z])|\brupees?\b|\blakhs?\b|\bcrores?\b|\bpaise\b/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
const URL_RE = /\bhttps?:\/\/|\bwww\./i;
const PERCENT = /%|\bper\s*cent\b|\bpercent\b/i;

/**
 * What is left in `text` after the facts are taken out that would be a new fact: digits, month
 * or weekday names, relative dates, currency words, percentages, e-mail addresses or links.
 * Empty = the text adds no date, amount, number or contact detail of its own.
 */
export function residualProblems(text: string, facts: readonly Fact[]): string[] {
  const rest = stripFacts(text, facts);
  const p: string[] = [];
  if (/\d/.test(rest)) p.push("a number, date or reference that is not one of the facts");
  if (MONTH_WORD.test(rest) || WEEKDAY.test(rest)) p.push("a month or weekday that is not part of a fact date");
  if (RELATIVE_TIME.test(rest)) p.push("a relative date (today, tomorrow, next week, ...) the template does not give");
  if (CURRENCY.test(rest)) p.push("a currency amount that is not one of the facts");
  if (PERCENT.test(rest)) p.push("a percentage that is not one of the facts");
  if (EMAIL.test(rest) || URL_RE.test(rest)) p.push("an e-mail address or link that is not one of the facts");
  return p;
}

/** Facts whose value occurs in `text` (the ones a rewrite of that text must keep). */
export const factsIn = (text: string, facts: readonly Fact[]): Fact[] => normalizeFacts(facts).filter((f) => text.includes(f.value));
