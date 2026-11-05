// Per-task guardrail profile (ADR-009): docs/ai/guardrail-profiles.md is generated from the task
// registries by scripts/ai-guardrail-profiles.ts (`--check` fails when the committed document is
// stale; profiles.test.ts runs the same comparison). For every model task: department, input
// fence, injection screen, output schema summary, validators, grounding, agreement, token limits,
// privacy class and the OWASP LLM / NIST AI RMF items it satisfies. Deterministic (no dates). Pure.
import type { ZodTypeAny } from "zod";
import { ExtractedSpec } from "@/lib/agents/onboarding/spec";
import { EXTRACT_TASK } from "@/lib/agents/onboarding/extract";
import type { ChecklistPack } from "../checklist";
import { needsAgreement } from "./agreement";
import { hasTaskLimits, limitsFor } from "./limits";
import { groundedNumberPaths, hasAbstainOption, INSUFFICIENT_EVIDENCE, unboundedStrings } from "./schema";
import { DEPARTMENT_LABELS, checkTaskName, genericCheckTaskName, taskLabel, type AgentScope, type AnyTaskSpec } from "./scope";
import { INJECTION_PATTERNS } from "./untrusted";

export const PROFILES_DOC = "docs/ai/guardrail-profiles.md";

type ProfileAgent = { key: string; title: string; internal?: boolean; scope?: AgentScope; defaultChecklist: ChecklistPack };

export type TaskProfile = {
  agent: string;
  agentTitle: string;
  internal: boolean;
  department: string;
  task: string;
  kind: "extraction" | "checklist rule";
  documents: string;
  inputFence: string;
  injectionScreen: string;
  output: string;
  validators: string;
  grounding: string;
  agreement: string;
  limits: string;
  privacy: string;
  owasp: string[];
  nist: string[];
};

// ------------------------------------------------------------------ schema summary

type Def = { typeName?: string; [k: string]: unknown };
const defOf = (s: ZodTypeAny) => s._def as Def;
const fmt = (n: number) => n.toLocaleString("en-IN");

function unwrapOptional(s: ZodTypeAny): { inner: ZodTypeAny; optional: boolean } {
  let cur = s;
  let optional = false;
  for (let i = 0; i < 10; i++) {
    const d = defOf(cur);
    if (d.typeName === "ZodOptional" || d.typeName === "ZodNullable" || d.typeName === "ZodDefault") {
      optional = true;
      cur = d.innerType as ZodTypeAny;
    } else if (d.typeName === "ZodEffects") cur = d.schema as ZodTypeAny;
    else break;
  }
  return { inner: cur, optional };
}

const stringCap = (d: Def) => {
  const caps = ((d.checks as { kind: string; value?: number }[] | undefined) ?? []).filter((c) => (c.kind === "max" || c.kind === "length") && typeof c.value === "number").map((c) => c.value as number);
  return caps.length ? Math.min(...caps) : null;
};

