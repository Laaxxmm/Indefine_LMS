// Replacing one data principal's identifiers inside free text and JSON columns, in place, for
// erasure (erasure.ts walks inventory.ts RESIDUE_DATASETS with it). Pure module: no I/O.
//
//   needles   the person's own values, read from the client master before anything changes:
//               id     PAN (also inside a GSTIN), GSTIN, CIN / LLPIN, email, phone (any spacing)
//               name   client name, folder name, contact name (whole words, any case)
//               part   city and the parts of a person's name ("Kiran Kumar" → Kiran, Kumar)
//             Only "id" needles are used to FIND rows that are not linked to the person (an
//             onboarding that never reached a client record); names and parts only clean rows
//             already linked to the person, so a shared name never pulls in someone else's data.
//   scrub     every needle becomes "[erased]". Numbers, booleans, null, row ids and the JSON shape
//             stay, so figures still add up and audit rows keep their structure.
//
// Matching is exact (case-insensitive, whole words), not fuzzy: a nickname or a misspelling is not
// found. Write-time masking (src/lib/corrections/mask.ts scrubFreeText) keeps new notes clean.
import type { Row } from "./inventory";

export const ERASED_TOKEN = "[erased]";

export type NeedleKind = "id" | "name" | "part";

export interface Needle {
  re: RegExp;
  kind: NeedleKind;
}

export interface Scrubber {
  readonly needles: readonly Needle[];
  /** True when a needle (of the given kinds; default all) occurs in the value: strings and keys, any depth. */
  hits(value: unknown, kinds?: readonly NeedleKind[]): boolean;
  /** The text with every needle replaced by "[erased]". */
  text(value: string): string;
  /** A JSON value with every needle replaced in its strings and keys; everything else unchanged. */
  json<T>(value: T): T;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * JSON properties that hold record ids, idempotency keys and hashes written by code, never typed
 * text: kept exactly, so lookups (TuriaSync evidence.key), links (runId, jobTaskId) and integrity
 * checks (sha256) still work after an erasure.
 */
const STRUCTURAL_KEY = /^(?:id|ids|key|sha256|hash|fingerprint|dedupeKey)$|Ids?$/;
const WORD_START = "(?<![\\p{L}\\p{N}])";
const WORD_END = "(?![\\p{L}\\p{N}])";

/** A name or phrase as whole words, any whitespace between them, any case. Null when too short to be safe. */
export function phraseNeedle(value: unknown, kind: "name" | "part"): Needle | null {
  const words = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length || words.join(" ").length < 3) return null;
  return { re: new RegExp(`${WORD_START}${words.map(escapeRe).join("\\s+")}${WORD_END}`, "giu"), kind };
}

/** A code (GSTIN, CIN, email) exactly, any case, not inside a longer code. */
export function codeNeedle(value: unknown): Needle | null {
  const v = String(value ?? "").trim();
  if (v.length < 5) return null;
  return { re: new RegExp(`(?<![A-Za-z0-9._%+-])${escapeRe(v)}(?![A-Za-z0-9])`, "gi"), kind: "id" };
}

/** A PAN, any case, also where it sits inside a GSTIN (29ABCPK1234F1Z5 holds the PAN ABCPK1234F). */
export function panNeedle(value: unknown): Needle | null {
  const v = String(value ?? "").trim();
  if (!/^[A-Za-z]{5}\d{4}[A-Za-z]$/.test(v)) return codeNeedle(v);
  return { re: new RegExp(`(?<![A-Za-z])${escapeRe(v)}(?![A-Za-z])`, "gi"), kind: "id" };
}

/** The last ten digits of a phone number, with any spaces or dashes between the digits. */
export function phoneNeedle(value: unknown): Needle | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return { re: new RegExp(`(?<!\\d)${digits.slice(-10).split("").join("[\\s-]?")}(?!\\d)`, "g"), kind: "id" };
}

