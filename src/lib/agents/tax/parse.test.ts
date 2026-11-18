import { describe, expect, it } from "vitest";
import type { InputFile } from "@/lib/agents/core/runner";
import { fixtureFiles, inputOf, patchedFiles } from "./__fixtures__/base";
import { parse26As, parseAis, parseCapitalGains, parseMsme, parseOrganiser, parsePriorItr, parseTaxFiles, taxInputSchema } from "./parse";

const file = (name: string, text: string): InputFile => ({ name, source: "upload", bytes: Buffer.from(text) });

describe("parseTaxFiles on fixtures", () => {
  it("reads the salaried organiser and statements into paise", () => {
    const i = inputOf("clean-salaried-new");
    expect(i.organiser.profile).toMatchObject({ status: "individual", regimeClaimed: "new", residentialStatus: "resident", isLlp: false, auditPlanned: false });
    expect(i.organiser.salary).toEqual({ grossPaise: 150000000, exemptAllowancesPaise: 0, professionalTaxPaise: 240000, basicDaPaise: 75000000, employerNpsPaise: 0 });
    expect(i.organiser.deductions.s80C).toBe(0);
    expect(i.form26as?.map((t) => t.tdsPaise)).toEqual([10110000, 420000]);
    expect(i.ais?.map((l) => l.category)).toEqual(["interest-savings", "interest-deposit", "salary"]);
    expect(i.priorItr).toMatchObject({ ay: "2025-26", lossesCarriedForward: [] });
    expect(i.capitalGains).toBeNull();
    expect(i.msme).toBeNull();
  });
  it("reads business, capital gains and MSME files", () => {
    expect(inputOf("trap-44ad-over-limit-bearer-cheques").organiser.business).toMatchObject({ turnoverPaise: 2100000000, nonAccountPayeeChequePaise: 50000000, declaredIncomePaise: 0 });
    expect(inputOf("trap-capital-gains-itr1").capitalGains?.[1]).toMatchObject({ assetType: "listed-equity", saleValuePaise: 110000000, costPaise: 80000000 });
    expect(inputOf("trap-msme-46-days").msme?.[2]).toMatchObject({ category: "medium", agreementDays: null, paidOn: null, outstandingAtYearEnd: true });
  });
  it("missing statements are null, not errors", () => {
    const i = inputOf("typical-gap-missing-26as-ais");
    expect([i.form26as, i.ais, i.priorItr]).toEqual([null, null, null]);
  });
});

describe("failures and department sniff", () => {
  it("organiser.json is required", () => {
    expect(() => parseTaxFiles([])).toThrow(/organiser\.json is missing/);
  });
  it("ROC inputs fail closed naming the ROC agent; a GST register names the GST agent", () => {
    expect(() => parseTaxFiles([file("company.json", "{}"), file("directors.csv", "din")])).toThrow(/run the ROC Prep agent, not Tax Prep/);
    expect(() => parseTaxFiles([file("purchase-register.csv", "Invoice,GSTIN\n")])).toThrow(/GST Prep agent/);
  });
  it("collects every problem in one message", () => {
    const files = patchedFiles("clean-salaried-new", undefined, { "26as.csv": "tan,deductor,section,amount_paid,tds_deposited\nBAD,X,192,1,1\n", "ais.csv": "id,category,source,description,amount\n,x,y,z,1\n" });
    expect(() => parseTaxFiles(files)).toThrow(/TAN must look like.*; ais\.csv row 2: id is required/);
  });
  it("the zod schema reports issues", async () => {
    expect((await taxInputSchema.safeParseAsync(fixtureFiles("clean-salaried-new"))).success).toBe(true);
    const r = await taxInputSchema.safeParseAsync([]);
    expect(r.success).toBe(false);
  });
});