/** One-line plain description of a model-task output schema. */
export function schemaSummary(schema: ZodTypeAny, depth = 0): string {
  if (depth > 8) return "…";
  const { inner } = unwrapOptional(schema);
  const d = defOf(inner);
  switch (d.typeName) {
    case "ZodObject": {
      const shape = (d.shape as () => Record<string, ZodTypeAny>)();
      const keys = Object.keys(shape);
      if (keys.length === 2 && keys.includes("quote") && keys.includes("location")) return "quote + location";
      return `{ ${keys
        .map((k) => {
          const u = unwrapOptional(shape[k]);
          return `${k}${u.optional ? "?" : ""}: ${schemaSummary(u.inner, depth + 1)}`;
        })
        .join("; ")} }`;
    }
    case "ZodArray": {
      const max = (d.maxLength as { value: number } | null)?.value;
      return `list${max !== undefined ? ` (≤ ${fmt(max)})` : ""} of ${schemaSummary(d.type as ZodTypeAny, depth + 1)}`;
    }
    case "ZodEnum": {
      const values = (d.values as string[]).filter((v) => v !== INSUFFICIENT_EVIDENCE);
      const abstain = (d.values as string[]).includes(INSUFFICIENT_EVIDENCE) ? " or insufficient_evidence" : "";
      return values.length <= 4 ? `${values.join(" | ")}${abstain}` : `one of ${values.length} values${abstain}`;
    }
    case "ZodString": {
      const cap = stringCap(d);
      const regex = ((d.checks as { kind: string }[] | undefined) ?? []).some((c) => c.kind === "regex");
      return `text${cap !== null ? ` ≤ ${cap}` : " (no cap)"}${regex ? " (pattern)" : ""}`;
    }
    case "ZodNumber":
      return groundedNumberPaths(inner).length ? "number (must appear in its quote)" : "number";
    case "ZodBoolean":
      return "yes/no";
    case "ZodLiteral":
      return `"${String(d.value)}"`;
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      const options = d.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>;
      return (Array.isArray(options) ? options : [...options.values()]).map((o) => schemaSummary(o, depth + 1)).join(" or ");
    }
    default:
      return String(d.typeName ?? "value").replace(/^Zod/, "").toLowerCase();
  }
}

// ------------------------------------------------------------------ one task

const isCheckTask = (agentKey: string, t: AnyTaskSpec) => t.name === genericCheckTaskName(agentKey) || t.name.startsWith(`${agentKey}.check:`);

const SCREEN_PATTERNS = `${INJECTION_PATTERNS.length} pattern groups (${INJECTION_PATTERNS.map((p) => p.id).join(", ")})`;

function limitsText(task: string): string {
  if (!hasTaskLimits(task)) return "not declared (default limits apply) — add a TASK_LIMITS entry";
  const l = limitsFor(task);
  return `input ≤ ${fmt(l.maxInputTokens)} tokens per call (longer documents are cut at a line and flagged); output ≤ ${fmt(l.maxOutputTokens)} tokens; hallucination budget ${Math.round(l.hallucinationBudget * 1000) / 10}% per day`;
}

function standards(p: { scoped: boolean; privacy?: string; closed: boolean; abstain: boolean; grounded: boolean; limits: boolean }): { owasp: string[]; nist: string[] } {
  const owasp: string[] = [];
  if (p.scoped) owasp.push("LLM01");
  if (p.privacy === "anonymize-then-cloud" || p.privacy === "local-only") owasp.push("LLM02");
  owasp.push("LLM03"); // model ids pinned and locked; SDK version recorded per run
  if (p.closed) owasp.push("LLM05");
  owasp.push("LLM06"); // no tools: the output is data that code validates
  owasp.push("LLM07"); // fixed registry prompt, no secrets, versioned
  if (p.grounded && p.abstain) owasp.push("LLM09");
  if (p.limits) owasp.push("LLM10");
  const nist = ["Govern", "Map", "Measure", "Manage"];
  return { owasp, nist };
}

