import { z } from "zod";
import { callGemini } from "@/lib/gemini";
import type { DictionaryEntry } from "@/lib/ai/types";
import { MAX_SUB_PROCESSES, type SopAnalysis, type SopBrief, type SopContent, type SopControl } from "./types";

// Reuses the LMS Gemini key/model. Guardrailed calls:
//   1. analyze — is this a legitimate SOP request for a CA firm? If yes, produce a brief, the
//      process map (sub-processes) and the questions the description leaves unanswered.
//   2. generate — turn the confirmed brief into a STRUCTURED SOP (validated JSON): one call for
//      the framing sections and one per sub-process, so every minute step fits inside the
//      model's output limit however long the procedure is.
// The firm's departments bound the allowed scope; off-topic requests are rejected.
//
// DPDP (security audit #7): staff free text may name clients or quote their identifiers. Every
// call goes through callGemini's mask gate with the firm's name dictionary (every active client's
// name and contact + staff names); a prompt the leak detector still flags is not sent and the
// author is told why. If the dictionary cannot be loaded, nothing is sent either (fail closed).

/** Injectable for tests; production loads client master + staff names from the database. */
export type SopAiDeps = { dictionary?: () => Promise<DictionaryEntry[]> };

async function sopDictionary(deps: SopAiDeps = {}): Promise<DictionaryEntry[]> {
  if (deps.dictionary) return deps.dictionary();
  try {
    const [{ prisma }, { loadFirmNameDictionary }] = await Promise.all([import("@/lib/prisma"), import("@/lib/ai/name-directory")]);
    return await loadFirmNameDictionary(prisma as unknown as Parameters<typeof loadFirmNameDictionary>[0]);
  } catch {
    throw new Error("The list of client and staff names to hide from the AI could not be loaded, so nothing was sent. Try again in a minute.");
  }
}

const DEPARTMENTS = ["AUDIT", "TAX", "ACCOUNTS", "ROC", "TECH", "ADMIN", "GENERAL"];

// A password written into an SOP is leaked the day it is saved, and it would go to the AI too.
// Anything that reads like a credential is cut before it is sent or stored. After ":" or "=" any
// value counts. After "is", " - " or just a space, only a value with a digit or one of !@#$%^&*
// counts, so "OTP 123456" and "password - Abc@123" go but "the password is in the vault",
// "enter the OTP sent to the client" and "a password-protected file" stay.
// Idempotent: a value already replaced is skipped, since the text is stripped again on every
// version (service, then the prompt builders).
// Best-effort guard against the obvious cases, not a guarantee that no credential gets through.
const SECRET = /\b(pass ?word|passcode|pwd|otp|api[ _-]?key)\b(\s*[:=]\s*|(?:\s+is|\s+-)?\s+(?=\S*[\d!@#$%^&*]))(?!\[removed)(\S+)/gi;
export function stripSecrets(text: string): string {
  return text.replace(SECRET, (_m, label: string, sep: string) => `${label}${sep}[removed: never write a password in an SOP]`);
}

// Every free-text field of a brief, stripped one by one (never the JSON text, whose quotes the
// pattern would eat).
export function stripBriefSecrets(b: SopBrief): SopBrief {
  return {
    ...b,
    title: stripSecrets(b.title),
    workCategory: stripSecrets(b.workCategory),
    objective: stripSecrets(b.objective),
    scope: stripSecrets(b.scope),
    keySteps: b.keySteps.map((s) => stripSecrets(s)),
    rolesInvolved: b.rolesInvolved.map((s) => stripSecrets(s)),
    references: b.references.map((s) => stripSecrets(s)),
    ...(b.subProcesses ? { subProcesses: b.subProcesses.map((s) => stripSecrets(s)) } : {}),
  };
}

// Measured live (11 Nov 2026, gemini-2.5-flash): a call answers in 2–8 s, but now and then the
// model repeats one sentence inside a field until the 16k output cap (~60 s, finish=MAX_TOKENS),
// for one prompt in up to a third of tries. Schema maxItems is refused ("too many states") and
// maxLength is not enforced, and a prompt rule did not lower the rate. A runaway is random, so
// give each try 15 s and ask again, up to 3 tries: worst case 45 s, under the routes' 60 s.
// The abandoned request is still aborted by callGemini's own 45 s timeout.
const CALL_LIMIT_MS = 15_000;
const ATTEMPTS = 3;
export async function callWithRetry(prompt: string, schema: object, dictionary: DictionaryEntry[]): Promise<string> {
  const once = () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("The AI took too long to answer. Try again in a minute."), { name: "TimeoutError" })), CALL_LIMIT_MS);
    });
    // Promise.race keeps listening to an abandoned call, so its later 45 s abort is handled.
    return Promise.race([callGemini(prompt, schema, { dictionary, what: "This procedure" }), limit]).finally(() => clearTimeout(timer));
  };
  for (let attempt = 1; ; attempt++) {
    try {
      return await once();
    } catch (e) {
      if ((e as Error).name !== "TimeoutError" || attempt === ATTEMPTS) throw e;
    }
  }
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
  subProcesses: z.array(z.string()).optional(),
});
const analysisZ = z.object({ valid: z.boolean(), reason: z.string().optional(), brief: briefZ.optional(), questions: z.array(z.string()).optional() });

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
        subProcesses: { type: "array", items: { type: "string" } },
      },
    },
    questions: { type: "array", items: { type: "string" } },
  },
  required: ["valid"],
};

