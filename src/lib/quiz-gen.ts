// Gemini-powered quiz generator with strong guardrails.
//
// Guardrail strategy (defence in depth):
//   1. The model is told to ONLY use the supplied source text.
//   2. A Gemini `responseSchema` forces the output into the exact JSON shape, so we
//      never have to screen-scrape prose or recover from malformed JSON.
//   3. Each question must carry a `sourceQuote` — verbatim text from the source that
//      proves the correct answer.
//   4. We re-validate every returned question server-side:
//        - exactly one option flagged correct
//        - sourceQuote actually appears in the source (punctuation-normalised)
//        - no duplicate / blank options
//        - no "all/none of the above"
//      Anything that fails is dropped. Bad output → fewer questions, never
//      silently-wrong ones.
//
// Large counts (up to 100) are generated in BATCHES: a single Gemini call can only
// emit ~8k output tokens (~25 questions) before truncating, so we loop, dedupe
// across batches, and feed the model the questions already written so it doesn't
// repeat them. Each batch runs the full validation above.

import { z } from "zod";
import { resolveGeminiModel, isThinkingModel } from "@/lib/gemini";

export type Difficulty = "EASY" | "MEDIUM" | "HARD" | "MIXED";

export type DraftQuestion = {
  text: string;
  options: { text: string; isCorrect: boolean }[];
  sourceQuote: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
};

export type GenerateInput = {
  videoTitle: string;
  videoDescription?: string | null;
  sourceText: string;
  count: number;
  difficulty: Difficulty;
};

export type GenerateResult =
  | { ok: true; questions: DraftQuestion[]; dropped: number }
  | { ok: false; error: string };

const MIN_SOURCE_CHARS = 200;
const MAX_SOURCE_CHARS = 30_000;
const MIN_COUNT = 3;
const MAX_COUNT = 100;
const BATCH_SIZE = 25; // questions per Gemini call — stays under the output-token ceiling
const MAX_CALLS = 8; // hard cap on Gemini calls per generate, bounds cost/latency
const REQUEST_TIMEOUT_MS = 45_000;

// ---------- Gemini response schema (strict) ----------

const geminiQuestionSchema = z.object({
  text: z.string().min(8).max(400),
  options: z
    .array(
      z.object({
        text: z.string().min(1).max(240),
        isCorrect: z.boolean(),
      })
    )
    .length(4),
  sourceQuote: z.string().min(8).max(600),
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
});

const geminiPayloadSchema = z.object({
  questions: z.array(geminiQuestionSchema).min(1).max(120),
});

// Structured-output schema handed to Gemini so it can only return this shape.
// (OpenAPI subset — Gemini ignores minItems/length, so zod still enforces those.)
const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                text: { type: "string" },
                isCorrect: { type: "boolean" },
              },
              required: ["text", "isCorrect"],
            },
          },
          sourceQuote: { type: "string" },
          difficulty: { type: "string", enum: ["EASY", "MEDIUM", "HARD"] },
        },
        required: ["text", "options", "sourceQuote", "difficulty"],
      },
    },
  },
  required: ["questions"],
} as const;

// ---------- Prompt ----------

