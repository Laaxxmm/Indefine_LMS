// Resolve a Gemini model that THIS API key can actually use for generateContent.
//
// Hard-coding "gemini-2.0-flash" breaks when a key/project can't reach that exact
// name (model retired, region differences, or a stale GEMINI_MODEL pin) — it 404s
// with "model not found". Instead we ask the key what it has (ListModels) and pick
// a stable multimodal flash model. Result is cached for the server process.

const BASE = "https://generativelanguage.googleapis.com";

let cached: string | null = null;

// Gemini 2.5+ (and newer) ship with "thinking" on by default, which spends the
// output-token budget before producing the answer — truncating structured JSON.
// We disable it for our deterministic calls.
export function isThinkingModel(model: string): boolean {
  return /2\.5|gemini-[3-9]/i.test(model);
}

export async function resolveGeminiModel(apiKey: string): Promise<string> {
  if (cached) return cached;

  const envModel = process.env.GEMINI_MODEL?.trim() || "";

  let available: string[] = [];
  try {
    const res = await fetch(`${BASE}/v1beta/models?pageSize=1000`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        models?: { name?: string; supportedGenerationMethods?: string[] }[];
      };
      available = (json.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => (m.name ?? "").replace(/^models\//, ""))
        .filter(Boolean);
    }
  } catch {
    /* fall through to env / sensible default */
  }

  // Honour an explicit pin only if the key actually has it (or we couldn't list).
  if (envModel && (available.length === 0 || available.includes(envModel))) {
    cached = envModel;
    return cached;
  }

  if (available.length === 0) {
    // Couldn't list models — best-effort default.
    cached = envModel || "gemini-2.5-flash";
    return cached;
  }

  const isStable = (id: string) =>
    !/(exp|preview|thinking|tts|image|embedding|vision|learnlm|aqa|gemma)/i.test(id);
  const find = (pred: (id: string) => boolean) => available.find(pred);

  cached =
    find((id) => /^gemini-2\.5-flash$/.test(id)) ||
    find((id) => /gemini-2\.5-flash/.test(id) && isStable(id)) ||
    find((id) => /^gemini-2\.0-flash$/.test(id)) ||
    find((id) => /gemini-[\d.]+-flash/.test(id) && isStable(id)) ||
    find((id) => /gemini-[\d.]+-pro/.test(id) && isStable(id)) ||
    find(isStable) ||
    available[0];

  return cached;
}

// One JSON-mode generateContent call with this key's resolved model. `schema` is a
// Gemini responseSchema; the caller still validates the parsed result.
const CALL_TIMEOUT_MS = 45_000;

export async function callGemini(prompt: string, schema?: object): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the server.");
  const model = await resolveGeminiModel(apiKey);
  const thinking = isThinkingModel(model);

  const res = await fetch(`${BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: thinking ? 16384 : 8192,
        responseMimeType: "application/json",
        ...(schema ? { responseSchema: schema } : {}),
        ...(thinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let detail = body.slice(0, 300);
    try {
      detail = JSON.parse(body)?.error?.message ?? detail;
    } catch {
      /* keep raw */
    }
    throw new Error(`Gemini API error ${res.status}: ${detail || res.statusText}`);
  }
  const json = (await res.json()) as { promptFeedback?: { blockReason?: string }; candidates?: { content?: { parts?: { text?: string }[] } }[] };
  if (json.promptFeedback?.blockReason) throw new Error(`Request was blocked by the model (${json.promptFeedback.blockReason}).`);
  const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini returned no content.");
  return text;
}
