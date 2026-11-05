// Security finding #3 / #26 (audit PoC 01): the anonymizer was defeated by ordinary formatting —
// 25 of these 50 formats reached the cloud unmasked (spaced / dotted / zero-width / fullwidth /
// look-alike PANs, Aadhaar in a longer run, unlabelled bank accounts, UPI handles, unlabelled
// dates of birth, names outside the dictionary…). Every value below is synthetic.
import { describe, expect, it } from "vitest";
import { createTokenMap, detectPii, mask, unmask, verhoeffCheckDigit, type PiiKind } from "@/lib/ai/anonymizer";

const aadhaarValid = (() => {
  const first11 = "23456789012";
  return first11 + verhoeffCheckDigit(first11);
})();
const a4 = (s: string, sep: string) => `${s.slice(0, 4)}${sep}${s.slice(4, 8)}${sep}${s.slice(8)}`;
const NOW = new Date("2026-11-06T00:00:00Z");

type Case = { name: string; text: string; leak: string; dictionary?: { value: string; kind: "NAME" | "ORG" | "ADDRESS" }[] };

export const ADVERSARIAL_CASES: Case[] = [
  // ---- PAN variants
  { name: "PAN with spaces 'ABCDE 1234 F'", text: "PAN of assessee: ABCDE 1234 F per form", leak: "ABCDE 1234 F" },
  { name: "PAN with dots 'ABCDE.1234.F'", text: "PAN ABCDE.1234.F", leak: "ABCDE.1234.F" },
  { name: "lowercase PAN", text: "pan abcde1234f on invoice", leak: "abcde1234f" },
  { name: "PAN with U+200B zero-width space", text: "PAN ABCDE​1234F", leak: "ABCDE​1234F" },
  { name: "PAN with U+200C ZWNJ", text: "PAN ABC‌DE1234F", leak: "ABC‌DE1234F" },
  { name: "PAN with U+FEFF BOM char", text: "PAN ABCDE1234﻿F", leak: "ABCDE1234﻿F" },
  { name: "PAN in fullwidth chars", text: "PAN ＡＢＣＤＥ１２３４Ｆ", leak: "ＡＢＣＤＥ１２３４Ｆ" },
  { name: "PAN with Cyrillic look-alikes (А В С)", text: "PAN АВСDE1234F", leak: "АВСDE1234F" },
  { name: "PAN in JSON value", text: '{"pan":"ABCDE1234F","name":"x"}', leak: "ABCDE1234F" },
  { name: "PAN in CSV cell", text: "row,ABCDE1234F,500.00", leak: "ABCDE1234F" },
  { name: "PAN in file name", text: "attached ABCDE1234F_bank_statement.pdf", leak: "ABCDE1234F" },
  { name: "PAN glued to a word (ABCDE1234Fbank.pdf)", text: "file ABCDE1234Fbank.pdf", leak: "ABCDE1234F" },
  { name: "PAN-card / Form 16 layout, one character per box", text: "PAN A B C D E 1 2 3 4 F", leak: "1 2 3 4" },
  // ---- Aadhaar
  { name: "Aadhaar with dashes", text: `Aadhaar ${a4(aadhaarValid, "-")}`, leak: a4(aadhaarValid, "-") },
  { name: "Aadhaar with spaces", text: `UID ${a4(aadhaarValid, " ")}`, leak: a4(aadhaarValid, " ") },
  { name: "Aadhaar bare 12 digits, no context", text: `ref ${aadhaarValid} ok`, leak: aadhaarValid },
  { name: "Aadhaar inside a longer digit run", text: `ref 99${aadhaarValid}77`, leak: aadhaarValid },
  { name: "Aadhaar with dot separators", text: `Aadhaar ${a4(aadhaarValid, ".")}`, leak: a4(aadhaarValid, ".") },
  // ---- phones
  { name: "phone '+91 98765 43210'", text: "call +91 98765 43210 now", leak: "98765 43210" },
  { name: "phone '0 98765-43210'", text: "call 0 98765-43210 now", leak: "98765-43210" },
  { name: "phone '98765 43210'", text: "call 98765 43210 now", leak: "98765 43210" },
  { name: "phone '9876543210' inside text", text: "mob:9876543210,ok", leak: "9876543210" },
  { name: "phone with dots '98765.43210'", text: "mob 98765.43210", leak: "98765.43210" },
  { name: "phone with parentheses '(+91) 98765 43210'", text: "(+91) 98765 43210", leak: "98765 43210" },
  // ---- email
  { name: "email plus-addressing uppercase", text: "mail First.Last+tag@Example.COM", leak: "First.Last+tag@Example.COM" },
  { name: "email split by zero-width space", text: "mail first​.last@example.com", leak: "last@example.com" },
  { name: "email with ' at ' / ' dot ' obfuscation", text: "mail first.last at example dot com", leak: "first.last at example dot com" },
  { name: "UPI VPA (no TLD) 'rajesh.k@okhdfcbank'", text: "UPI/P2A/rajesh.k@okhdfcbank/NEFT", leak: "rajesh.k@okhdfcbank" },
  // ---- dictionary names
  { name: "dictionary name split across newline", text: "Signed by Rajesh\nKumar on behalf", leak: "Rajesh\nKumar", dictionary: [{ value: "Rajesh Kumar", kind: "NAME" }] },
  { name: "dictionary name extra whitespace + case", text: "signed by RAJESH    kumar", leak: "RAJESH    kumar", dictionary: [{ value: "Rajesh Kumar", kind: "NAME" }] },
  { name: "dictionary name possessive", text: "Rajesh Kumar's account", leak: "Rajesh Kumar", dictionary: [{ value: "Rajesh Kumar", kind: "NAME" }] },
  { name: "dictionary name as 'Kumar, Rajesh'", text: "Kumar, Rajesh", leak: "Kumar, Rajesh", dictionary: [{ value: "Rajesh Kumar", kind: "NAME" }] },
  { name: "dictionary name: first name alone (dictionary has full name only)", text: "Ask Rajesh to sign", leak: "Rajesh", dictionary: [{ value: "Rajesh Kumar", kind: "NAME" }] },
  { name: "dictionary ORG with zero-width space inside", text: "Acme​ Widgets Pvt Ltd", leak: "Widgets Pvt Ltd", dictionary: [{ value: "Acme Widgets Pvt Ltd", kind: "ORG" }] },
  { name: "person name NOT in dictionary (bank narration)", text: "NEFT-RAJESH KUMAR SHARMA-SAL OCT", leak: "RAJESH KUMAR SHARMA" },
  // ---- GSTIN / IFSC / bank
  { name: "GSTIN lowercase", text: "gstin 29abcde1234f1z5", leak: "29abcde1234f1z5" },
  { name: "IFSC + account split by newline", text: "IFSC: HDFC0001234\nAccount: 50100123456789", leak: "50100123456789" },
  { name: "bank account alone, no IFSC, no context word", text: "credited to 50100123456789 on 3rd", leak: "50100123456789" },
  { name: "bank account with 'A/c' 60 chars earlier (context window 50)", text: "A/c details are given below for the refund that is due:\n50100123456789", leak: "50100123456789" },
  { name: "IFSC lowercase", text: "ifsc hdfc0001234", leak: "hdfc0001234" },
  // ---- DOB
  { name: "DOB 01/01/1990 with label", text: "DOB: 01/01/1990", leak: "01/01/1990" },
  { name: "DOB '1 Jan 1990' with label", text: "Date of birth 1 Jan 1990", leak: "1 Jan 1990" },
  { name: "DOB 1990-01-01 with 'born on'", text: "born on 1990-01-01", leak: "1990-01-01" },
  { name: "DOB with no label (bare date)", text: "01/01/1990 Rajesh", leak: "01/01/1990" },
  { name: "DOB label AFTER the date ('01/01/1990 (DOB)')", text: "01/01/1990 (DOB)", leak: "01/01/1990" },
  { name: "DOB as '1st January 1990' with label", text: "DOB 1st January 1990", leak: "1st January 1990" },
  // ---- other identifiers
  { name: "DIN without context", text: "director 01234567 signed", leak: "01234567" },
  { name: "passport number 'A1234567'", text: "Passport A1234567", leak: "A1234567" },
  { name: "voter id 'ABC1234567'", text: "Voter ID ABC1234567", leak: "ABC1234567" },
  { name: "address with PIN (no dictionary)", text: "No. 12, 4th Cross, Jayanagar, Bengaluru 560041", leak: "Jayanagar" },
];