function buildPrompt(args: {
  videoTitle: string;
  videoDescription?: string | null;
  sourceText: string;
  count: number;
  difficulty: Difficulty;
  avoid: string[];
}): string {
  const diffInstruction =
    args.difficulty === "MIXED"
      ? "Mix EASY, MEDIUM and HARD questions roughly evenly. Tag each one with its level."
      : `All questions must be ${args.difficulty} difficulty. Tag every question with "${args.difficulty}".`;

  const avoidBlock = args.avoid.length
    ? `\nThese questions have ALREADY been written — do NOT repeat them or lightly reword them. Write DIFFERENT questions covering other facts in the source:\n${args.avoid
        .map((q) => `- ${q}`)
        .join("\n")}\n`
    : "";

  return `You are generating multiple-choice quiz questions for an internal corporate training video.

Video title: ${args.videoTitle}
${args.videoDescription ? `Video description: ${args.videoDescription}\n` : ""}
SOURCE TEXT (the ONLY allowed source of facts):
"""
${args.sourceText}
"""
${avoidBlock}
Rules — follow them strictly:
1. Use ONLY facts that are explicitly stated in the SOURCE TEXT above. Do NOT use outside knowledge, even if you "know" it to be true.
2. If the SOURCE TEXT does not contain enough material for ${args.count} good questions, return FEWER. Quality over quantity.
3. Each question MUST have:
   - exactly 4 options
   - exactly ONE correct option (isCorrect: true); the other three plausible but clearly wrong per the SOURCE TEXT
   - a "sourceQuote" field containing a VERBATIM substring of the SOURCE TEXT (copy it character-for-character, keeping the original punctuation) that proves the correct answer
4. Distractors must be wrong — not "also kind of right". They should sound plausible to someone who didn't read the source.
5. ${diffInstruction}
   - EASY: direct recall of a fact stated plainly in the source
   - MEDIUM: applying a concept or connecting two facts from the source
   - HARD: edge cases, comparisons, or "which of these is NOT…" style questions grounded in the source
6. Question text must be a clear, standalone sentence ending in a question mark.
7. Never reveal the answer inside the question.
8. No duplicate questions. No duplicate option text within a question.
9. Avoid "all of the above" / "none of the above".

Target: ${args.count} questions. Return JSON only.`;
}

// ---------- Validators ----------

// Normalise smart punctuation that models love to "tidy up" when copying, so a
// genuinely-grounded quote isn't dropped over a curly vs straight quote.
function normalise(s: string): string {
  return s
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―]/g, "-")
    .replace(/[…]/g, "...")
    .replace(/[ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isQuoteGrounded(quote: string, normalisedSource: string): boolean {
  const n = normalise(quote);
  if (n.length < 8) return false;
  return normalisedSource.includes(n);
}

function optionsAreClean(opts: DraftQuestion["options"]): boolean {
  const seen = new Set<string>();
  for (const o of opts) {
    const k = o.text.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

function validate(
  raw: z.infer<typeof geminiQuestionSchema>,
  normalisedSource: string
): DraftQuestion | null {
  if (raw.options.filter((o) => o.isCorrect).length !== 1) return null;
  if (!optionsAreClean(raw.options)) return null;
  if (!isQuoteGrounded(raw.sourceQuote, normalisedSource)) return null;
  if (raw.options.some((o) => /\b(all|none) of the above\b/i.test(o.text))) {
    return null;
  }
  return {
    text: raw.text.trim(),
    options: raw.options.map((o) => ({ text: o.text.trim(), isCorrect: o.isCorrect })),
    sourceQuote: raw.sourceQuote.trim(),
    difficulty: raw.difficulty,
  };
}

// ---------- Gemini call (single batch) ----------

function extractJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

type BatchResult =
  | { ok: true; questions: DraftQuestion[]; dropped: number }
  | { ok: false; error: string };

async function generateBatch(args: {
  apiKey: string;
  model: string;
  videoTitle: string;
  videoDescription?: string | null;
  sourceText: string;
  normalisedSource: string;
  difficulty: Difficulty;
  count: number;
  avoid: string[];
}): Promise<BatchResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    args.model
  )}:generateContent`;

  const prompt = buildPrompt({
    videoTitle: args.videoTitle,
    videoDescription: args.videoDescription,
    sourceText: args.sourceText,
    count: args.count,
    difficulty: args.difficulty,
    avoid: args.avoid,
  });

  // Gemini 2.5+ "thinking" eats the output-token budget before writing the JSON,
  // which truncates structured output. Disable it and give extra headroom.
  const thinking = isThinkingModel(args.model);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": args.apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: thinking ? 16384 : 8192,
          responseMimeType: "application/json",
          responseSchema: GEMINI_RESPONSE_SCHEMA,
          ...(thinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return { ok: false, error: "Gemini took too long to respond. Try again or reduce the question count." };
    }
    return { ok: false, error: `Network error calling Gemini: ${err.message}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 300);
    try {
      detail = JSON.parse(body)?.error?.message ?? detail;
    } catch {
      /* keep raw text */
    }
    return { ok: false, error: `Gemini API error ${res.status}: ${detail || res.statusText}` };
  }

  let json: {
    promptFeedback?: { blockReason?: string };
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  try {
    json = await res.json();
  } catch {
    return { ok: false, error: "Gemini returned a non-JSON response." };
  }

  if (json.promptFeedback?.blockReason) {
    return {
      ok: false,
      error: `Gemini blocked the request (${json.promptFeedback.blockReason}). Check the source text for unsafe content.`,
    };
  }

  const candidate = json.candidates?.[0];
  if (!candidate) return { ok: false, error: "Gemini returned no candidates. Try again." };
  if (candidate.finishReason && !["STOP", "MAX_TOKENS"].includes(candidate.finishReason)) {
    return { ok: false, error: `Gemini stopped early (${candidate.finishReason}). Try again.` };
  }

  const text = candidate.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) return { ok: false, error: "Gemini returned an empty response." };

  let parsed: unknown;
  try {
    parsed = extractJson(text);
  } catch {
    // A MAX_TOKENS truncation lands here; the caller simply keeps prior batches.
    return { ok: false, error: "Could not parse Gemini output as JSON (the batch may have been truncated)." };
  }

  const shape = geminiPayloadSchema.safeParse(parsed);
  if (!shape.success) {
    return { ok: false, error: "Gemini output did not match the required shape. Try again." };
  }

  const validated: DraftQuestion[] = [];
  let dropped = 0;
  for (const q of shape.data.questions) {
    const v = validate(q, args.normalisedSource);
    if (v) validated.push(v);
    else dropped++;
  }
  return { ok: true, questions: validated, dropped };
}

