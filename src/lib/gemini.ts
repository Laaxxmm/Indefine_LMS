// Resolve a Gemini model that THIS API key can actually use for generateContent.
//
// Hard-coding "gemini-2.0-flash" breaks when a key/project can't reach that exact
// name (model retired, region differences, or a stale GEMINI_MODEL pin) — it 404s
// with "model not found". Instead we ask the key what it has (ListModels) and pick
// a stable multimodal flash model. Result is cached for the server process.

const BASE = "https://generativelanguage.googleapis.com";

let cached: string | null = null;

export function resetGeminiModelCache() {
  cached = null;
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
