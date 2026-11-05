// Shared ModelRouter types (orchestrator spec, "ModelRouter interface"). router.ts re-exports
// them; providers import from here so they never depend on the router itself.
import type { ZodSchema } from "zod";

export type Privacy = "local-only" | "anonymize-then-cloud" | "public";
export type Difficulty = "sop" | "judgement" | "novel";
export type ProviderId = "claude" | "grok" | "local";
/** FAST / SMART / HARD are the cloud ladder; LOCAL is the in-house open-weight model. */
export type Tier = "FAST" | "SMART" | "HARD" | "LOCAL";

export type AgentName = "gst" | "roc" | "tax" | "books" | "audit" | "onboarding" | "comms" | "coach" | "system";
/** "<agent>.<task>", e.g. "gst.extract-invoices". The prefix becomes ModelCall.agent. */
export type AgentTask = `${AgentName}.${string}`;

export interface Msg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelRequest<T = unknown> {
  task: AgentTask;
  privacy: Privacy;
  difficulty: Difficulty;
  messages: Msg[];
  /** Caller's output schema. The router wraps it as { output, confidence }. Omit for free text. */
  schema?: ZodSchema<T>;
  maxCostInr?: number;
  runId: string;
  // ---- optional extensions (not in the spec interface; all default to off) ----
  /** Checklist-engine hook: return human-readable issues; any issue triggers escalation. */
  contradictions?: (output: T) => string[] | Promise<string[]>;
  /** Client-master dictionary for the anonymizer (names, companies, addresses). */
  dictionary?: DictionaryEntry[];
  /** Per-call output token cap (default 4096). */
  maxTokens?: number;
  /** Version of a registered prompt (ADR-008): ModelCall.task records `<task>@<taskVersion>`. */
  taskVersion?: number;
  /**
   * Pin the cloud tier (ADR-008 agreement re-ask on a different tier). No escalation follows; a
   * `local-only` request ignores it (local or queue, never cloud).
   */
  forceTier?: Exclude<Tier, "LOCAL">;
  /**
   * The second, independent read of a high-stakes judgement (ADR-008). Logged as `<task>…#2`;
   * recorded routers answer it from the `<task>#2` recording when one exists.
   */
  secondOpinion?: boolean;
}

export interface ModelResponse<T> {
  output: T;
  provider: ProviderId;
  model: string;
  confidence: number;
  escalated: boolean;
  anonymized: boolean;
  tokensIn: number;
  tokensOut: number;
  costInr: number;
}

/** What the router hands a provider: already masked, system prompt split out. */
export interface ProviderRequest {
  model: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** JSON Schema of the expected object (the router's { output, confidence } wrapper). */
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
}

export interface ProviderResult<T = unknown> {
  /** Parsed JSON object returned by the model (not yet schema-validated). */
  output: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface ModelProvider {
  id: ProviderId;
  isAvailable(): Promise<boolean>;
  complete<T>(req: ProviderRequest): Promise<ProviderResult<T>>;
}

export type DictionaryKind = "NAME" | "ORG" | "ADDRESS";
export interface DictionaryEntry {
  value: string;
  kind: DictionaryKind;
}
