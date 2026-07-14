import { z } from "zod";
import { resolveGeminiModel, isThinkingModel } from "@/lib/gemini";
import type { SopAnalysis, SopBrief, SopContent } from "./types";

// Reuses the LMS Gemini key/model. Two guardrailed calls:
//   1. analyze — is this a legitimate SOP request for a CA firm? If yes, produce a brief.
//   2. generate — turn the confirmed brief into a STRUCTURED SOP (validated JSON).
// The firm's departments bound the allowed scope; off-topic requests are rejected.

const BASE = "https://generativelanguage.googleapis.com";
const TIMEOUT_MS = 45_000;
const DEPARTMENTS = ["AUDIT", "TAX", "ACCOUNTS", "ROC", "TECH", "ADMIN", "GENERAL"];

async function callGemini(prompt: string, schema?: object): Promise<string> {
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
    signal: AbortSignal.timeout(TIMEOUT_MS),
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

/* ------------------------- 1. Analyze (guardrail) ------------------------- */

const briefZ = z.object({
  title: z.string(),
  department: z.string(),
  workCategory: z.string(),
  objective: z.string(),
  scope: z.string(),
  keySteps: z.array(z.string()),
  rolesInvolved: z.array(z.string()),
  references: z.array(z.string()),
});
const analysisZ = z.object({ valid: z.boolean(), reason: z.string().optional(), brief: briefZ.optional() });

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    valid: { type: "boolean" },
    reason: { type: "string" },
    brief: {
      type: "object",
      properties: {
        title: { type: "string" },
        department: { type: "string", enum: DEPARTMENTS },
        workCategory: { type: "string" },
        objective: { type: "string" },
        scope: { type: "string" },
        keySteps: { type: "array", items: { type: "string" } },
        rolesInvolved: { type: "array", items: { type: "string" } },
        references: { type: "array", items: { type: "string" } },
      },
    },
  },
  required: ["valid"],
};

export async function analyzeSopRequest(input: { title: string; department: string; workCategory: string; purpose: string; rawProcedure: string }): Promise<SopAnalysis> {
  const prompt = `You are the gatekeeper and technical lead for the Standard Operating Procedure (SOP) system of a Chartered Accountancy / professional-services firm. Its departments are: Audit, Tax, Accounts, ROC (Registrar of Companies compliance), Tech (internal engineering), and Admin (operations/HR/finance/front-office).

Decide whether the request below is a legitimate professional or operational SOP for such a firm. REJECT (valid=false, with a short reason) if it is off-topic (e.g. recipes, personal life, entertainment), harmful, disallowed, spam/gibberish, or clearly not an operational procedure. Do NOT invent an SOP for an out-of-scope topic.

If it is valid, produce a refined, well-scoped brief: a crisp title, the best-fit department (one of AUDIT, TAX, ACCOUNTS, ROC, TECH, ADMIN, GENERAL), a one-line objective, a scope statement, 4–10 concise key steps, the roles involved, and any references implied. Keep it faithful to the user's intent — refine and structure it, do not fabricate unrelated content.

REQUEST
- Proposed title: ${input.title || "(none)"}
- Department (user's pick): ${input.department}
- Work category: ${input.workCategory || "(none)"}
- Purpose: ${input.purpose || "(none)"}
- Procedure (layman description): ${input.rawProcedure}

Return JSON matching the schema.`;

  const raw = await callGemini(prompt, ANALYSIS_SCHEMA);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Could not parse the analysis response.");
  }
  const result = analysisZ.safeParse(parsed);
  if (!result.success) throw new Error("The analysis response was malformed.");
  const a = result.data;
  if (a.valid && a.brief && !DEPARTMENTS.includes(a.brief.department)) a.brief.department = input.department;
  return a as SopAnalysis;
}

/* ------------------------- 2. Generate (structured) ------------------------- */

const contentZ = z.object({
  title: z.string(),
  department: z.string(),
  workCategory: z.string(),
  effectiveDate: z.string(),
  revision: z.string(),
  purpose: z.string(),
  scope: z.string(),
  definitions: z.array(z.object({ term: z.string(), meaning: z.string() })),
  responsibilities: z.array(z.object({ role: z.string(), duty: z.string() })),
  flowchart: z.array(z.string()),
  procedure: z.array(z.object({ step: z.number(), action: z.string(), responsibility: z.string() })),
  references: z.array(z.string()),
});

const CONTENT_SCHEMA = {
  type: "object",
  properties: {
    purpose: { type: "string" },
    scope: { type: "string" },
    definitions: { type: "array", items: { type: "object", properties: { term: { type: "string" }, meaning: { type: "string" } }, required: ["term", "meaning"] } },
    responsibilities: { type: "array", items: { type: "object", properties: { role: { type: "string" }, duty: { type: "string" } }, required: ["role", "duty"] } },
    flowchart: { type: "array", items: { type: "string" } },
    procedure: { type: "array", items: { type: "object", properties: { step: { type: "number" }, action: { type: "string" }, responsibility: { type: "string" } }, required: ["step", "action", "responsibility"] } },
    references: { type: "array", items: { type: "string" } },
  },
  required: ["purpose", "scope", "procedure"],
};

export async function generateSop(brief: SopBrief, rawProcedure: string, meta: { effectiveDate: string; revision: string }): Promise<SopContent> {
  const prompt = `You are an expert technical writer and quality specialist. Produce a professional, concise, industry-standard Standard Operating Procedure for a Chartered Accountancy / professional-services firm, using ONLY the confirmed brief and the raw description below. Do not add unrelated content.

CONFIRMED BRIEF
- Title: ${brief.title}
- Department: ${brief.department}
- Work category: ${brief.workCategory}
- Objective: ${brief.objective}
- Scope: ${brief.scope}
- Key steps: ${brief.keySteps.join("; ")}
- Roles: ${brief.rolesInvolved.join(", ")}
- References: ${brief.references.join(", ")}
- Raw description: ${rawProcedure}

Write:
- purpose: 2–3 sentences (what and why).
- scope: who/what it applies to (mention the ${brief.department} department).
- definitions: any key terms (may be empty).
- responsibilities: role → duty (use ROLES, never personal names).
- flowchart: 4–8 short step labels for a top-to-bottom process flow.
- procedure: numbered steps, each with a clear imperative action and the responsible role.
- references: standards/policies referenced (may be empty).
Keep it tight enough to fit ~2 A4 pages. Return JSON matching the schema.`;

  const raw = await callGemini(prompt, CONTENT_SCHEMA);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Could not parse the generated SOP.");
  }
  // The model returns the body; we supply the stable header fields deterministically.
  const merged = {
    title: brief.title,
    department: brief.department,
    workCategory: brief.workCategory,
    effectiveDate: meta.effectiveDate,
    revision: meta.revision,
    definitions: [],
    responsibilities: [],
    flowchart: [],
    references: [],
    ...parsed,
  };
  const result = contentZ.safeParse(merged);
  if (!result.success) throw new Error("The generated SOP was malformed.");
  return result.data;
}
