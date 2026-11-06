// The mask gate for the legacy LMS Gemini paths (security audit #7, #11; ADR-002 "Legacy Gemini").
//
// Those features call Gemini directly, outside the ModelRouter: SOP Builder (staff free text, up to
// 50 KB), quiz generation and transcript distillation (training notes and live-session
// transcripts), statutory digests (public portal text). Every text prompt now goes through
// gateForGemini() before it leaves: mask() with the firm's name dictionary, then the independent
// leak detector; anything it still finds stops the call (nothing is sent) with a plain message.
// The answer gets its values back (restore) so the feature behaves as before.
//
// transcriptGate() is the live-session check: a transcript is parked for an admin instead of being
// sent when masking cannot cover it (the detector still finds client data, or numbers are spoken
// as words — "nine eight seven six…" — which no masker can see). Video / audio uploads cannot be
// masked at all; their callers park them (src/lib/auto-quiz.ts). Pure: no I/O.
import { detectPii, mask, unmask, withTextNames, type PiiKind } from "./anonymizer";
import type { DictionaryEntry } from "./types";

/** A legacy Gemini call refused because client details could not be hidden (nothing was sent). */
export class LegacyGateError extends Error {
  constructor(
    readonly kinds: readonly string[],
    what = "This text",
  ) {
    super(`${what} contains client details that could not be hidden from the AI (${kinds.join(", ")}), so it was not sent. Remove them and try again, or ask an admin.`);
    this.name = "LegacyGateError";
  }
}

export interface GatedPrompt {
  /** What may be sent: the prompt with client data replaced by tokens. */
  prompt: string;
  /** Put the original values back into the model's answer. */
  restore(text: string): string;
  /** How many distinct values were masked. */
  masked: number;
}

/** Mask a legacy Gemini prompt and gate it with the independent detector (throws LegacyGateError). */
export function gateForGemini(prompt: string, opts: { dictionary?: DictionaryEntry[]; what?: string } = {}): GatedPrompt {
  // Re-audit NEW-1: names typed in the prompt join the dictionary (all their variants are masked), and a
  // probable person name the masker still left stops the call like any identifier.
  const dictionary = withTextNames(opts.dictionary, prompt);
  const { masked, map } = mask(prompt, { dictionary, literals: "all" });
  const kinds: PiiKind[] = detectPii(masked, { dictionary, names: true });
  if (kinds.length) throw new LegacyGateError(kinds, opts.what);
  return { prompt: masked, restore: (text) => unmask(text, map), masked: map.byToken.size };
}

const DIGIT_WORD = "(?:zero|oh|one|two|three|four|five|six|seven|eight|nine|double|triple)";
/** Eight or more spoken digits in a row: a phone, account or Aadhaar number dictated aloud. */
const SPOKEN_DIGITS = new RegExp(`\\b${DIGIT_WORD}(?:[\\s,.-]{1,3}${DIGIT_WORD}){7,}\\b`, "i");

export type TranscriptVerdict = { send: true; masked: number } | { send: false; reasons: string[] };

/** What an admin reads when a live session is parked (no data was sent). */
export const PARKED_MESSAGE =
  "This live session's recording or transcript mentions client details that cannot be hidden from the AI, so no quiz was generated and nothing was sent to Gemini. Review the transcript and create the quiz by hand, or remove the client details first.";

/** May this transcript go to Gemini (masked), or must the session be parked for an admin? */
export function transcriptGate(transcript: string, dictionary?: DictionaryEntry[]): TranscriptVerdict {
  const reasons: string[] = [];
  if (SPOKEN_DIGITS.test(transcript)) reasons.push("numbers spoken as words");
  let masked = 0;
  try {
    masked = gateForGemini(transcript, { dictionary }).masked;
  } catch (e) {
    if (!(e instanceof LegacyGateError)) throw e;
    reasons.push(...e.kinds);
  }
  return reasons.length ? { send: false, reasons } : { send: true, masked };
}