function profileOf(agent: ProfileAgent, t: AnyTaskSpec): TaskProfile {
  const scope = agent.scope!;
  const check = isCheckTask(agent.key, t);
  const schema = t.schema as ZodTypeAny;
  const open = unboundedStrings(schema);
  const grounded = groundedNumberPaths(schema);
  const validators = [
    "Zod schema (a failure or confidence < 0.75 escalates one tier, at most twice, then needs review)",
    t.validate ? "the task's validator, run as the router's contradictions" : "",
    t.profile?.validators ?? "",
    check ? "checklist engine: the verdict's quote must occur in the documents shown, with a location" : "",
  ].filter(Boolean);
  const rules = agent.defaultChecklist.rules.filter((r) => r.kind === "llm" && (t.name === checkTaskName(agent.key, r.id) || (t.name === genericCheckTaskName(agent.key) && !scope.tasks.some((x) => x.name === checkTaskName(agent.key, r.id)))));
  const agreement = check
    ? rules.length
      ? rules.map((r) => `${r.id} (${r.severity}): ${needsAgreement(r, t) ? "two reads, the second on HARD; disagreement → reviewer question" : "single read"}`).join("; ")
      : "no rule in the default pack uses it"
    : t.highStakes
      ? "two reads, the second on HARD; disagreement → reviewer question"
      : "single read (validators and grounding decide what is kept)";
  const s = standards({ scoped: true, privacy: t.privacy, closed: open.length === 0, abstain: hasAbstainOption(schema), grounded: true, limits: hasTaskLimits(t.name) });
  return {
    agent: agent.key,
    agentTitle: agent.title,
    internal: agent.internal === true,
    department: DEPARTMENT_LABELS[scope.department],
    task: taskLabel(t),
    kind: check ? "checklist rule" : "extraction",
    documents: t.profile?.documents ?? "not declared",
    inputFence: "yes — every message is wrapped in the untrusted-documents fence by the guardrail session; FIRM_PREAMBLE says fenced text is data, never instructions",
    injectionScreen: check
      ? `framework: every line of the rule's documents is screened before the call (${SCREEN_PATTERNS}); a hit is withheld and raises the block flag possible-prompt-injection with its location`
      : `agent: each item is screened before the prompt is built (screenForModel) and a withheld item becomes a reviewer question; framework: every message line is screened again as a backstop (${SCREEN_PATTERNS}); any hit raises the block flag possible-prompt-injection`,
    output: `${schemaSummary(schema)}${open.length ? ` — OPEN TEXT: ${open.join("; ")}` : ""}${t.schemaPerCall ? " (closed enums built per call from the client's own data)" : ""}`,
    validators: validators.join("; "),
    grounding: check
      ? "verdict quote checked against the screened documents; a quote of withheld text is rejected (na + llm-evidence-missing)"
      : `every { quote, location } must occur in the screened text sent${grounded.length ? `; grounded numbers (${grounded.map((g) => g.path).join(", ")}) must appear in their quote` : ""}; ungrounded items are dropped and counted`,
    agreement,
    limits: limitsText(t.name),
    privacy: t.privacy ?? "per call (not declared)",
    owasp: s.owasp,
    nist: s.nist,
  };
}

/** The onboarding extractor: not an agent, but a Firm OS model call with the same fence and screen. */
function onboardingProfile(): TaskProfile {
  const schema = ExtractedSpec as unknown as ZodTypeAny;
  const s = standards({ scoped: true, privacy: "anonymize-then-cloud", closed: false, abstain: false, grounded: false, limits: hasTaskLimits(EXTRACT_TASK) });
  return {
    agent: "onboarding",
    agentTitle: "Client onboarding (extractor)",
    internal: false,
    department: "Firm onboarding (no department scope)",
    task: EXTRACT_TASK,
    kind: "extraction",
    documents: "One onboarding sentence typed or pasted by staff; staff and company names added to the masking dictionary.",
    inputFence: "yes — the sentence is wrapped in the untrusted-documents fence; EXTRACT_SYSTEM carries the same data-not-instructions line",
    injectionScreen: `the whole sentence is screened first (${SCREEN_PATTERNS}); a hit is not sent and the person answers the clarifier's questions instead, with a plain note`,
    output: `${schemaSummary(schema)} — open text fields by design`,
    validators: "Zod schema; normalizeExtracted and the onboarding validators (PAN / GSTIN / CIN checksums, codes, periods); the person confirms every field in the clarifier before anything is created",
    grounding: "none (no quotes): fields are checked by code and confirmed by the person",
    agreement: "single read",
    limits: limitsText(EXTRACT_TASK),
    privacy: "anonymize-then-cloud",
    owasp: s.owasp,
    nist: s.nist,
  };
}

