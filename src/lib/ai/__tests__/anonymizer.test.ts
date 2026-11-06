import { describe, expect, it } from "vitest";
import {
  createTokenMap,
  detectPii,
  gstinCheckChar,
  isPanShape,
  isValidAadhaar,
  isValidGstin,
  mask,
  unmask,
  unmaskDeep,
  verhoeffCheckDigit,
  verhoeffValid,
} from "../anonymizer";
import { gen, rng, syntheticCase } from "./synthetic";

const SYNTHETIC_COUNT = 250;
const digitsOnly = (s: string) => s.replace(/[\s-]/g, "");

describe("validators", () => {
  it("GSTIN check character follows Luhn mod-36", () => {
    expect(gstinCheckChar("00000000000000")).toBe("0");
    expect(gstinCheckChar("10000000000000")).toBe("Z"); // 1 at weight 1 → sum 1 → 35
    expect(gstinCheckChar("01000000000000")).toBe("Y"); // 1 at weight 2 → sum 2 → 34
    expect(gstinCheckChar("0Z000000000000")).toBe("1"); // 35×2=70 → 1+34=35 → 1
    expect(() => gstinCheckChar("0#000000000000")).toThrow();
  });

  it("generated GSTINs validate and any single-character change breaks the checksum", () => {
    const r = rng(7);
    for (let n = 0; n < 50; n++) {
      const g = gen.gstin(r);
      expect(isValidGstin(g)).toBe(true);
      const pos = r.int(2, 13);
      const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const swapped = alphabet[(alphabet.indexOf(g[pos]) + 1) % 36];
      const mutated = g.slice(0, pos) + swapped + g.slice(pos + 1);
      // Mutation may also break the shape; either way it must not validate.
      expect(isValidGstin(mutated)).toBe(false);
    }
    expect(isValidGstin(gen.gstinBadChecksum(r))).toBe(false);
    const g = gen.gstin(r);
    expect(isValidGstin("45" + g.slice(2))).toBe(false); // state code outside the valid set
  });

  it("Verhoeff: textbook vector 236 → 3, and generated Aadhaar numbers validate", () => {
    expect(verhoeffCheckDigit("236")).toBe("3");
    expect(verhoeffValid("2363")).toBe(true);
    expect(verhoeffValid("2364")).toBe(false);
    expect(verhoeffValid("12a")).toBe(false);
    const r = rng(11);
    for (let n = 0; n < 50; n++) expect(isValidAadhaar(gen.aadhaarFormatted(r))).toBe(true);
    expect(isValidAadhaar("123456789012")).toBe(false); // first digit 1
  });

  it("PAN shape", () => {
    expect(isPanShape(gen.pan(rng(1)))).toBe(true);
    expect(isPanShape("ABCD12345E")).toBe(false);
  });
});

describe(`mask(): ${SYNTHETIC_COUNT} synthetic strings, zero leaks, exact round-trip`, () => {
  const r = rng(20261105);
  const cases = Array.from({ length: SYNTHETIC_COUNT }, (_, i) => syntheticCase(r, i));

  it("generator produced the advertised number of strings", () => {
    expect(cases.length).toBeGreaterThanOrEqual(200);
  });

  it("positive control: the leak detector does fire on raw text", () => {
    const g = rng(1);
    const raw = `${gen.pan(g)} ${gen.gstin(g)} ${gen.aadhaar(g)} 9845012345 x@example-firm.in ${gen.tan(g)} ${gen.ifsc(g)} ${gen.cin(g)}`;
    expect(detectPii(raw).sort()).toEqual(["AADHAAR", "CIN", "EMAIL", "GSTIN", "IFSC", "PAN", "PHONE", "TAN"]);
    const flagged = cases.filter((c) => detectPii(c.text).length > 0).length;
    expect(flagged).toBeGreaterThan(cases.length * 0.6);
  });

  it.each(cases.map((c, i) => [i, c] as const))("case %i", (_i, c) => {
    const { masked, map } = mask(c.text, { dictionary: c.dictionary });
    for (const secret of c.secrets) {
      expect(masked).not.toContain(secret);
      if (/^[+\d][\d\s-]{8,}$/.test(secret)) expect(digitsOnly(masked)).not.toContain(digitsOnly(secret).replace(/^\+91/, ""));
    }
    expect(detectPii(masked)).toEqual([]);
    expect(unmask(masked, map)).toBe(c.text);
  });
});

