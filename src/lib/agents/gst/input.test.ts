// Input sorting (sync schema) and loading (async parse) tests, incl. fail-closed paths.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { InputFile } from "@/lib/agents/core/runner";
import { classifyFiles, gstInputSchema, loadGstData, ProfileZ } from "./input";

const f = (name: string, text: string | Buffer): InputFile => ({ name, source: "fixture", bytes: Buffer.isBuffer(text) ? text : Buffer.from(text) });
const PROFILE = JSON.stringify({ gstin: "29aafcz1001k1zc", aatoInr: "2,00,00,000", expectedFilingDate: "30-11-2026" });
const SALES = "Date,Voucher No.,Particulars,GSTIN/UIN,Place of Supply,HSN/SAC,GST Rate,Taxable Value,IGST,CGST,SGST/UTGST\n03-10-2026,INV/1,Tanvir,29AABCT5101P1Z3,29,7318,18,1000,,90,90\n05-10-2026,INV/2,Walk-in,,29,7318,18,500,,45,45";
const PURCH = "Date,Supplier Invoice No.,Particulars,GSTIN/UIN,Purchase Ledger,GST Rate,Taxable Value,IGST,CGST,SGST/UTGST\n05-10-2026,SS/1,Sunrise,29AAGCS6101U1ZN,Raw Material,18,600,,54,54";
const TWO_B = JSON.stringify({ data: { docdata: { b2b: [{ ctin: "29AAGCS6101U1ZN", inv: [{ inum: "SS/1", dt: "05-10-2026", val: 708, items: [{ txval: 600, cgst: 54, sgst: 54 }] }] }] } } });
const JOB = { period: "2026-10", fy: "2026-27" };
const BASE = [f("profile.json", PROFILE), f("Sales-Register.csv", SALES), f("purchase-register.csv", PURCH), f("gstr2b.json", TWO_B)];

describe("classifyFiles / gstInputSchema", () => {
  it("sorts files into roles by name and kind; XLSX kept as base64; others ignored", () => {
    const { input, issues } = classifyFiles([...BASE, f("prev-return.json", "{}"), f("payables.xlsx", "PK"), f("einvoice.json", "[]"), f("eway-bills.csv", "a"), f("readme.txt", "x"), f("photo.png", "x")]);
    expect(issues).toEqual([]);
    expect(input.files.map((x) => [x.role, x.kind])).toEqual([
      ["profile", "json"],
      ["sales", "csv"],
      ["purchases", "csv"],
      ["gstr2b", "json"],
      ["prev", "json"],
      ["payables", "xlsx"],
      ["einvoice", "json"],
      ["eway", "csv"],
    ]);
    expect(input.files.find((x) => x.role === "payables")?.base64).toBe(Buffer.from("PK").toString("base64"));
    expect(input.ignored).toEqual(["readme.txt", "photo.png"]);
  });

  it("reports missing, duplicate and empty inputs, and names the right agent for other departments' files", () => {
    const { issues } = classifyFiles([f("sales.csv", SALES), f("sales-2.csv", SALES), f("profile.json", ""), f("Trial Balance.xlsx", "x")]);
    expect(issues).toEqual([
      "Two files look like the sales register (CSV/XLSX): sales.csv and sales-2.csv; keep one in ClientDocs",
      "profile.json is empty",
      "profile.json (client GSTIN, AATO, filing frequency) is missing from the client documents",
      "the purchase register (CSV/XLSX) is missing from the client documents",
      "the GSTR-2B (JSON or Excel) is missing from the client documents",
      "Trial Balance.xlsx looks like a trial balance or ledger: that is Books Close's input",
    ]);
    const parsed = gstInputSchema.safeParse([f("x.txt", "y")]);
    expect(parsed.success).toBe(false);
    expect(gstInputSchema.safeParse(BASE).success).toBe(true);
  });

  it("profile: GSTIN upper-cased, AATO in rupees → paise, defaults", () => {
    expect(ProfileZ.parse(JSON.parse(PROFILE))).toEqual({ gstin: "29AAFCZ1001K1ZC", legalName: "", aatoPaise: 2000000000, filingFrequency: "monthly", expectedFilingDate: "2026-11-30", dueDate: null });
    expect(ProfileZ.safeParse({ gstin: "", aatoInr: 1 }).success).toBe(false);
    expect(ProfileZ.safeParse({ gstin: "X", aatoInr: "lots" }).success).toBe(false);
    expect(ProfileZ.safeParse({ gstin: "X", aatoInr: 1, dueDate: "someday" }).success).toBe(false);
  });
});

async function load(files: InputFile[]) {
  const { input, issues } = classifyFiles(files);
  expect(issues).toEqual([]);
  return loadGstData(input, JOB);
}

