// Which parts of a model's answer get their placeholders restored (security audit #25).
//
// A prompt-injected document can ask the model to repeat every placeholder it was shown in a
// free-text field; unmasking everything would then write this job's real PAN / Aadhaar / phone
// into ChecklistResult.message (or any note). So the router restores values only where they are
// grounded:
//
//   "grounded" (default)  object keys are never unmasked; free-text fields (note, message, reason,
//                         question, …) stay masked; every other string — evidence quotes, echoed
//                         ledger names, ids, extracted values — is unmasked only when the restored
//                         text occurs in the documents the caller sent (whitespace / case
//                         insensitive), otherwise it stays masked and fails the caller's own
//                         grounding check like any invented value.
//   "all"                 every string value is unmasked (keys are not). For callers whose output
//                         is a rewrite of their input checked fact by fact (comms polish /
//                         translate: validatePolish rejects any PAN or unknown placeholder).
//
// Pure: no I/O.
import { hasToken, unmask, type TokenMap } from "./anonymizer";

export type UnmaskMode = "grounded" | "all";

/** Free-text output fields: never unmasked in "grounded" mode. */
export const FREE_TEXT_KEYS: ReadonlySet<string> = new Set([
  "note",
  "notes",
  "message",
  "reason",
  "question",
  "comment",
  "comments",
  "explanation",
  "rationale",
  "summary",
  "remarks",
  "hint",
  "advice",
]);

const normalise = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export interface UnmaskOptions {
  mode: UnmaskMode;
  /** The documents the caller sent (unmasked user / assistant messages): what "grounded" means. */
  source: string;
}

/** Restore placeholders in a model answer according to the policy above. */
export function unmaskOutput<T>(value: T, map: TokenMap, opts: UnmaskOptions): T {
  const source = opts.mode === "grounded" ? normalise(opts.source) : "";
  const walk = (v: unknown, key: string | null): unknown => {
    if (typeof v === "string") {
      if (!hasToken(v)) return v;
      if (opts.mode === "all") return unmask(v, map);
      if (key !== null && FREE_TEXT_KEYS.has(key.toLowerCase())) return v;
      const restored = unmask(v, map);
      return restored !== v && source.includes(normalise(restored)) ? restored : v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value, null) as T;
}
