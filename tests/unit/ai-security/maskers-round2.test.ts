// Re-audit NEW-15 (LOW): four identifier shapes from the round-2 PoC (ai-anonymizer-round2.test.ts)
// that mask() and the leak gate both let through: a passport after "PP No", a date of birth after a
// Hindi label, a DIN further than 12 characters after its long label, and an address line with a PIN
// but no door number (only the PIN was masked). Each is now masked, and the gate sees the first three.
import { describe, expect, it } from "vitest";
import { detectPii, mask } from "@/lib/ai/anonymizer";

const NOW = new Date("2026-11-06T00:00:00Z");

describe("NEW-15: passport, Hindi DOB, far DIN, address line", () => {
  it.each([
    ["passport after 'PP No'", "PP No Z1234567", ["Z1234567"], "PASSPORT"],
    ["DOB after the Hindi label", "जन्म तिथि: 15/08/2015", ["15/08/2015"], "DOB"],
    ["DOB after the Kannada label", "ಜನ್ಮ ದಿನಾಂಕ: 15/08/2015", ["15/08/2015"], "DOB"],
    ["DIN 20+ characters after its label", "Director Identification Number of the person: 01234567", ["01234567"], "DIN"],
    ["address line with a PIN and no door number", "4th Cross, Jayanagar, Bengaluru - 560041", ["Jayanagar", "4th Cross", "560041"], null],
    ["labelled address line", "Address: 4th Cross, Jayanagar, Bengaluru 560041", ["Jayanagar", "560041"], null],
  ] as const)("%s", (_n, text, secrets, gateKind) => {
    const { masked } = mask(text, { now: NOW });
    for (const s of secrets) expect(masked, `${s} in ${masked}`).not.toContain(s);
    if (gateKind) expect(detectPii(text)).toContain(gateKind); // the independent gate catches it unmasked
    expect(detectPii(masked)).toEqual([]);
  });

  it("the label itself stays readable, and ordinary text with a PIN-like number is left alone", () => {
    expect(mask("Address: 4th Cross, Jayanagar, Bengaluru 560041", { now: NOW }).masked).toBe("Address: ⟨ADDRESS_1⟩");
    expect(mask("Invoice 560041 dated 1 Oct", { now: NOW }).masked).toBe("Invoice 560041 dated 1 Oct");
    expect(mask("PIN code: 560 038", { now: NOW }).masked).toBe("PIN code: ⟨PIN_1⟩");
    expect(mask("batch 01234567", { now: NOW }).masked).toBe("batch 01234567");
    expect(mask("PP size photo, 2 copies", { now: NOW }).masked).toBe("PP size photo, 2 copies");
  });
});
