// Security round 3 residue: two identifier shapes that mask() and the leak gate both let through —
// an Aadhaar shown by its last four digits ("XXXX XXXX 1234", "Aadhaar ending 1234") and an Indian
// vehicle registration mark ("KA 01 AB 1234", Bharat series "22 BH 1234 AA"). Both identify a person
// (ADR-006 class A). Each is now masked (⟨AADHAAR_n⟩, ⟨VEHICLE_n⟩), the gate sees each unmasked, and
// ordinary register text — GSTIN, CIN, HSN / SAC codes, invoice numbers, amounts, dates — is left
// alone. Synthetic values only.
import { describe, expect, it } from "vitest";
import { detectPii, gstinCheckChar, mask, unmask } from "@/lib/ai/anonymizer";
import { IDENTIFIER_TOKEN_KINDS } from "@/lib/ai/unmask-policy";
import { rng } from "@/lib/ai/__tests__/synthetic";

const NOW = new Date("2026-11-06T00:00:00Z");
const m = (t: string) => mask(t, { now: NOW });

describe("Aadhaar last-4 forms", () => {
  it.each([
    ["masked groups with spaces", "Aadhaar XXXX XXXX 1234 verified", "1234"],
    ["masked groups with hyphens, lower case", "KYC: xxxx-xxxx-1234", "1234"],
    ["masked run", "UID XXXXXXXX5678 on file", "5678"],
    ["stars", "**** **** 4321 (Aadhaar)", "4321"],
    ["'Aadhaar ending'", "Aadhaar ending 1234", "1234"],
    ["'Aadhaar ending in', misspelt", "Aadhar card ending in 9876", "9876"],
    ["'Aadhaar no. ****'", "Aadhaar no. ****1234", "1234"],
    ["'last 4 digits'", "Aadhaar last 4 digits: 2468", "2468"],
    ["number with masked prefix", "Aadhaar Number XX-1357", "1357"],
  ] as const)("%s", (_n, text, digits) => {
    const { masked, map } = m(text);
    expect(masked, masked).not.toContain(digits);
    expect(masked).toMatch(/⟨AADHAAR_1⟩/);
    expect(unmask(masked, map)).toBe(text); // exact round trip
    expect(detectPii(text)).toContain("AADHAAR"); // the gate catches it unmasked
    expect(detectPii(masked)).toEqual([]);
  });

  it("the label stays readable; a year or an amount near the word Aadhaar is not taken", () => {
    expect(m("Aadhaar ending 1234").masked).toBe("Aadhaar ending ⟨AADHAAR_1⟩");
    expect(m("Aadhaar no. ****1234").masked).toBe("Aadhaar no. ⟨AADHAAR_1⟩");
    for (const t of ["Aadhaar-PAN linking is due by 31 March 2026", "Aadhaar seeded for 2026-27", "Aadhaar update fee Rs 1,250.00", "Aadhaar 1234 5678 9012 is not a valid number"]) {
      expect(m(t).masked, t).not.toMatch(/⟨AADHAAR_\d⟩/);
    }
  });
});

describe("vehicle registration marks", () => {
  it.each([
    ["spaced", "Vehicle KA 01 AB 1234 hired for the site", "KA 01 AB 1234"],
    ["compact", "Fuel for KA01AB1234 (Oct)", "KA01AB1234"],
    ["hyphens", "MH-12-DE-1433 insurance renewal", "MH-12-DE-1433"],
    ["Delhi with category", "Car DL 3C AB 1234, driver allowance", "DL 3C AB 1234"],
    ["single-digit RTO, one-letter series", "TN 9 Z 0007 lease", "TN 9 Z 0007"],
    ["Bharat series", "BH plate 22 BH 1234 AA transferred", "22 BH 1234 AA"],
    ["Bharat series compact", "Reg 23BH5678C", "23BH5678C"],
  ] as const)("%s", (_n, text, plate) => {
    const { masked, map } = m(text);
    expect(masked, masked).not.toContain(plate);
    expect(masked).toMatch(/⟨VEHICLE_1⟩/);
    expect(unmask(masked, map)).toBe(text);
    expect(detectPii(text)).toContain("VEHICLE");
    expect(detectPii(masked)).toEqual([]);
  });

  it("a vehicle registration is an identifier: a stored finding never gets it back", () => {
    expect(IDENTIFIER_TOKEN_KINDS.has("VEHICLE")).toBe(true);
  });
});