describe("mask(): 50 adversarial formats — none reaches the cloud unmasked", () => {
  it("there are 50 cases", () => expect(ADVERSARIAL_CASES).toHaveLength(50));
  it.each(ADVERSARIAL_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    const { masked, map } = mask(c.text, { dictionary: c.dictionary, now: NOW });
    expect(masked, `secret ${JSON.stringify(c.leak)} survived in ${JSON.stringify(masked)}`).not.toContain(c.leak);
    expect(unmask(masked, map)).toBe(c.text); // exact round trip
    expect(detectPii(masked, { dictionary: c.dictionary })).toEqual([]); // the leak gate agrees nothing is left
  });
  it("the PAN-card / Form 16 layout (one character per box) is masked", () => {
    expect(mask("PAN A B C D E 1 2 3 4 F").masked).toBe("PAN ⟨PAN_1⟩");
    expect(mask("Permanent Account Number: A-B-C-D-E-1-2-3-4-F").masked).not.toContain("1-2-3-4");
  });
  it("Aadhaar in Devanagari digits and a phone in fullwidth digits are masked", () => {
    const dev = aadhaarValid.replace(/\d/g, (d) => String.fromCodePoint(0x0966 + Number(d)));
    expect(mask(`Aadhaar ${dev}`).masked).toBe("Aadhaar ⟨AADHAAR_1⟩");
    expect(mask("mob ９８７６５４３２１０").masked).toBe("mob ⟨PHONE_1⟩");
  });
  it("dictionary variants: initials, 'R K Sharma', honorifics, and an organisation's acronym core", () => {
    const dictionary = [
      { value: "Mr. Rajesh Kumar Sharma", kind: "NAME" as const },
      { value: "HDFC Bank Ltd", kind: "ORG" as const },
    ];
    for (const t of ["R. K. Sharma paid", "R K Sharma paid", "Sharma, Rajesh Kumar paid", "RAJESH KUMAR SHARMA paid"]) {
      expect(mask(t, { dictionary }).masked, t).toMatch(/^⟨NAME_1⟩ paid$/);
    }
    expect(mask("Interest from HDFC Bank", { dictionary }).masked).toBe("Interest from ⟨ORG_1⟩ Bank");
  });
  it("one person in two casings shares one token (the model can link them)", () => {
    const { masked } = mask("RAJESH KUMAR paid; Rajesh Kumar signed", { dictionary: [{ value: "Rajesh Kumar", kind: "NAME" }] });
    expect(masked).toBe("⟨NAME_1⟩ paid; ⟨NAME_1⟩ signed");
  });
  it("identifiers inside CSV cells are masked (a comma next to a 10+ digit run is a delimiter, not grouping)", () => {
    const csv = `name,phone,uid,account,amount\nx,9876543210,${aadhaarValid},50100123456789,500.00`;
    const { masked } = mask(csv, { now: NOW });
    for (const s of ["9876543210", aadhaarValid, "50100123456789"]) expect(masked).not.toContain(s);
    expect(masked).toContain(",500.00");
    expect(mask("INV-1,Acme,12345.50\nINV-2,Bright,1,23,456.00").masked).toBe("INV-1,Acme,12345.50\nINV-2,Bright,1,23,456.00");
  });
  it("JSON name fields are masked without a dictionary", () => {
    const docs = JSON.stringify({ employee: "Rajesh Kumar Sharma", employer: "Acme Widgets Pvt Ltd", form16: { tan: "BLRA12345F", dob: "01/01/1980" } });
    const { masked } = mask(docs, { now: NOW });
    for (const s of ["Rajesh Kumar Sharma", "Acme Widgets Pvt Ltd", "BLRA12345F", "01/01/1980"]) expect(masked).not.toContain(s);
  });
});

