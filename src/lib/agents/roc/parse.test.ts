import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { InputFile } from "@/lib/agents/core/runner";
import { FIN_HEADS, finColumn, parseAuditor, parseCompany, parseDirectors, parseFinancialsJson, parseFinancialsXlsx, parseMsme, parseRocFiles, parseShareholding, rocInputSchema } from "./parse";

const DIR = "fixtures/accuracy/roc";
const load = (fixture: string): InputFile[] =>
  readdirSync(join(DIR, fixture, "input"))
    .sort()
    .map((name) => ({ name, source: "fixture" as const, bytes: readFileSync(join(DIR, fixture, "input", name)) }));
const file = (name: string, text: string | Buffer): InputFile => ({ name, source: "upload", bytes: Buffer.isBuffer(text) ? text : Buffer.from(text) });
const without = (files: InputFile[], name: string) => files.filter((f) => f.name !== name);
const replace = (files: InputFile[], name: string, text: string) => [...without(files, name), file(name, text)];

describe("parseRocFiles on the clean fixture", () => {
  const input = parseRocFiles(load("clean-small-private"));
  it("reads the company master into paise", () => {
    expect(input.company.paidUpCapitalPaise).toBe(100000000);
    expect(input.company.authorisedCapitalPaise).toBe(500000000);
    expect(input.company.deposits.loansNotDepositsPaise).toBe(50000000);
    expect(input.company.listed).toBe(false);
  });
  it("reads directors, shareholding, auditor, msme and notes", () => {
    expect(input.directors.map((d) => d.din)).toEqual(["01000001", "01000002"]);
    expect(input.directors[0]).toMatchObject({ dinStatus: "active", kycCompletedOn: "2026-08-20", residentInIndia: true });
    expect(input.shareholding.reduce((s, h) => s + h.shares, 0)).toBe(100000);
    expect(input.shareholding[0].paidUpPerSharePaise).toBe(1000);
    expect(input.auditor).toMatchObject({ type: "firm", termStartFy: "2022-23", termYears: 5, reappointedAtThisAgm: false });
    expect(input.msme).toEqual([{ vendor: "Sri Packaging", halfYear: "H2", amountPaise: 12000000, daysOutstanding: 30 }]);
    expect(input.notes).toContain("Related party");
    expect(input.financials.kind).toBe("summary");
  });
  it("reads a trial balance", () => {
    const tb = parseRocFiles(load("clean-trial-balance"));
    expect(tb.financials.kind).toBe("tb");
    if (tb.financials.kind === "tb") {
      expect(tb.financials.trialBalance).toHaveLength(15);
      expect(tb.financials.trialBalance[0]).toEqual({ ledger: "Share Capital", debitPaise: 0, creditPaise: 100000000 });
    }
  });
  it("keeps an xlsx for the async parser", () => {
    expect(parseRocFiles(load("clean-xlsx-financials")).financials.kind).toBe("xlsx");
  });
});

describe("parseRocFiles failures", () => {
  const files = load("clean-small-private");
  it("lists every missing required file", () => {
    expect(() => parseRocFiles([])).toThrow(/company\.json is missing.*directors\.csv is missing.*shareholding\.csv is missing.*auditor\.json is missing.*financials\.json or financials\.xlsx/);
  });
  it("optional files may be absent", () => {
    const input = parseRocFiles(without(without(files, "msme.csv"), "notes.txt"));
    expect(input.msme).toEqual([]);
    expect(input.notes).toBeNull();
  });
  it("blank notes are null", () => {
    expect(parseRocFiles(replace(files, "notes.txt", "  \n")).notes).toBeNull();
  });
  it("rejects bad JSON and bad fields", () => {
    expect(() => parseRocFiles(replace(files, "company.json", "{"))).toThrow(/company\.json is not a valid \.json file/);
    expect(() => parseRocFiles(replace(files, "auditor.json", JSON.stringify({ name: "X", type: "llp", termStartFy: "2022-23" })))).toThrow(/auditor\.json: type/);
  });
  it("the zod schema reports the problem as an issue", async () => {
    const r = await rocInputSchema.safeParseAsync([]);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/company\.json is missing/);
    expect((await rocInputSchema.safeParseAsync(files)).success).toBe(true);
  });
});