describe("organiser validation", () => {
  const org = (o: Record<string, unknown>) => file("organiser.json", JSON.stringify(o));
  const P = { name: "A", status: "individual", dateOfBirth: "1980-01-01", plannedFilingDate: "2026-07-31" };
  it("individual needs a date of birth; presumptive needs a business; a business needs figures", () => {
    expect(() => parseOrganiser(org({ profile: { ...P, dateOfBirth: null } }))).toThrow(/dateOfBirth: required/);
    expect(() => parseOrganiser(org({ profile: { ...P, presumptive: "44AD" } }))).toThrow(/needs businessKind/);
    expect(() => parseOrganiser(org({ profile: { ...P, businessKind: "business" } }))).toThrow(/business: required/);
  });
  it("bad JSON, unknown keys, bad amounts", () => {
    expect(() => parseOrganiser(file("organiser.json", "{"))).toThrow(/not a valid \.json file/);
    expect(() => parseOrganiser(org({ profile: P, extra: 1 }))).toThrow(/Unrecognized key/);
    expect(() => parseOrganiser(org({ profile: P, otherSources: [{ id: "B1", nature: "savings-interest", payer: "X", amount: "1.234" }] }))).toThrow(/otherSources\[0\]\.amount/);
  });
  it("defaults and normalisation", () => {
    const o = parseOrganiser(org({ profile: { ...P, status: "company", dateOfBirth: null, companyTurnoverPy2: "4,00,00,00,000" }, tdsInBooks: [{ tan: "blra00001a", amount: 5 }] }));
    expect(o.profile).toMatchObject({ companyRegime: "115BAA", companyTurnoverPy2Paise: 400000000000, regimeClaimed: "new", notes: "" });
    expect(o.tdsInBooks[0]).toEqual({ tan: "BLRA00001A", deductor: "", amountPaise: 500 });
    expect([o.salary, o.houseProperty, o.business]).toEqual([null, null, null]);
  });
});

describe("statement parsers", () => {
  it("26AS", () => {
    expect(parse26As(file("26as.csv", "tan,deductor,section,amount_paid,tds_deposited\nblra00001a,X,194A,,10\n"))[0]).toEqual({ tan: "BLRA00001A", deductor: "X", section: "194A", amountPaidPaise: 0, tdsPaise: 1000 });
  });
  it("AIS needs id and category", () => {
    expect(() => parseAis(file("ais.csv", "id,category,source,description,amount\nA1,,S,D,1\n"))).toThrow(/category is required/);
    expect(parseAis(file("ais.csv", "id,category,source,description,amount\nA1,Dividend,S,D,1\n"))[0].category).toBe("dividend");
  });
  it("capital gains: type and dates", () => {
    const h = "asset,asset_type,acquired_on,sold_on,sale_value,cost,expenses\n";
    expect(() => parseCapitalGains(file("c.csv", h + "X,gold,2024-01-01,2025-01-01,1,1,\n"))).toThrow(/asset_type/);
    expect(() => parseCapitalGains(file("c.csv", h + "X,other,2024-01-01,2025-13-01,1,1,\n"))).toThrow(/YYYY-MM-DD/);
    expect(() => parseCapitalGains(file("c.csv", h + "X,other,2025-01-01,2024-01-01,1,1,\n"))).toThrow(/sold before/);
  });
  it("MSME: category, dates, agreement days", () => {
    const h = "vendor,category,acceptance_date,amount,agreement_days,paid_on,outstanding_at_year_end\n";
    expect(() => parseMsme(file("m.csv", h + "V,large,2026-01-01,1,,,yes\n"))).toThrow(/category/);
    expect(() => parseMsme(file("m.csv", h + "V,micro,01-01-2026,1,,,yes\n"))).toThrow(/acceptance_date/);
    expect(() => parseMsme(file("m.csv", h + "V,micro,2026-01-01,1,,2026/02/01,yes\n"))).toThrow(/paid_on/);
    expect(() => parseMsme(file("m.csv", h + "V,micro,2026-01-01,1,forty,,yes\n"))).toThrow(/agreement_days/);
  });
  it("prior ITR", () => {
    expect(() => parsePriorItr(file("p.json", JSON.stringify({ ay: "2025-26" })))).toThrow(/filedOn/);
    expect(parsePriorItr(file("p.json", JSON.stringify({ ay: "2025-26", filedOn: "2025-07-01", dueDate: "2025-07-31", lossesCarriedForward: [{ ay: "2024-25", type: "business", amount: "1,000", returnFiledInTime: true }] }))).lossesCarriedForward[0].amountPaise).toBe(100000);
  });
});