export async function analyzeSopRequest(input: { title: string; department: string; workCategory: string; purpose: string; rawProcedure: string }, deps: SopAiDeps = {}): Promise<SopAnalysis> {
  const dictionary = await sopDictionary(deps);
  // Everything staff typed, stripped of anything that reads like a credential.
  const request = stripSecrets(`REQUEST
- Proposed title: ${input.title || "(none)"}
- Department (user's pick): ${input.department}
- Work category: ${input.workCategory || "(none)"}
- Purpose: ${input.purpose || "(none)"}
- Procedure (layman description): ${input.rawProcedure}`);
  const prompt = `You are the gatekeeper and technical lead for the Standard Operating Procedure (SOP) system of a Chartered Accountancy / professional-services firm. Its departments are: Audit, Tax, Accounts, ROC (Registrar of Companies compliance), Tech (internal engineering), and Admin (operations/HR/finance/front-office).

Decide whether the request below is a legitimate professional or operational SOP for such a firm. REJECT (valid=false, with a short reason) if it is off-topic (e.g. recipes, personal life, entertainment), harmful, disallowed, spam/gibberish, or clearly not an operational procedure. Do NOT invent an SOP for an out-of-scope topic.

If it is valid, produce a refined, well-scoped brief: a crisp title, the best-fit department (one of AUDIT, TAX, ACCOUNTS, ROC, TECH, ADMIN, GENERAL), a one-line objective, a scope statement, the key steps in order (as many as the work has, up to 40), the roles involved, and any references implied. Also give subProcesses: the 1–${MAX_SUB_PROCESSES} parts the work divides into, in the order they happen (for example "Collect bank statements", "Enter unrecorded entries", "Match and clear", "Review and sign off"); a short procedure may be a single sub-process. Keep it faithful to the user's intent — refine and structure it, do not fabricate unrelated content.

Then give questions: up to 12 specific things a new joiner would need to do this work alone that the description does not say — which software and screen, where a file comes from, where it is saved and how it is named, who reviews or approves, the deadline, what to do when figures do not match or a document is missing. Ask only about real gaps in THIS procedure, in plain words, one question each. Never ask for a password or any other credential.

${request}

Return JSON matching the schema.`;

  const raw = await callWithRetry(prompt, ANALYSIS_SCHEMA, dictionary);
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

const frameZ = z.object({
  purpose: z.string(),
  scope: z.string(),
  definitions: z.array(z.object({ term: z.string(), meaning: z.string() })).default([]),
  responsibilities: z.array(z.object({ role: z.string(), duty: z.string() })).default([]),
  kpis: z.array(z.string()).default([]),
  risks: z.array(z.object({ risk: z.string(), control: z.string(), owner: z.string().default(""), frequency: z.string().default("") })).default([]),
  references: z.array(z.string()).default([]),
});
const subProcessZ = z.object({
  objective: z.string().default(""),
  owner: z.string().default(""),
  steps: z
    .array(
      z.object({
        role: z.string(),
        action: z.string(),
        system: z.string().default(""),
        input: z.string().default(""),
        output: z.string().default(""),
        ifThen: z.array(z.string()).default([]),
        check: z.string().default(""),
        checkType: z.string().default(""),
      }),
    )
    .min(1),
  toConfirm: z.array(z.string()).default([]),
});
export type SopFrame = z.infer<typeof frameZ>;
export type SopSubProcessDraft = z.infer<typeof subProcessZ>;

const FRAME_SCHEMA = {
  type: "object",
  properties: {
    purpose: { type: "string" },
    scope: { type: "string" },
    definitions: { type: "array", items: { type: "object", properties: { term: { type: "string" }, meaning: { type: "string" } }, required: ["term", "meaning"] } },
    responsibilities: { type: "array", items: { type: "object", properties: { role: { type: "string" }, duty: { type: "string" } }, required: ["role", "duty"] } },
    kpis: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "object", properties: { risk: { type: "string" }, control: { type: "string" }, owner: { type: "string" }, frequency: { type: "string" } }, required: ["risk", "control"] } },
    references: { type: "array", items: { type: "string" } },
  },
  required: ["purpose", "scope"],
};
const SUB_PROCESS_SCHEMA = {
  type: "object",
  properties: {
    objective: { type: "string" },
    owner: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string" },
          action: { type: "string" },
          system: { type: "string" },
          input: { type: "string" },
          output: { type: "string" },
          ifThen: { type: "array", items: { type: "string" } },
          check: { type: "string" },
          checkType: { type: "string" },
        },
        required: ["role", "action"],
      },
    },
    toConfirm: { type: "array", items: { type: "string" } },
  },
  required: ["steps"],
};

