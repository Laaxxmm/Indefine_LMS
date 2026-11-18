// PAN / Aadhaar in message bodies (Phase 10, ADR-006): left out unless the client asked, then
// masked to the last 4; nothing else of the number leaks; GSTINs and recorded ack refs are kept.
import { describe, expect, it } from "vitest";
import { verhoeffCheckDigit } from "@/lib/ai/anonymizer";
import { WITHHELD, findIdentifiers, maskLast4, protectIdentifiers } from "./pii";

const AADHAAR_11 = "23456789012";
const AADHAAR = AADHAAR_11 + verhoeffCheckDigit(AADHAAR_11);
const grouped = (d: string) => `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}`;

/** No run of 5+ characters of the original identifier survives (only the last 4 may). */
function leaks(original: string, text: string): boolean {
  const v = original.replace(/[\s-]/g, "");
  const flat = text.replace(/[\s-]/g, "");
  for (let i = 0; i + 5 <= v.length; i++) if (flat.includes(v.slice(i, i + 5))) return true;
  return false;
}

describe("maskLast4", () => {
  it("PAN keeps the last 4 characters; Aadhaar keeps the last 4 digits", () => {
    expect(maskLast4("PAN", "ABCDE1234F")).toBe("XXXXXX234F");
    expect(maskLast4("PAN", "abcde1234f")).toBe("XXXXXX234F");
    expect(maskLast4("AADHAAR", grouped(AADHAAR))).toBe(`XXXX XXXX ${AADHAAR.slice(-4)}`);
    expect(maskLast4("AADHAAR", AADHAAR)).toBe(`XXXX XXXX ${AADHAAR.slice(-4)}`);
  });
});

describe("protectIdentifiers", () => {
  const text = `Your PAN ABCDE1234F and Aadhaar ${grouped(AADHAAR)} are on file; plain ${AADHAAR} too.`;

  it("not requested: both are left out entirely", () => {
    const r = protectIdentifiers(text, { clientRequested: false });
    expect(r.text).toBe(`Your PAN ${WITHHELD.PAN} and Aadhaar ${WITHHELD.AADHAAR} are on file; plain ${WITHHELD.AADHAAR} too.`);
    expect(r.found.map((f) => f.kind)).toEqual(["PAN", "AADHAAR", "AADHAAR"]);
    expect(leaks("ABCDE1234F", r.text) || leaks(AADHAAR, r.text)).toBe(false);
    expect(r.text).not.toContain("234F");
  });

  it("requested by the client: masked to the last 4, nothing else of the number leaks", () => {
    const r = protectIdentifiers(text, { clientRequested: true });
    expect(r.text).toContain("XXXXXX234F");
    expect(r.text).toContain(`XXXX XXXX ${AADHAAR.slice(-4)}`);
    expect(leaks("ABCDE1234F", r.text)).toBe(false);
    expect(leaks(AADHAAR, r.text)).toBe(false);
  });

  it("is idempotent: a masked number is not masked again", () => {
    const once = protectIdentifiers(text, { clientRequested: true }).text;
    expect(protectIdentifiers(once, { clientRequested: true })).toEqual({ text: once, found: [] });
  });

  it("keeps a GSTIN (and the PAN inside it), and the recorded ack ref", () => {
    const t = `GSTIN 29ABCDE1234F1Z5 filed; acknowledgement ${AADHAAR}.`;
    const r = protectIdentifiers(t, { clientRequested: false, keep: [AADHAAR] });
    expect(r.text).toBe(t);
    expect(findIdentifiers(t)).toHaveLength(1); // without `keep`, a 12-digit Verhoeff-valid number reads as Aadhaar
  });

  it("a 12-digit number is Aadhaar only when Verhoeff-valid, grouped 4-4-4, or labelled", () => {
    const bad = AADHAAR.slice(0, 11) + ((Number(AADHAAR[11]) + 1) % 10);
    expect(findIdentifiers(`ref ${bad}`)).toEqual([]);
    expect(findIdentifiers(`Aadhaar no. ${bad}`).map((f) => f.kind)).toEqual(["AADHAAR"]);
    expect(findIdentifiers(`ref ${grouped(bad)}`).map((f) => f.kind)).toEqual(["AADHAAR"]);
  });

  it("text without identifiers is returned unchanged", () => {
    expect(protectIdentifiers("Please send the bank statement for October 2026.", { clientRequested: false })).toEqual({ text: "Please send the bank statement for October 2026.", found: [] });
  });
});