describe("mask(): behaviour", () => {
  it("same value → same token; tokens look like ⟨PAN_1⟩", () => {
    const pan = gen.pan(rng(3));
    const { masked, map } = mask(`${pan} and again ${pan}`);
    expect(masked).toBe("⟨PAN_1⟩ and again ⟨PAN_1⟩");
    expect(map.byToken.get("⟨PAN_1⟩")).toBe(pan);
  });

  it("continues an existing map across messages", () => {
    const r = rng(4);
    const a = gen.pan(r);
    const b = gen.pan(r);
    const map = createTokenMap();
    expect(mask(`PAN ${a}`, { map }).masked).toBe("PAN ⟨PAN_1⟩");
    expect(mask(`PAN ${b} then ${a}`, { map }).masked).toBe("PAN ⟨PAN_2⟩ then ⟨PAN_1⟩");
  });

  it("GSTIN is masked whole (not as an embedded PAN), including bad checksums", () => {
    const r = rng(5);
    expect(mask(`GSTIN ${gen.gstin(r)}`).masked).toBe("GSTIN ⟨GSTIN_1⟩");
    expect(mask(`GSTIN ${gen.gstinBadChecksum(r)}`).masked).toBe("GSTIN ⟨GSTIN_1⟩");
  });

  it("a PAN glued to digits (malformed GSTIN) is still caught", () => {
    const pan = gen.pan(rng(6));
    const { masked } = mask(`ref 29${pan}1Y5`);
    expect(masked).not.toContain(pan);
  });

  it("Aadhaar: checksum-valid bare, grouped invalid (defensive), context invalid; bare invalid out of context survives", () => {
    const valid = gen.aadhaar(rng(8));
    const bad = valid.slice(0, 11) + String((Number(valid[11]) + 1) % 10);
    expect(verhoeffValid(bad)).toBe(false);
    expect(mask(`no ${valid}`).masked).toBe("no ⟨AADHAAR_1⟩");
    expect(mask(`no ${bad.slice(0, 4)} ${bad.slice(4, 8)} ${bad.slice(8)}`).masked).toBe("no ⟨AADHAAR_1⟩");
    expect(mask(`Aadhaar: ${bad}`).masked).toBe("Aadhaar: ⟨AADHAAR_1⟩");
    expect(mask(`E-way bill ${bad}`).masked).toBe(`E-way bill ${bad}`);
  });

  it("phones in common Indian formats", () => {
    for (const p of ["+91 98450 12345", "+91-9845012345", "09845012345", "9845012345", "98450-12345", "984 501 2345", "0091 9845012345"]) {
      expect(mask(`call ${p} today`).masked).toBe("call ⟨PHONE_1⟩ today");
    }
  });

  it("context-only identifiers: DIN, DOB, PIN, LLPIN, bank account", () => {
    expect(mask("DIN 01234567").masked).toBe("DIN ⟨DIN_1⟩");
    expect(mask("batch 01234567").masked).toBe("batch 01234567");
    expect(mask("DOB: 04/07/1988").masked).toBe("DOB: ⟨DOB_1⟩");
    expect(mask("Date of birth 4 July 1988").masked).toBe("Date of birth ⟨DOB_1⟩");
    expect(mask("Born on July 4, 1988").masked).toBe("Born on ⟨DOB_1⟩");
    expect(mask("Invoice dated 04/07/2026").masked).toBe("Invoice dated 04/07/2026");
    expect(mask("Kestrel Nagar, Bengaluru 560999").masked).toBe("⟨ADDRESS_1⟩"); // re-audit NEW-15: the whole address line, not just the PIN
    expect(mask("PIN code: 560 038").masked).toBe("PIN code: ⟨PIN_1⟩");
    expect(mask("LLPIN AAB-1234").masked).toBe("LLPIN ⟨LLPIN_1⟩");
    expect(mask("A/c no. 50100123456789").masked).toBe("A/c no. ⟨BANK_AC_1⟩");
    expect(mask("Bank account 0012 3456 7890 12").masked).toBe("Bank account ⟨BANK_AC_1⟩");
  });

  it("IFSC, TAN, CIN, e-mail, lowercase PAN", () => {
    expect(mask("IFSC ZXCV0001234").masked).toBe("IFSC ⟨IFSC_1⟩");
    expect(mask("TAN BLRA12345B").masked).toBe("TAN ⟨TAN_1⟩");
    expect(mask("CIN U72200KA2015PTC012345").masked).toBe("CIN ⟨CIN_1⟩");
    expect(mask("mail a.b+c@example-firm.co.in now").masked).toBe("mail ⟨EMAIL_1⟩ now");
    expect(mask("pan abcpe1234f").masked).toBe("pan ⟨PAN_1⟩");
  });

  it("dictionary: case-insensitive, longest-first, flexible whitespace, keeps original casing on unmask", () => {
    const dictionary = [
      { value: "Zentrix", kind: "ORG" as const },
      { value: "Zentrix Traders Private Limited", kind: "ORG" as const },
      { value: "Ilsha Mandravel", kind: "NAME" as const },
    ];
    const text = "ZENTRIX TRADERS  PRIVATE LIMITED (ilsha mandravel) vs Zentrix";
    const { masked, map } = mask(text, { dictionary });
    expect(masked).toBe("⟨ORG_1⟩ (⟨NAME_1⟩) vs ⟨ORG_2⟩");
    expect(unmask(masked, map)).toBe(text);
  });

  it("dictionary never rewrites existing tokens and ignores 1-char entries", () => {
    const pan = gen.pan(rng(9));
    const map = createTokenMap();
    const first = mask(`id ${pan}`, { map }).masked;
    expect(first).toBe("id ⟨PAN_1⟩");
    const dictionary = [
      { value: "Pan", kind: "NAME" as const },
      { value: "a", kind: "NAME" as const },
    ];
    const { masked } = mask(`${first} belongs to Pan, a client`, { map, dictionary });
    expect(masked).toBe("id ⟨PAN_1⟩ belongs to ⟨NAME_1⟩, a client");
    expect(unmask(masked, map)).toBe(`id ${pan} belongs to Pan, a client`);
  });

  it("an ADDRESS token counts as address context for a following PIN", () => {
    const { masked } = mask("Ship to 12 Elm Row - 400001", { dictionary: [{ value: "12 Elm Row", kind: "ADDRESS" }] });
    expect(masked).toBe("Ship to ⟨ADDRESS_1⟩ - ⟨PIN_1⟩");
  });
});