// Numbering is done here, not by the model, so step numbers and control ids are always
// consistent across the separately generated sub-processes.
export function assembleSop(brief: SopBrief, meta: { effectiveDate: string; revision: string }, frame: SopFrame, drafts: { name: string; draft: SopSubProcessDraft }[]): SopContent {
  const controls: SopControl[] = [];
  const openPoints: string[] = [];
  let manual = 0;
  let application = 0;
  const subProcesses = drafts.map(({ name, draft }, i) => {
    const code = `P${String(i + 1).padStart(2, "0")}`;
    draft.toConfirm.forEach((q) => openPoints.push(`${code}: ${q}`));
    const steps = draft.steps.map((s, j) => {
      let control = "";
      if (s.check.trim()) {
        const type = s.checkType.toUpperCase() === "APPLICATION" ? "APPLICATION" : "MANUAL";
        control = type === "APPLICATION" ? `AC${++application}` : `C${++manual}`;
        controls.push({ id: control, type, description: s.check.trim() });
      }
      return { no: `${code}.${j + 1}`, role: s.role, action: s.action, system: s.system, input: s.input, output: s.output, ifThen: s.ifThen, control };
    });
    return { code, name, objective: draft.objective, owner: draft.owner, steps };
  });
  let n = 0;
  return {
    schemaVersion: 2,
    title: brief.title,
    department: brief.department,
    workCategory: brief.workCategory,
    effectiveDate: meta.effectiveDate,
    revision: meta.revision,
    purpose: frame.purpose,
    scope: frame.scope,
    definitions: frame.definitions,
    responsibilities: frame.responsibilities,
    flowchart: subProcesses.map((p) => `${p.code} · ${p.name}`),
    // The flat list older readers of the content expect.
    procedure: subProcesses.flatMap((p) => p.steps.map((s) => ({ step: ++n, action: s.action, responsibility: s.role }))),
    references: frame.references,
    subProcesses,
    controls,
    kpis: frame.kpis,
    risks: frame.risks,
    openPoints: [...new Set(openPoints)],
  };
}

