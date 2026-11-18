// What a model call's failure may say when it is STORED (security audit #18).
//
// ModelCall rows are kept indefinitely (ADR-006) and AgentRun.error is shown on the run page, so
// they hold a CLASSIFICATION of what went wrong — never validator wording, model output or
// provider response text, which can quote client data (validators run on the unmasked output,
// providers may echo the request). Every code below is fixed text written here. Pure.
import { detectPii } from "./anonymizer";
import { ProviderError, ProviderUnavailableError } from "./errors";
import type { ProviderId } from "./types";

const PROVIDER_LABEL: Record<ProviderId, string> = { claude: "Claude", grok: "Grok", local: "Local model" };

/** A provider failure as a fixed classification ("provider: Claude unavailable (529)"). */
export function providerErrorCode(provider: ProviderId, err: unknown): string {
  const who = PROVIDER_LABEL[provider];
  if (err instanceof ProviderUnavailableError) {
    return `provider: ${who} not available (not configured or failing closed)${/not wired yet/.test(err.message) ? "; not wired yet (Phase 2b); failing closed" : ""}`;
  }
  if (err instanceof ProviderError) {
    const s = err.status !== undefined ? ` (${err.status})` : "";
    switch (err.kind) {
      case "outage":
        return `provider: ${who} unavailable${s}`;
      case "rate_limit":
        return `provider: ${who} rate limited${s || " (429)"}`;
      case "auth":
        return `provider: ${who} rejected the credentials${s}`;
      case "bad_request":
        return `provider: ${who} rejected the request${s}`;
      case "refusal":
        return `provider: ${who} declined the request (refusal)`;
    }
  }
  return `provider: ${who} call failed (${err instanceof Error ? err.name : "error"})`;
}

const VALIDATOR_CLASSES: [RegExp, string][] = [
  [/\bquote\b[\s\S]*?\b(?:not in|not found|does not (?:occur|appear)|missing)\b|\bnot (?:in|found in) the (?:line|source|document|text)/i, "ungrounded quote"],
  [/\bnumber\b[\s\S]*?\b(?:not|ungrounded)\b|\bnot a number of\b/i, "ungrounded number"],
  [/\blocation\b/i, "bad evidence location"],
  [/\b(?:twice|duplicate|repeated)\b/i, "duplicate answer"],
  [/\bnew (?:date|amount|number|fact|name|figure)\b|\binvented\b|\bnot in the template\b/i, "invented fact"],
  [/\b(?:unknown|not one of|not ours|no such|not offered|not allowed)\b/i, "unknown item"],
  [/\b(?:missing|no answer|required|empty|omitted)\b/i, "missing answer"],
  [/\b(?:total|sum|tie|ties|match|matches|reconcile)\b/i, "does not tie"],
  [/\b(?:banned|tone|language|script)\b/i, "wording rejected"],
];

/** A validator (contradiction) issue as a fixed class; the wording itself is never stored. */
export function validatorCode(issue: string): string {
  for (const [re, label] of VALIDATOR_CLASSES) if (re.test(issue)) return `validator: ${label}`;
  return "validator: rejected";
}

/** Zod issues as codes: the issue code and the schema path (array indexes as [], unusual keys as ?). */
export function zodCodes(err: { issues: { path: (string | number)[]; code: string }[] }): string[] {
  return err.issues.map((i) => {
    const path = i.path.map((p) => (typeof p === "number" ? "[]" : /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(p) ? p : "?")).join(".");
    return `schema: ${i.code}${path ? ` at ${path}` : ""}`;
  });
}

/** Stored error text: distinct codes with counts, capped; anything that still looks like PII is withheld. */
export function storedError(codes: readonly string[]): string | null {
  if (!codes.length) return null;
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
  const text = [...counts].map(([c, n]) => (n > 1 ? `${c} ×${n}` : c)).join("; ").slice(0, 1000);
  return detectPii(text).length ? "(error detail withheld: it looked like client data)" : text;
}

/**
 * Router `issues` (a needs-review result) as classifications, for callers that persist a failure
 * reason (AgentRun.error): "contradiction: …" → validator class, schema issues → the path only.
 */
export function issueSummary(issues: readonly string[]): string {
  const codes = issues.map((i) => {
    if (i.startsWith("contradiction: ")) return validatorCode(i.slice("contradiction: ".length));
    if (/^confidence\b/.test(i)) return /below/.test(i) ? "confidence: below threshold" : "confidence: missing or out of range";
    if (/JSON|cut off/.test(i)) return "provider: output was not valid JSON";
    const path = /^([A-Za-z_][A-Za-z0-9_.]{0,80}):\s/.exec(i)?.[1];
    return path ? `schema: invalid at ${path.replace(/\.\d+(?=\.|$)/g, ".[]")}` : "schema: invalid";
  });
  return storedError(codes) ?? "no detail";
}