// ---------- Public API: loop batches until we hit the target ----------

export async function generateQuiz(input: GenerateInput): Promise<GenerateResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY is not set on the server." };

  const sourceText = input.sourceText.trim();
  if (sourceText.length < MIN_SOURCE_CHARS) {
    return {
      ok: false,
      error: `Paste at least ${MIN_SOURCE_CHARS} characters of source text so questions can be grounded. You provided ${sourceText.length}.`,
    };
  }
  if (sourceText.length > MAX_SOURCE_CHARS) {
    return {
      ok: false,
      error: `Source text is too long (${sourceText.length} chars). Trim to under ${MAX_SOURCE_CHARS}.`,
    };
  }

  const target = Math.max(MIN_COUNT, Math.min(MAX_COUNT, Math.round(input.count || MIN_COUNT)));
  const model = await resolveGeminiModel(apiKey);
  const normalisedSource = normalise(sourceText);

  const collected: DraftQuestion[] = [];
  const seen = new Set<string>(); // normalised question text → dedupe across batches
  let totalDropped = 0;
  let dryStreak = 0; // consecutive batches that added nothing new
  let lastError: string | null = null;

  for (let call = 0; call < MAX_CALLS && collected.length < target && dryStreak < 2; call++) {
    const need = target - collected.length;
    // Ask for a small buffer over what we still need (offsets guardrail drops),
    // capped at the per-batch ceiling.
    const askFor = Math.min(BATCH_SIZE, Math.max(need + 3, MIN_COUNT));
    const avoid = collected.slice(-80).map((q) => q.text);

    const res = await generateBatch({
      apiKey,
      model,
      videoTitle: input.videoTitle,
      videoDescription: input.videoDescription,
      sourceText,
      normalisedSource,
      difficulty: input.difficulty,
      count: askFor,
      avoid,
    });

    if (!res.ok) {
      lastError = res.error;
      break; // keep whatever earlier batches produced
    }

    totalDropped += res.dropped;
    let added = 0;
    for (const q of res.questions) {
      const key = normalise(q.text);
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(q);
      added++;
      if (collected.length >= target) break;
    }
    if (added === 0) dryStreak++;
    else dryStreak = 0;
  }

  if (collected.length === 0) {
    return {
      ok: false,
      error:
        lastError ??
        "Every generated question failed the grounding check. Try pasting more detailed source text and regenerate.",
    };
  }

  return { ok: true, questions: collected.slice(0, target), dropped: totalDropped };
}
