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
//   "findings"            for answers that are STORED as findings (LLM checklist verdicts →
//                         ChecklistResult, kept with the run). Re-audit NEW-7: under "grounded" a
//                         lone placeholder in evidence.quote was restored ("the value is in the
//                         documents" by definition), so an injected document could have the job's
//                         PAN / Aadhaar / phone written into a stored row. Here identifier tokens
//                         (PAN, Aadhaar, phone, e-mail, bank account, UPI, date of birth, passport,
//                         voter ID, vehicle registration) are never restored, under any key; other tokens (names,
//                         organisations, GSTIN …) are restored only when the whole restored string
//                         is a whole line or cell of the documents AND has at least
//                         FINDING_MIN_LITERAL characters besides its placeholders. Free-text keys
//                         stay masked. The checklist engine accepts a quote whose identifiers are
//                         still placeholders when the rest of it is in the documents
//                         (quoteInContext), so a verdict stays usable without storing the value.
//
// Pure: no I/O.
import { hasToken, unmask, type TokenMap } from "./anonymizer";

export type UnmaskMode = "grounded" | "all" | "findings";

/** Token kinds a stored finding never gets back (findings mode). */
export const IDENTIFIER_TOKEN_KINDS: ReadonlySet<string> = new Set(["PAN", "AADHAAR", "PHONE", "EMAIL", "BANK_AC", "UPI", "DOB", "PASSPORT", "VOTER_ID", "VEHICLE"]);

/** Characters a stored quote must have besides its placeholders before names in it are restored. */
export const FINDING_MIN_LITERAL = 12;

const TOKEN = /⟨([A-Z]+(?:_[A-Z]+)*)_\d+⟩/g;
const kindOf = (token: string) => token.slice(1, token.lastIndexOf("_"));

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

/**
 * The documents as whole units: every line, the line without a "<file> row 3: " / "line 3: " lead,
 * and every cell (split on | , ; and tabs), normalised. A stored quote must be one of these.
 */
export function documentUnits(source: string): Set<string> {
  const units = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    const l = normalise(line);
    if (!l) continue;
    units.add(l);
    const lead = /^[^:]{1,80}?(?:row|line|page|item)\s*\d+\s*:\s*(.+)$/i.exec(line);
    if (lead) units.add(normalise(lead[1]));
    for (const cell of line.split(/\s*[|,;\t]\s*/)) {
      const c = normalise(cell.replace(/^"|"$/g, ""));
      if (c) units.add(c);
    }
  }
  return units;
}

/** Restore placeholders in a model answer according to the policy above. */
export function unmaskOutput<T>(value: T, map: TokenMap, opts: UnmaskOptions): T {
  const source = opts.mode === "grounded" ? normalise(opts.source) : "";
  let units: Set<string> | null = null;
  const finding = (v: string): string => {
    const literal = normalise(v.replace(TOKEN, ""));
    if (literal.length < FINDING_MIN_LITERAL) return v;
    units ??= documentUnits(opts.source);
    if (!units.has(normalise(unmask(v, map)))) return v;
    // Names come back; identifiers stay placeholders.
    return v.replace(TOKEN, (t) => (IDENTIFIER_TOKEN_KINDS.has(kindOf(t)) ? t : (map.byToken.get(t) ?? t)));
  };
  const walk = (v: unknown, key: string | null): unknown => {
    if (typeof v === "string") {
      if (!hasToken(v)) return v;
      if (opts.mode === "all") return unmask(v, map);
      if (key !== null && FREE_TEXT_KEYS.has(key.toLowerCase())) return v;
      if (opts.mode === "findings") return finding(v);
      const restored = unmask(v, map);
      return restored !== v && source.includes(normalise(restored)) ? restored : v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, key));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value, null) as T;
}