describe("individual parsers", () => {
  it("company: unknown keys and bad dates are refused", () => {
    expect(() => parseCompany(file("company.json", JSON.stringify({ name: "A", cin: "C", companyClass: "private", authorisedCapital: 1, paidUpCapital: 1, extra: 1 })))).toThrow(/extra|Unrecognized/);
    expect(() => parseCompany(file("company.json", JSON.stringify({ name: "A", cin: "C", companyClass: "private", authorisedCapital: 1, paidUpCapital: 1, agmDate: "2026-02-30" })))).toThrow(/agmDate/);
  });
  it("company: defaults", () => {
    const c = parseCompany(file("company.json", JSON.stringify({ name: "A", cin: "C", companyClass: "public", authorisedCapital: "1,00,000", paidUpCapital: "50,000", csrNetProfitHistory: ["1,00,00,000", 5] })));
    expect(c).toMatchObject({ agmDate: null, declaredAnnualReturnForm: null, estimateFilingOn: null, deposits: { depositsOutstandingPaise: 0, loansNotDepositsPaise: 0, dpt3FiledOn: null } });
    expect(c.csrNetProfitHistoryPaise).toEqual([1000000000, 500]);
  });
  it("auditor defaults", () => {
    expect(parseAuditor(file("auditor.json", JSON.stringify({ name: "A", type: "individual", termStartFy: "2024-25" })))).toMatchObject({ termYears: 5, consecutiveYearsBeforeTerm: 0, frn: "" });
  });
  it("directors: DIN, status and KYC date are validated", () => {
    const h = "din,name,designation,din_status,kyc_completed_on,resident_in_india\n";
    expect(() => parseDirectors(file("directors.csv", h + "123,A,D,active,,yes"))).toThrow(/row 2: DIN must be 8 digits/);
    expect(() => parseDirectors(file("directors.csv", h + "01234567,A,D,dormant,,yes"))).toThrow(/din_status/);
    expect(() => parseDirectors(file("directors.csv", h + "01234567,A,D,active,31-08-2026,yes"))).toThrow(/kyc_completed_on/);
    expect(() => parseDirectors(file("directors.csv", h))).toThrow(/no directors/);
    expect(parseDirectors(file("directors.csv", h + "01234567,A,,Deactivated,,no"))[0]).toMatchObject({ dinStatus: "deactivated", kycCompletedOn: null, residentInIndia: false, designation: "Director" });
  });
  it("shareholding: whole shares, partly paid, default class", () => {
    const h = "folio,holder,share_class,shares,face_value,paid_up_per_share\n";
    expect(() => parseShareholding(file("s.csv", h + "F1,A,Equity,10.5,10,"))).toThrow(/whole number/);
    expect(() => parseShareholding(file("s.csv", h))).toThrow(/no shareholders/);
    expect(parseShareholding(file("s.csv", h + "F1,A,,100,10,5"))[0]).toMatchObject({ shareClass: "Equity", faceValuePaise: 1000, paidUpPerSharePaise: 500 });
  });
  it("msme: half-year and days are validated", () => {
    const h = "vendor,half_year,amount,days_outstanding\n";
    expect(() => parseMsme(file("m.csv", h + "V,H3,100,50"))).toThrow(/H1 or H2/);
    expect(() => parseMsme(file("m.csv", h + "V,h1,100,abc"))).toThrow(/whole number/);
    expect(parseMsme(file("m.csv", h + "V,h1,100,46"))[0]).toEqual({ vendor: "V", halfYear: "H1", amountPaise: 10000, daysOutstanding: 46 });
  });
  it("financial columns need every head and no unknown head", () => {
    const all = Object.fromEntries(FIN_HEADS.map((h) => [h, "1"]));
    expect(finColumn(all, "x").shareCapital).toBe(100);
    expect(() => finColumn({ ...all, goodwill: 1 }, "x")).toThrow(/unknown head\(s\) goodwill/);
    const { taxExpense: _t, ...missing } = all;
    void _t;
    expect(() => finColumn(missing, "x")).toThrow(/"taxExpense" is missing/);
    expect(() => parseFinancialsJson(file("financials.json", JSON.stringify({ current: all })))).toThrow(/financials\.json/);
  });
});

describe("parseFinancialsXlsx", () => {
  async function book(rows: (string | number)[][], sheet = "Financials"): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheet);
    for (const r of rows) ws.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  it("reads Item | Current | Previous", async () => {
    const rows = [["Item", "Current", "Previous"], ...FIN_HEADS.map((h, i) => [h, i * 1000 + 0.5, i]), ["", "", ""]];
    const out = await parseFinancialsXlsx("f.xlsx", await book(rows));
    expect(out.current.longTermBorrowings).toBe(200050);
    expect(out.previous.longTermBorrowings).toBe(200);
  });
  it("reads formula results and rich text", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Other");
    ws.addRow(["Item", "Current", "Previous"]);
    for (const h of FIN_HEADS) ws.addRow([{ richText: [{ text: h }] }, { formula: "1+1", result: 2 }, 1]);
    const out = await parseFinancialsXlsx("f.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(out.current.cashAndBank).toBe(200);
  });
  it("refuses a wrong header and unreadable bytes", async () => {
    await expect(parseFinancialsXlsx("f.xlsx", await book([["Head", "This year", "Last year"]]))).rejects.toThrow(/row 1 must be/);
    await expect(parseFinancialsXlsx("f.xlsx", Buffer.from("not a zip"))).rejects.toThrow(/not a readable XLSX/);
  });
});