describe("no false positives on register text", () => {
  const first14 = "29AAACA1234F1Z";
  const gstin = first14 + gstinCheckChar(first14);
  const ordinary = [
    `GSTIN ${gstin}`,
    "CIN U72200KA2015PTC012345",
    "LLPIN AAB-1234 (LLP)",
    "HSN 8471 30 10, SAC 998314",
    "HSN/SAC: 9983 14",
    "Invoice INV-2026-1234 dated 05-10-2026",
    "Bill No. KA/2026/1234",
    "Taxable value 1,23,456.78 and IGST 22,222.22",
    "Amount ₹ 12,345.00 (Rs 1234)",
    "Period: 31 MAR 2026 to 30 APR 2026",
    "BALANCE AS 31 MAR 2026 CR",
    "As at 31 Mar 2026",
    "Due 2026-11-20; GSTR-3B for Oct 2026",
    "Voucher JV 12 AB 2026", // JV is not a state code
    "Batch UP 12 2026", // no series letters
    "Order ka01ab1234 (lower case is not a registration mark)",
    "Stock code XXL-1234",
    "Ref XXXX-1234", // four masked characters only: not an Aadhaar
  ];
  it.each(ordinary.map((t) => [t]))("%s", (text) => {
    const { masked } = m(text);
    expect(masked, masked).not.toMatch(/⟨(?:VEHICLE|AADHAAR)_\d⟩/);
    expect(detectPii(text).filter((k) => k === "VEHICLE" || k === "AADHAAR")).toEqual([]);
  });
});

describe("synthetic corpus: zero leaks, exact round trip, the gate sees every unmasked value", () => {
  const r = rng(20261106);
  const L = "ABCDEFGHJKLMNPRSTUVWXYZ";
  const STATES = ["KA", "MH", "TN", "DL", "GJ", "UP", "WB", "TS", "KL", "RJ"];
  const d = (n: number) => Array.from({ length: n }, () => String(r.int(0, 9))).join("");
  const letters = (n: number) => Array.from({ length: n }, () => r.pick(L.split(""))).join("");
  const cases: { text: string; secret: string }[] = [];
  for (let i = 0; i < 120; i++) {
    const sep = r.pick([" ", "-", ""]);
    const plate = i % 6 === 5 ? `${r.int(21, 29)}${sep}BH${sep}${d(4)}${sep}${letters(r.int(1, 2))}` : `${r.pick(STATES)}${sep}${String(r.int(1, 99)).padStart(2, "0")}${sep}${letters(r.int(1, 3))}${sep}${d(4)}`;
    const last4 = d(4);
    const aadhaar = r.pick([`XXXX XXXX ${last4}`, `xxxx-xxxx-${last4}`, `XXXXXXXX${last4}`, `Aadhaar ending ${last4}`, `Aadhaar no. ****${last4}`]);
    const text = r.pick([`Vehicle ${plate}; KYC ${aadhaar}`, `${aadhaar} | ${plate} | 1,250.00`, `Driver's Aadhaar: ${aadhaar}, car ${plate}`]);
    cases.push({ text, secret: plate }, { text, secret: last4 });
  }
  it("every plate and every last four is masked and comes back exactly", () => {
    for (const c of cases) {
      const { masked, map } = m(c.text);
      expect(masked, c.text).not.toContain(c.secret);
      expect(unmask(masked, map)).toBe(c.text);
      expect(detectPii(masked), masked).toEqual([]);
      expect(detectPii(c.text).length, c.text).toBeGreaterThan(0);
    }
    expect(cases.length).toBeGreaterThanOrEqual(200);
  });
});