/** Profiles of every scoped agent's tasks (registry order), then the onboarding extractor. */
export function taskProfiles(agents: Readonly<Record<string, ProfileAgent>>): TaskProfile[] {
  const out: TaskProfile[] = [];
  for (const a of Object.values(agents)) if (a.scope) for (const t of a.scope.tasks) out.push(profileOf(a, t));
  out.push(onboardingProfile());
  return out;
}

// ------------------------------------------------------------------ markdown

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function guardrailProfilesMarkdown(agents: Readonly<Record<string, ProfileAgent>>): string {
  const ps = taskProfiles(agents);
  const lines = [
    "# AI guardrail profiles, per task",
    "",
    "<!-- Generated by scripts/ai-guardrail-profiles.ts from the task registries. Do not edit by hand: change the registry, then run `npx tsx scripts/ai-guardrail-profiles.ts`. `--check` fails when this file is stale. -->",
    "",
    "Every model call Firm OS makes, with the guardrails that apply to it (ADR-008, ADR-009). OWASP items are from the OWASP Top 10 for LLM Applications (2025); NIST functions are from the NIST AI RMF 1.0. Controls that apply to every call are listed once below the table.",
    "",
    "| Agent | Task | Kind | Privacy | Agreement | Output limit (tokens) | OWASP LLM | NIST AI RMF |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const p of ps) {
    const two = p.agreement.includes("two reads") ? (p.agreement.includes("single read") ? "mixed" : "two reads") : "single read";
    const outLimit = /output ≤ ([\d,]+) tokens/.exec(p.limits)?.[1] ?? "default";
    lines.push(`| ${p.agent}${p.internal ? " (internal)" : ""} | \`${p.task}\` | ${p.kind} | ${p.privacy} | ${two} | ${outLimit} | ${p.owasp.join(", ")} | ${p.nist.join(", ")} |`);
  }
  lines.push(
    "",
    "## Every call",
    "",
    "- **Scope** (ADR-008): only tasks declared in the agent's registry run; the system prompt is FIRM_PREAMBLE + the department preamble + the task prompt; agents cannot send a system message.",
    "- **Router** (ADR-002): masking before any cloud call for non-public privacy, at most two escalations, per-run and daily budgets, every attempt logged in ModelCall with the hash of the masked prompt.",
    "- **No tools** (LLM06): providers use structured JSON output only; nothing the model returns can file, send, pay or delete.",
    "- **Prompt lock** (LLM03, LLM07): `prompts.lock.json` pins each `task@version` to the hash of its prompt, schema shape and tier hint (incl. the model ids); the SDK version is recorded in every `guardrail-run` AuditEvent.",
    "- **Drift** (LLM09): per agent per day schema-fail, escalation, abstain, ungrounded, disagreement and reviewer-override rates, plus each task's hallucination rate against its budget, on /admin/firm-os/models.",
    "",
  );
  let agent = "";
  for (const p of ps) {
    if (p.agent !== agent) {
      agent = p.agent;
      lines.push(`## ${p.agentTitle} (\`${p.agent}\`) — ${p.department}`, "");
    }
    lines.push(
      `### \`${p.task}\``,
      "",
      "| Control | This task |",
      "|---|---|",
      `| Kind | ${p.kind} |`,
      `| Documents sent | ${cell(p.documents)} |`,
      `| Input fence | ${cell(p.inputFence)} |`,
      `| Injection screen | ${cell(p.injectionScreen)} |`,
      `| Output schema | ${cell(p.output)} |`,
      `| Validators | ${cell(p.validators)} |`,
      `| Grounding | ${cell(p.grounding)} |`,
      `| Agreement | ${cell(p.agreement)} |`,
      `| Limits | ${cell(p.limits)} |`,
      `| Privacy class | ${cell(p.privacy)} |`,
      `| Standards | OWASP ${p.owasp.join(", ")}; NIST AI RMF ${p.nist.join(", ")} |`,
      "",
    );
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}
