// Distill a raw transcript into verified key-point study notes.
//
// Raw meeting/video transcripts are noisy — greetings, attendance chatter,
// filler, half-repeated sentences from ASR. Generating a quiz straight off
// them produces shallow, repetitive questions. This runs a FIRST Gemini pass
// that reads the FULL transcript (no truncation, unlike direct generation
// which caps source at ~28k chars) and extracts the distinct teaching points.
//
// Grounding is preserved end-to-end: every key point must carry a `quote`
// that is a VERBATIM substring of the raw transcript — points that fail that
// check are dropped, exactly like quiz questions are. The verified notes then
// become the source text for quiz generation, so the chain is:
//   question → quotes the notes → notes → quote the transcript.

import { z } from "zod";
import { resolveGeminiModel, isThinkingModel } from "@/lib/gemini";
import { normalise } from "@/lib/quiz-gen";

const MAX_TRANSCRIPT_INPUT_CHARS = 200_000; // ~2.5h of speech, fits flash context
const MAX_NOTES_CHARS = 28_000; // stays under generateQuiz's source ceiling
const REQUEST_TIMEOUT_MS = 90_000;

const keyPointSchema = z.object({
  point: z.string().min(12).max(500),
  quote: z.string().min(8).max(600),
});
const payloadSchema = z.object({
  keyPoints: z.array(keyPointSchema).min(1).max(80),
});

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    keyPoints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          point: { type: "string" },
          quote: { type: "string" },
        },
        required: ["point", "quote"],
      },
    },
  },
  required: ["keyPoints"],
} as const;

export type DistillResult =
  | { ok: true; notes: string; kept: number; dropped: number }
  | { ok: false; error: string };

function buildPrompt(title: string, transcript: string): string {
  return `You are preparing detailed study notes from the raw transcript of an internal training session, so that exam questions can be written from them.

Session title: ${title}

RAW TRANSCRIPT (the ONLY allowed source of facts — it is auto-generated speech-to-text, so expect filler words, repetition and small transcription errors):
"""
${transcript}
"""

Extract every DISTINCT teaching point as a numbered key point. Rules:
1. Use ONLY facts explicitly stated in the transcript. No outside knowledge, even if you know the topic well.
2. Each key point must be ONE self-contained factual statement, written cleanly and precisely. Keep every number, date, rate, threshold, section reference and technical term EXACTLY as stated.
3. Each key point MUST include a "quote": a VERBATIM substring of the transcript (copied character-for-character, original punctuation) that proves the point.
4. One key point per distinct fact — do NOT restate the same fact in different words as multiple points.
5. SKIP greetings, attendance talk, small talk, tool/screen-sharing chatter, repeated sentences, and anything not teachable.
6. Prefer depth: procedures, conditions, exceptions, thresholds, comparisons, and reasons WHY — not just definitions.
7. Cover the WHOLE session start to finish, in the order taught.

Return JSON only.`;
}

/**
 * Run the distillation pass. Returns clean, transcript-verified notes ready to
 * feed generateQuiz(), or an error (callers fall back to the raw transcript).
 */
export async function distillTranscript(input: {
  title: string;
  transcript: string;
  apiKey: string;
}): Promise<DistillResult> {
  const transcript = input.transcript.trim().slice(0, MAX_TRANSCRIPT_INPUT_CHARS);
  if (transcript.length < 200) {
    return { ok: false, error: "Transcript too short to distill." };
  }

  const model = await resolveGeminiModel(input.apiKey);
  const thinking = isThinkingModel(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": input.apiKey,
      },
      body: JSON.stringify({
        contents: [
          { role: "user", parts: [{ text: buildPrompt(input.title, transcript) }] },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: thinking ? 16384 : 8192,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
          ...(thinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, error: `Distillation call failed: ${(e as Error).message}` };
  }
  if (!res.ok) {
    return { ok: false, error: `Gemini distillation error ${res.status}.` };
  }

  const json = (await res.json().catch(() => null)) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  } | null;
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) return { ok: false, error: "Empty distillation response." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    );
  } catch {
    return { ok: false, error: "Distillation output was not valid JSON." };
  }
  const shape = payloadSchema.safeParse(parsed);
  if (!shape.success) {
    return { ok: false, error: "Distillation output didn't match the schema." };
  }

  // Verify every key point against the raw transcript — same grounding rule
  // as quiz questions. Hallucinated points die here.
  const normalisedTranscript = normalise(transcript);
  const kept: { point: string; quote: string }[] = [];
  let dropped = 0;
  for (const kp of shape.data.keyPoints) {
    const q = normalise(kp.quote);
    if (q.length >= 8 && normalisedTranscript.includes(q)) {
      kept.push({ point: kp.point.trim(), quote: kp.quote.trim() });
    } else {
      dropped++;
    }
  }
  if (kept.length === 0) {
    return { ok: false, error: "No key points survived transcript verification." };
  }

  let notes = `Key teaching points from "${input.title}":\n\n`;
  for (let i = 0; i < kept.length; i++) {
    const line = `${i + 1}. ${kept[i].point}\n   Said in session: "${kept[i].quote}"\n\n`;
    if (notes.length + line.length > MAX_NOTES_CHARS) break;
    notes += line;
  }

  return { ok: true, notes: notes.trim(), kept: kept.length, dropped };
}