/** The parts (three letters or more) of a name of two words or more: "Kiran Kumar" → Kiran, Kumar. */
export function namePartNeedles(value: unknown): Needle[] {
  const words = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return []; // a one-word name is already a "name" needle
  return words
    .filter((w) => /^\p{L}{3,}$/u.test(w))
    .map((p) => phraseNeedle(p, "part"))
    .filter((n): n is Needle => n !== null);
}

const PERSON_ENTITIES: ReadonlySet<string> = new Set(["INDIVIDUAL"]);

/** A value that has not been erased already ("[erased] c-1", "erased+u-1@erased.invalid" are not needles). */
const live = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s && !s.startsWith(ERASED_TOKEN) && !s.endsWith("@erased.invalid") ? s : null;
};

/** Needles for an LMS client row (read before the erasure changes it). */
export function clientNeedles(client: Row): Needle[] {
  const v = (k: string) => live(client[k]);
  const person = PERSON_ENTITIES.has(String(client.entityType ?? ""));
  const list: (Needle | null)[] = [
    v("pan") ? panNeedle(v("pan")) : null,
    v("gstin") ? codeNeedle(v("gstin")) : null,
    v("cin") ? codeNeedle(v("cin")) : null,
    v("contactEmail") ? codeNeedle(v("contactEmail")) : null,
    v("contactPhone") ? phoneNeedle(v("contactPhone")) : null,
    v("name") ? phraseNeedle(v("name"), "name") : null,
    v("folderName") ? phraseNeedle(v("folderName"), "name") : null,
    v("contactName") ? phraseNeedle(v("contactName"), "name") : null,
    v("city") ? phraseNeedle(v("city"), "part") : null,
    ...namePartNeedles(v("contactName")),
    ...(person ? namePartNeedles(v("name")) : []),
  ];
  return list.filter((n): n is Needle => n !== null);
}

export function scrubberFor(needles: readonly Needle[]): Scrubber {
  const test = (s: string, kinds?: readonly NeedleKind[]) =>
    needles.some((n) => {
      if (kinds && !kinds.includes(n.kind)) return false;
      n.re.lastIndex = 0;
      return n.re.test(s);
    });
  const text = (s: string) => {
    let out = s;
    // Identifiers first, then whole names, then name parts: a longer match is never split.
    for (const kind of ["id", "name", "part"] as const) for (const n of needles) if (n.kind === kind) out = out.replace(n.re, ERASED_TOKEN);
    return out;
  };
  const hits = (value: unknown, kinds?: readonly NeedleKind[]): boolean => {
    if (typeof value === "string") return test(value, kinds);
    if (Array.isArray(value)) return value.some((x) => hits(x, kinds));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      return Object.entries(value as Row).some(([k, x]) => test(k, kinds) || (!STRUCTURAL_KEY.test(k) && hits(x, kinds)));
    }
    return false;
  };
  const json = <T>(value: T): T => {
    if (typeof value === "string") return text(value) as T;
    if (Array.isArray(value)) return value.map((x) => json(x)) as T;
    if (value && typeof value === "object" && !(value instanceof Date)) {
      // Keys that hold no needle keep their name; a renamed key that would clash gets " (2)", " (3)" …
      const entries = Object.entries(value as Row);
      const out: Row = {};
      for (const [k, x] of entries) if (text(k) === k) out[k] = STRUCTURAL_KEY.test(k) ? x : json(x);
      for (const [k, x] of entries) {
        if (text(k) === k) continue;
        let key = text(k);
        for (let i = 2; key in out; i++) key = `${text(k)} (${i})`;
        out[key] = json(x);
      }
      return out as T;
    }
    return value;
  };
  return { needles, hits, text, json };
}

/** The scrubbed values of the columns that hold a needle; an empty object when nothing changes. */
export function scrubColumns(row: Row, columns: readonly string[], s: Scrubber): Row {
  const out: Row = {};
  for (const c of columns) {
    const v = row[c];
    if (v === null || v === undefined || !s.hits(v)) continue;
    out[c] = typeof v === "string" ? s.text(v) : s.json(v);
  }
  return out;
}