describe("false positives: business data must survive", () => {
  const r = rng(99);
  const goodBad = gen.aadhaar(r);
  const ewb = goodBad.slice(0, 11) + String((Number(goodBad[11]) + 1) % 10);
  const keep = [
    "Invoice INV-2026-0042 dated 12/03/2026 for ₹1,23,456.00",
    "HSN 998314 and HSN 8471 at 18% GST",
    "SAC 9983; 8-digit HSN 84713010 for laptops",
    `E-way bill ${ewb} generated`,
    "Bill SI/25-26/1043 due 20 Nov 2026",
    "Total taxable value 7,50,000.00; IGST 1,35,000.00; CGST 67,500.50",
    "Return period 2026-10, filed on 2026-11-11, ARN pending",
    "Quantity 1200 units at 450.50 each, order 4500012345",
    "FY 2025-26 Q2 advance tax 15 Sep 2025",
    "Amount 98,76,54,321.00 reconciled with 2B",
  ];
  it.each(keep)("%s", (text) => {
    expect(verhoeffValid(ewb)).toBe(false);
    expect(mask(text).masked).toBe(text);
  });
});

describe("unmask", () => {
  it("leaves unknown tokens alone", () => {
    expect(unmask("x ⟨PAN_9⟩", createTokenMap())).toBe("x ⟨PAN_9⟩");
  });
  it("unmaskDeep walks objects, arrays and keys", () => {
    const { masked, map } = mask("PAN ABCPE1234F");
    const token = masked.slice(4);
    const out = unmaskDeep({ a: [token, 3, null, { [token]: true }], b: `id ${token}` }, map);
    expect(out).toEqual({ a: ["ABCPE1234F", 3, null, { ABCPE1234F: true }], b: "id ABCPE1234F" });
  });
});
