// Identity numbers in client message bodies (Phase 10, ADR-006): no PAN or Aadhaar in a message
// unless the client asked for it, and then masked to the last 4 characters. Applied to every
// staff-written input before drafting and to the finished English and translated text. A GSTIN
// (a public business registration) is kept; the PAN inside it is not treated as a separate PAN.
// Values the human recorded as facts of the message (the ack ref) are never touched. Pure.
import { PATTERNS, verhoeffValid } from "@/lib/ai/anonymizer";

export type IdKind = "PAN" | "AADHAAR";
export type FoundId = { kind: IdKind; start: number; end: number; value: string };

/** "ABCDE1234F" → "XXXXXX234F"; "2345 6789 0123" → "XXXX XXXX 0123". Only the last 4 characters survive. */
export function maskLast4(kind: IdKind, value: string): string {
  if (kind === "PAN") {
    const v = value.replace(/\s+/g, "").toUpperCase();
    return `${"X".repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`;
  }
  const digits = value.replace(/\D/g, "");
  return `XXXX XXXX ${digits.slice(-4)}`;
}

export const WITHHELD: Readonly<Record<IdKind, string>> = Object.freeze({ PAN: "[PAN not included]", AADHAAR: "[Aadhaar not included]" });

const AADHAAR_CONTEXT = /\b(?:aadh?aa?r|uid|uidai)\b/i;

/** PANs and Aadhaar numbers in `text`, outside GSTINs and outside the `keep` values. */
export function findIdentifiers(text: string, keep: readonly string[] = []): FoundId[] {
  const blocked: [number, number][] = [];
  const block = (s: number, e: number) => blocked.push([s, e]);
  for (const m of text.matchAll(new RegExp(PATTERNS.GSTIN.source, "g"))) block(m.index ?? 0, (m.index ?? 0) + m[0].length);
  for (const k of keep) {
    const v = k.trim();
    if (!v) continue;
    for (let i = text.indexOf(v); i >= 0; i = text.indexOf(v, i + v.length)) block(i, i + v.length);
  }
  const free = (s: number, e: number) => blocked.every(([a, b]) => e <= a || s >= b);
  const out: FoundId[] = [];
  for (const m of text.matchAll(new RegExp(PATTERNS.PAN.source, "g"))) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (free(s, e)) out.push({ kind: "PAN", start: s, end: e, value: m[0] });
  }
  for (const m of text.matchAll(new RegExp(PATTERNS.AADHAAR.source, "g"))) {
    const s = m.index ?? 0;
    const e = s + m[0].length;
    if (!free(s, e)) continue;
    const digits = m[0].replace(/[\s-]/g, "");
    const before = text.slice(Math.max(0, s - 40), s);
    if (verhoeffValid(digits) || Boolean(m[1]) || AADHAAR_CONTEXT.test(before)) out.push({ kind: "AADHAAR", start: s, end: e, value: m[0] });
  }
  return out.sort((a, b) => a.start - b.start);
}

export type Protected = { text: string; found: { kind: IdKind; replacement: string }[] };

/**
 * Replace every PAN / Aadhaar: masked to the last 4 when the client asked for it in this message,
 * otherwise left out ("[PAN not included]"). `keep`: fact values to leave alone (the ack ref).
 */
export function protectIdentifiers(text: string, opts: { clientRequested: boolean; keep?: readonly string[] }): Protected {
  const ids = findIdentifiers(text, opts.keep ?? []);
  if (!ids.length) return { text, found: [] };
  let out = "";
  let last = 0;
  const found: Protected["found"] = [];
  for (const id of ids) {
    const replacement = opts.clientRequested ? maskLast4(id.kind, id.value) : WITHHELD[id.kind];
    out += text.slice(last, id.start) + replacement;
    last = id.end;
    found.push({ kind: id.kind, replacement });
  }
  return { text: out + text.slice(last), found };
}