export async function generateSop(confirmed: SopBrief, rawProcedure: string, meta: { effectiveDate: string; revision: string }, deps: SopAiDeps = {}): Promise<SopContent> {
  // The title and sub-process names also appear outside the context block below.
  const brief = stripBriefSecrets(confirmed);
  const names = (brief.subProcesses ?? []).map((s) => s.trim()).filter(Boolean);
  if (names.length > MAX_SUB_PROCESSES) throw new Error(`Keep it to ${MAX_SUB_PROCESSES} sub-processes. Merge some, or split this into two SOPs.`);
  if (!names.length) names.push(brief.title);
  const dictionary = await sopDictionary(deps);

  const context = stripSecrets(`CONFIRMED BRIEF
- Title: ${brief.title}
- Department: ${brief.department}
- Work category: ${brief.workCategory}
- Objective: ${brief.objective}
- Scope: ${brief.scope}
- Sub-processes, in order: ${names.join("; ")}
- Key steps: ${brief.keySteps.join("; ")}
- Roles: ${brief.rolesInvolved.join(", ")}
- References: ${brief.references.join(", ")}

AUTHOR'S DESCRIPTION (with any clarifications)
${rawProcedure}`);

  const framePrompt = `You are an expert technical writer and quality specialist at a Chartered Accountancy / professional-services firm. Write the framing sections of a Standard Operating Procedure, using ONLY the confirmed brief and the author's description below. The step-by-step procedure is written separately: do not write steps here. Do not add unrelated content, and do not invent facts the description does not support.

${context}

Write:
- purpose: 2–3 sentences (what and why).
- scope: who/what it applies to (mention the ${brief.department} department), and what is out of scope.
- definitions: every abbreviation and term a new joiner may not know (may be empty).
- responsibilities: role → duty (use ROLES, never personal names).
- kpis: how the firm can tell this work was done well (turnaround, due date met, error or rework count). Only measures the description supports; may be empty.
- risks: what can go wrong in this work, each with the control that prevents or catches it, the role that owns that control and how often it runs. May be empty.
- references: standards, laws, forms or policies referenced (may be empty).
Return JSON matching the schema.`;

  const subProcessPrompt = (name: string) => `You are documenting how work is really done at a Chartered Accountancy / professional-services firm, for a new joiner who has never seen this process and has nobody to ask. Write ONLY the sub-process "${name}" of the SOP "${brief.title}". The other sub-processes are written separately: do not repeat their steps.

Use ONLY the confirmed brief and the author's description below.

${context}

RULES
1. One physical action per step: open, sign in, click, select, type, attach, save, send, wait, check. Never join two actions with "and".
2. Record every minute step, including the ones people skip because they seem obvious: signing in, which menu to open, which button to press, what to type in each field and where that value comes from, where the file is saved and how it is named, who is told, how you know it worked.
3. system: the application, screen and menu path for that step (for example "Tally Prime > Gateway of Tally > Vouchers > F5 Payment"), or "" for work done off-screen.
4. input: what the person must have in hand before the step. output: what exists after it.
5. ifThen: every way the step can go differently, each written as "If <what is different>, then <exactly what to do>". Empty when there is none.
6. check: when the step is a verification, review or approval, say what is checked against what; checkType is MANUAL when a person does it and APPLICATION when the software enforces it. Otherwise leave both "".
7. role: the job role that does the step. Never a person's name.
8. Do NOT invent. Where the description does not give a screen name, menu path, field, amount, deadline or approver, write "[TO CONFIRM]" in that place and add the exact question to toConfirm. A marked gap is useful; a guessed detail is dangerous.
9. Never write a password, OTP or any other credential.
Also give objective (one sentence: what this sub-process achieves) and owner (the role accountable for it).
Write as many steps as the work really has (usually 8 to 30). Return JSON matching the schema.`;

  const ask = async (prompt: string, schema: object): Promise<unknown> => {
    const raw = await callWithRetry(prompt, schema, dictionary);
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Could not parse the generated SOP.");
    }
  };

  const [frameRaw, draftsRaw] = await Promise.all([ask(framePrompt, FRAME_SCHEMA), Promise.all(names.map((name) => ask(subProcessPrompt(name), SUB_PROCESS_SCHEMA)))]);
  const frame = frameZ.safeParse(frameRaw);
  const drafts = draftsRaw.map((d) => subProcessZ.safeParse(d));
  if (!frame.success || drafts.some((d) => !d.success)) throw new Error("The generated SOP was malformed.");
  return assembleSop(
    brief,
    meta,
    frame.data,
    drafts.map((d, i) => ({ name: names[i], draft: d.data as SopSubProcessDraft })),
  );
}