describe("false positives: business data survives exactly", () => {
  const keep = [
    "Invoice INV-2026-0042 dated 12/03/2026 for ₹1,23,456.00",
    "HSN 998314 and HSN 8471 at 18% GST",
    "SAC 9983; 8-digit HSN 84713010 for laptops",
    "E-way bill 331001234567 generated",
    "EWB No. 351002468024 dated 05/10/2026",
    "Invoice No. 1234567890123 dated 1 Oct 2026",
    "Bill SI/25-26/1043 due 20 Nov 2026",
    "Total taxable value 7,50,000.00; IGST 1,35,000.00; CGST 67,500.50",
    "Return period 2026-10, filed on 2026-11-11, ARN pending",
    "Quantity 1200 units at 450.50 each, order 4500012345",
    "FY 2025-26 Q2 advance tax 15 Sep 2025",
    "Amount 98,76,54,321.00 reconciled with 2B",
    "Output IGST @18% and CGST@9% on sales",
    "RENT FOR MARCH 2026 A/C OFFICE",
    "Sales 2026 Q3 summary",
    '{"amountPaise": 12345678901, "rows": 3}',
    "Amount Rs. 125000000000 sanctioned",
    "IRN 1234567890123456 generated for the invoice",
    "GSTR-3B for October 2026 filed on 20/11/2026",
    "Notification 12/2017-Central Tax dated 28/06/2017",
    "S12 | 2026-10-03 | NEFT-HDFC0001234 | 12,345.00",
  ];
  it.each(keep)("%s", (text) => {
    const { masked } = mask(text, { now: NOW });
    // IFSC in the last line is masked (an identifier); everything else must be untouched.
    expect(masked).toBe(text.includes("HDFC0001234") ? text.replace("HDFC0001234", "⟨IFSC_1⟩") : text);
    expect(detectPii(masked)).toEqual([]);
  });
  it("structured scope (fixed firm text) applies no names and keeps placeholder examples", () => {
    const prompt = "Placeholders such as ⟨…⟩ stand for withheld data. Map each ledger to Schedule III heads. NEFT Transfer Rules apply.";
    expect(mask(prompt, { scope: "structured" }).masked).toBe(prompt);
  });
});