describe("loadGstData", () => {
  it("parses every role into one extract with sources and notes", async () => {
    const x = await load([
      ...BASE,
      f("prev-return.json", JSON.stringify({ period: "2026-09", gstr1Liability: { igst: 10 }, gstr3bLiability: { igst: "10.00" }, closingCreditBalance: { cgst: 5 }, filedOn: "2026-10-20", dueOn: "2026-10-20" })),
      f("payables-ageing.csv", "Party Name,GSTIN,Invoice No,Invoice Date,Invoice Value,Amount Paid,IGST\nC,33AAKCX6404X1ZD,CC/1,03-05-2026,118,0,18"),
      f("einvoice.json", JSON.stringify([{ docNo: "INV/1", irn: "irn-1" }])),
      f("eway.csv", "x"),
      f("notes.txt", "x"),
    ]);
    expect(x.profile.gstin).toBe("29AAFCZ1001K1ZC");
    expect(x.sales.map((d) => [d.number, d.irn])).toEqual([
      ["INV/1", "irn-1"],
      ["INV/2", null],
    ]);
    expect(x.purchases[0]).toMatchObject({ number: "SS/1", ledger: "Raw Material" });
    expect(x.gstr2b[0]).toMatchObject({ number: "SS/1", tax: { cgst: 5400 } });
    expect(x.prev).toMatchObject({ period: "2026-09", gstr1: { igst: 1000 }, gstr3b: { igst: 1000 }, closingCredit: { cgst: 500 }, filedOn: "2026-10-20" });
    expect(x.payables[0]).toMatchObject({ number: "CC/1", itc: { igst: 1800 } });
    expect(x.sources).toMatchObject({ sales: { file: "Sales-Register.csv", style: "tally", format: "csv" }, prev: { file: "prev-return.json" }, payables: { format: "csv" }, einvoice: { format: "json" } });
    expect(x.notes).toEqual(["eway.csv: e-way bill data received; GST Prep v1.0.0 does not check it", "notes.txt: not a recognised GST input; ignored"]);
    expect(x).toMatchObject({ period: "2026-10", fy: "2026-27", ledgers: [], hsnReads: [] });
  });

  it("reads XLSX registers (first sheet with a register header) and a 2B Excel", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Cover").addRow(["Synthetic"]);
    const ws = wb.addWorksheet("Register");
    ws.addRow(["Date", "Voucher No.", "GSTIN/UIN", "Taxable Value", "CGST", "SGST/UTGST", "GST Rate"]);
    ws.addRow([new Date("2026-10-03T00:00:00Z"), "X/1", "29AABCT5101P1Z3", 1000, 90, 90, 18]);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const x = await load([BASE[0], f("sales.xlsx", bytes), BASE[2], BASE[3]]);
    expect(x.sales[0]).toMatchObject({ loc: "sales.xlsx!Register row 2", number: "X/1", date: "2026-10-03" });
  });

  it("fails closed on another department's file before any model call, and on bad JSON / profile / 2B", async () => {
    const tb = f("sales-register.csv", "Particulars,Group,Opening Balance,Debit,Credit,Closing Balance\nCash,Assets,0,10,0,10");
    await expect(load([BASE[0], tb, BASE[2], BASE[3]])).rejects.toThrow(/looks like a trial balance or ledger.*Books Close/);
    await expect(load([f("profile.json", "{not json"), ...BASE.slice(1)])).rejects.toThrow(/profile\.json: not a valid \.json file/);
    await expect(load([f("profile.json", JSON.stringify({ aatoInr: 1 })), ...BASE.slice(1)])).rejects.toThrow(/profile\.json: gstin/);
    await expect(load([...BASE.slice(0, 3), f("gstr2b.json", "{}")])).rejects.toThrow(/not a GSTR-2B JSON/);
    await expect(load([...BASE, f("prev.json", JSON.stringify({ period: "2026-09" }))])).rejects.toThrow(/prev\.json: gstr1Liability/);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("S").addRow(["Name", "Age"]);
    const odd = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(load([BASE[0], f("sales.xlsx", odd), BASE[2], BASE[3]])).rejects.toThrow(/no GST columns/);
    await expect(loadGstData({ files: [], ignored: [] }, JOB)).rejects.toThrow(/missing/);
  });

  it("an e-invoice CSV without an IRN column fails closed", async () => {
    await expect(load([...BASE, f("einvoice.csv", "Doc No,Date\nINV/1,2026-10-03")])).rejects.toThrow(/no IRN column/);
    const x = await load([...BASE, f("einvoice.csv", "Doc No,Doc Date,IRN,Taxable Value\nINV/2,05-10-2026,irn-2,1")]);
    expect(x.sales[1].irn).toBe("irn-2");
  });
});
