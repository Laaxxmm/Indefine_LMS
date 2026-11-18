// Tone lint for client messages (Phase 10 tone rules): plain words (no jargon — the banned list
// in banned-words.ts is data), specific dates and amounts (no "soon", "approximately"), one ask
// per message, at most 180 words in English, no emoji, no exclamation marks. Pure: a draft that
// fails is shown to staff with the issues; a model rewrite that adds an issue is rejected.
import { BANNED_WORDS, type BannedWord } from "./banned-words";
import { LIMITS } from "./types";

export type ToneCode = "banned-word" | "too-long" | "more-than-one-ask" | "no-ask" | "emoji" | "exclamation";
export type ToneIssue = { code: ToneCode; message: string; phrase?: string };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const phraseRe = (phrase: string) => new RegExp(`(?<![\\p{L}\\p{N}])${phrase.trim().split(/\s+/).map(escapeRe).join("\\s+")}(?![\\p{L}\\p{N}])`, "iu");
const BANNED: readonly (BannedWord & { re: RegExp })[] = BANNED_WORDS.map((w) => ({ ...w, re: phraseRe(w.phrase) }));

/** Words: whitespace-separated runs that contain a letter or a digit (₹ and dashes alone are not words). */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Sentences and lines (list items count as their own line). */
export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.?!])\s+(?=[\p{Lu}\p{N}"'(])/u))
    .map((s) => s.trim())
    .filter(Boolean);
}

const ASK = /\b(?:please|kindly|could you|can you|would you|will you|request you|we need you to|let us know|do share|share with us|we would like you to)\b/i;

/** Sentences that ask the client to do something (a request word, or a question). */
export function asks(text: string): string[] {
  return sentences(text).filter((s) => ASK.test(s) || s.endsWith("?"));
}
export const countAsks = (text: string): number => asks(text).length;

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u{FE0F}/u;

export type ToneOptions = {
  /** English rules (banned words, word cap). Off for a translation: only emoji / exclamation / ask count apply. */
  english?: boolean;
  /** The message must carry exactly one ask (doc-chase, due-date reminder). Otherwise at most one. */
  requireAsk?: boolean;
  maxWords?: number;
};

export function lintTone(text: string, opts: ToneOptions = {}): ToneIssue[] {
  const english = opts.english !== false;
  const maxWords = opts.maxWords ?? LIMITS.maxWords;
  const out: ToneIssue[] = [];
  if (english) {
    for (const w of BANNED) {
      if (w.re.test(text)) out.push({ code: "banned-word", phrase: w.phrase, message: `"${w.phrase}" (${w.category}): write ${w.instead}` });
    }
    const words = countWords(text);
    if (words > maxWords) out.push({ code: "too-long", message: `${words} words; keep a client message to ${maxWords} or fewer (split it into two messages)` });
  }
  const n = countAsks(text);
  if (n > 1) out.push({ code: "more-than-one-ask", message: `${n} requests in one message; keep one ask per message` });
  if (opts.requireAsk && n === 0) out.push({ code: "no-ask", message: "this message should say exactly what the client needs to do, and by when" });
  if (EMOJI.test(text)) out.push({ code: "emoji", message: "no emoji in client messages" });
  if (text.includes("!")) out.push({ code: "exclamation", message: "no exclamation marks; keep the tone calm" });
  return out;
}

/** Stable key of an issue, to tell whether a rewrite introduced it or the template already had it. */
export const toneKey = (i: ToneIssue): string => `${i.code}:${i.phrase ?? ""}`;