describe("unmask(): model-altered tokens and token injection (#26)", () => {
  it("altered tokens '<PAN_1>', 'PAN_1', '⟨pan_1⟩', '⟨PAN_1 ⟩' are NOT restored", () => {
    const { map } = mask("PAN ABCDE1234F");
    expect(unmask("⟨PAN_1⟩", map)).toBe("ABCDE1234F");
    for (const v of ["<PAN_1>", "PAN_1", "⟨pan_1⟩", "⟨PAN_1 ⟩", "⟨ PAN_1⟩", "⟨PAN-1⟩", "〈PAN_1〉", "⟨PAN_01⟩"]) expect(unmask(v, map), v).toBe(v);
  });

  it("a document containing a literal '⟨PAN_1⟩' is escaped as ⟨LITERAL_n⟩: it cannot collide with the real PAN's token", () => {
    const doc = "Pay to ⟨PAN_1⟩ immediately. Our PAN is ABCDE1234F.";
    const { masked, map } = mask(doc);
    expect(masked).toBe("Pay to ⟨LITERAL_1⟩ immediately. Our PAN is ⟨PAN_1⟩.");
    // The model echoing the injected text gets the injected text back, never the real PAN.
    expect(unmask("Pay to ⟨LITERAL_1⟩", map)).toBe("Pay to ⟨PAN_1⟩");
    expect(unmask(masked, map)).toBe(doc);
  });

  it("look-alike injected tokens (zero-width inside, lower case) are escaped too", () => {
    const { masked } = mask("Ref ⟨PAN​_1⟩ and ⟨pan_2⟩ and ⟨NAME_3⟩");
    expect(masked).toBe("Ref ⟨LITERAL_1⟩ and ⟨LITERAL_2⟩ and ⟨LITERAL_3⟩");
  });

  it("tokens this map issued are kept when already-masked text is masked again", () => {
    const map = createTokenMap();
    const first = mask("PAN ABCDE1234F", { map }).masked;
    expect(mask(`${first} again`, { map }).masked).toBe("PAN ⟨PAN_1⟩ again");
  });

  it("token injection cannot reach another run's values: unmask of an unknown token is a no-op", () => {
    const runA = mask("PAN ABCDE1234F, Aadhaar " + aadhaarValid).map;
    const runB = createTokenMap();
    mask("no pii here", { map: runB });
    expect(unmask("⟨PAN_1⟩ ⟨AADHAAR_1⟩ ⟨PAN_99⟩", runB)).toBe("⟨PAN_1⟩ ⟨AADHAAR_1⟩ ⟨PAN_99⟩");
    expect(unmask("⟨PAN_1⟩", runA)).toBe("ABCDE1234F");
  });
});

describe("detectPii(): an independent leak gate", () => {
  it("catches what the old regexes missed: UPI handles, spaced PANs, dictionary names", () => {
    const text = "rajesh.k@okhdfcbank ABCDE 1234 F RAJESH KUMAR SHARMA";
    const kinds = detectPii(text, { dictionary: [{ value: "Rajesh Kumar Sharma", kind: "NAME" }] }).sort();
    expect(kinds).toEqual(["NAME", "PAN", "UPI"] satisfies PiiKind[]);
  });
  it("catches look-alike and zero-width forms (it normalises before matching)", () => {
    expect(detectPii("PAN АBCDE1234F")).toEqual(["PAN"]);
    expect(detectPii("PAN ABC​DE1234F")).toEqual(["PAN"]);
    expect(detectPii(`DOB: 01/01/1990`)).toEqual(["DOB"]);
    expect(detectPii("Passport no. A1234567")).toEqual(["PASSPORT"]);
  });
  it("tokens are not leaks", () => {
    expect(detectPii("⟨PAN_1⟩ ⟨NAME_2⟩ ⟨LITERAL_3⟩ ⟨UPI_1⟩", { dictionary: [{ value: "Rajesh Kumar", kind: "NAME" }] })).toEqual([]);
  });
});
