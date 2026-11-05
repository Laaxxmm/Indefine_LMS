// Model supply chain record (ADR-009: OWASP LLM03). Which provider SDK and which model ids a run
// was produced with, written into every `guardrail-run` AuditEvent so a behaviour change can be
// traced to a dependency or model change. Model ids are also part of every task's prompt-lock
// hash (prompt-lock.ts); the SDK version here must equal the installed package and the lockfile
// (supply-chain test), so an SDK upgrade is a reviewed edit of this file, never a silent bump.
// The SDK itself is imported only by src/lib/ai/providers/* (verify:ai-boundary). Pure.
import { DEFAULT_MODELS } from "@/lib/ai/config";

export const MODEL_SUPPLY_CHAIN = Object.freeze({
  sdk: "@anthropic-ai/sdk",
  sdkVersion: "1.5.0",
  /** Code-default model ids per tier (env may override; overrides are logged per call in ModelCall.model). */
  models: DEFAULT_MODELS,
});

/** Compact form for AuditEvent meta. */
export const supplyChainMeta = () => ({ sdk: `${MODEL_SUPPLY_CHAIN.sdk}@${MODEL_SUPPLY_CHAIN.sdkVersion}`, models: { ...MODEL_SUPPLY_CHAIN.models } });
