// Parser tests: CSV/XLSX readers, both register styles (Tally, Zoho), payables, e-invoice, GSTR-2B
// JSON (2B and 2A-style keys) and Excel, and the wrong-department sniff.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { detectStyle, mapColumns, REGISTER_FIELDS } from "./columns";
import { stateCodeOf, stateName } from "./config";
import { parse2bJson, parse2bSheets } from "./gstr2b";
import {
  docTypeOf,
  dupKey,
  matchKey,
  normGstin,
  parseEinvoiceJson,
  parseEinvoiceTable,
  parsePayablesTable,
  parsePurchaseTable,
  parseSalesTable,
  registerTable,
  snapRate,
  yes,
} from "./registers";
import { agentHintForName, sniffRegister } from "./sniff";
import { headerKey, parseCsv, readXlsx, toTable } from "./tabular";

const table = (csv: string, file = "sales.csv") => registerTable(parseCsv(csv), file);

async function xlsx(sheets: Record<string, unknown[][]>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const r of rows) ws.addRow(r);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("CSV reader", () => {
  it("handles quotes, escaped quotes, CRLF, BOM, embedded commas and blank lines", () => {
    const g = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""",3\r\n\r\n"multi\nline",,\n');
    expect(g).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "3"],
      ["multi\nline", "", ""],
    ]);
  });
  it("detects semicolon and tab delimiters and keeps trailing spaces inside quotes", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2")[1]).toEqual(["1", "2"]);
    expect(parseCsv('n\n"inv/1 "')[1]).toEqual(["inv/1 "]);
  });
  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a\n"open')).toThrow(/unterminated/);
  });
});

describe("header mapping", () => {
  it("normalises headers and maps aliases one column per field", () => {
    expect(headerKey("Taxable Value (₹)")).toBe("taxable value");
    expect(headerKey("Rate(%)")).toBe("rate %");
    const cols = mapColumns(["Date", "Voucher No.", "Supplier Invoice No.", "Taxable Value", "SGST/UTGST"], REGISTER_FIELDS);
    expect(cols).toMatchObject({ date: 0, number: 1, supplierInvNo: 2, taxable: 3, sgst: 4 });
  });
  it("detects the export style", () => {
    expect(detectStyle(["Date", "Particulars", "Voucher No.", "GSTIN/UIN"])).toBe("tally");
    expect(detectStyle(["Invoice Date", "Invoice Number", "Customer Name", "Item Total"])).toBe("zoho");
    expect(detectStyle(["Date", "Number", "Taxable Value"])).toBe("generic");
  });
  it("finds a header row below title rows and fails clearly without one", () => {
    const t = toTable([["Company"], ["Sales Register"], [], ["Date", "Invoice Number", "Taxable Value", "IGST"], ["05-10-2026", "A1", "100", "18"]], "x.csv", (k) => ["date", "invoice number", "taxable value", "igst"].includes(k));
    expect(t).toMatchObject({ headerRow: 4, rowNumbers: [5] });
    expect(() => registerTable([["just"], ["text"]], "x.csv")).toThrow(/no header row/);
  });
  it("helpers: doc types, yes/no, GSTIN, keys, rate snap, states", () => {
    expect(docTypeOf("Credit Note")).toBe("CRN");
    expect(docTypeOf("Sales Return")).toBe("CRN");
    expect(docTypeOf("Debit Note")).toBe("DBN");
    expect(docTypeOf("Tax Invoice")).toBe("INV");
    expect(yes("Yes")).toBe(true);
    expect(yes("N")).toBe(false);
    expect(normGstin(" 29aabct5101p1z3 ")).toBe("29AABCT5101P1Z3");
    expect(normGstin("URP")).toBeNull();
    expect(matchKey("ss / 7007")).toBe("SS7007");
    expect(dupKey("inv/26/501 ")).toBe("INV/26/501");
    expect(snapRate(1799)).toBe(1800);
    expect(snapRate(1190)).toBe(1200);
    expect(stateCodeOf("29-Karnataka")).toBe("29");
    expect(stateCodeOf("Karnataka (29)")).toBe("29");
    expect(stateCodeOf("Tamil Nadu")).toBe("33");
    expect(stateCodeOf("KA")).toBe("29");
    expect(stateCodeOf("7")).toBe("07");
    expect(stateCodeOf("Orissa")).toBe("21");
    expect(stateCodeOf("Atlantis")).toBeNull();
    expect(stateCodeOf("")).toBeNull();
    expect(stateName("29")).toBe("29-Karnataka");
    expect(stateName("98")).toBe("98");
    expect(stateName(null)).toBe("");
  });
});

const TALLY_SALES = [
  "Date,Particulars,Voucher Type,Voucher No.,GSTIN/UIN,Place of Supply,HSN/SAC,Item Description,Quantity,GST Rate,Taxable Value,IGST,CGST,SGST/UTGST,Cess,Gross Total,Original Invoice No.,Original Invoice Date,IRN",
  "03-10-2026,Tanvir Traders,Sales,INV/26/101,29AABCT5101P1Z3,29-Karnataka,7318,Steel bolts,1000,18,\"1,00,000.00\",,9000.00,9000.00,,118000.00,,,IRN1",
  ",,,,,,7318.0,Washers,10 NOS,18,5000.00,,450.00,450.00,,,,,",
  "10-10-2026,Walk-in,Sales,INV/26/102,,33-Tamil Nadu,,Teak table (HSN 9403),1,,84745.77,15254.24,,,,100000.01,,,",
  "20-10-2026,Tanvir Traders,Credit Note,CN/1,29AABCT5101P1Z3,29-Karnataka,7318,Return,5,18,-2000.00,,-180.00,-180.00,,-2360.00,INV/26/101,03-10-2026,",
  "Total,,,,,,,,,,,,,,,,,,",
].join("\n");

describe("sales register — Tally style", () => {
  const { docs, style } = parseSalesTable(table(TALLY_SALES));
  it("groups continuation rows, derives rates, keeps credit notes positive", () => {
    expect(style).toBe("tally");
    expect(docs).toHaveLength(3);
    const [inv, b2c, cn] = docs;
    expect(inv).toMatchObject({ loc: "sales.csv row 2", number: "INV/26/101", date: "2026-10-03", gstin: "29AABCT5101P1Z3", pos: "29", value: 11800000, irn: "IRN1" });
    expect(inv.lines.map((l) => [l.taxable, l.tax.cgst, l.hsn, l.qty])).toEqual([
      [10000000, 900000, "7318", 1000],
      [500000, 45000, "7318", 10],
    ]);
    expect(b2c).toMatchObject({ gstin: null, pos: "33", value: 10000001 });
    expect(b2c.lines[0]).toMatchObject({ rateBps: 1800, hsn: null, description: "Teak table (HSN 9403)" });
    expect(cn).toMatchObject({ docType: "CRN", value: 236000, origNumber: "INV/26/101", origDate: "2026-10-03" });
    expect(cn.lines[0]).toMatchObject({ taxable: 200000, tax: { cgst: 18000, sgst: 18000 } });
  });

  it("errors name the file, row and field", () => {
    const bad = TALLY_SALES.replace("9000.00,9000.00", "9000.00,abc");
    expect(() => parseSalesTable(table(bad))).toThrow(/sales\.csv row 2: SGST not an amount/);
    expect(() => parseSalesTable(table(TALLY_SALES.replace("03-10-2026", "31-02-2026")))).toThrow(/row 2: date/);
    expect(() => parseSalesTable(table("Date,Particulars,Taxable Value,IGST\n05-10-2026,X,1,1"))).toThrow(/cannot find column\(s\) number/);
    expect(() => parseSalesTable(table("Date,Voucher No.,Taxable Value\n05-10-2026,,1"))).toThrow(/document number is blank/);
    expect(() => parseSalesTable(table("Date,Voucher No.,Taxable Value\n,A1,1"))).toThrow(/date is blank/);
  });
});

const ZOHO_SALES = [
  "Invoice Date,Invoice Number,Customer Name,GST Identification Number (GSTIN),Place of Supply,HSN/SAC,Item Name,Quantity,Item Tax %,Item Total,IGST,CGST,SGST,CESS,Total,Transaction Type,Reference Invoice Number,E-Invoice IRN",
  "04/10/2026,INV-0451,Nilgiri Foods,33AAECN5404S1Z5,Tamil Nadu (33),1905,Biscuits,400,18,40000.00,7200.00,,,,58400.00,Invoice,,",
  "04/10/2026,INV-0451,Nilgiri Foods,33AAECN5404S1Z5,Tamil Nadu (33),2106,Namkeen,100,12,10000.00,1200.00,,,,58400.00,Invoice,,",
  "20/10/2026,CN-011,Kaveri Retail,29AACCR5202Q1Z0,Karnataka (29),1905,Return,50,18,5000.00,,450.00,450.00,,5900.00,Credit Note,INV-0452,",
].join("\n");

describe("sales register — Zoho style", () => {
  it("one invoice from repeated rows; Total taken once; Zoho POS format", () => {
    const { docs, style } = parseSalesTable(table(ZOHO_SALES));
    expect(style).toBe("zoho");
    expect(docs.map((d) => [d.number, d.docType, d.pos, d.value, d.lines.length])).toEqual([
      ["INV-0451", "INV", "33", 5840000, 2],
      ["CN-011", "CRN", "29", 590000, 1],
    ]);
    expect(docs[0].lines.map((l) => l.rateBps)).toEqual([1800, 1200]);
  });
});

describe("purchase registers", () => {
  it("Tally: supplier invoice number/date win over voucher number; RCM flag; ledger", () => {
    const csv = [
      "Date,Particulars,Voucher Type,Voucher No.,Supplier Invoice No.,Supplier Invoice Date,GSTIN/UIN,Place of Supply,Purchase Ledger,Item Description,GST Rate,Taxable Value,IGST,CGST,SGST/UTGST,Cess,Gross Total,Reverse Charge,Payment Date",
      "08-10-2026,Sunrise Steel,Purchase,PUR-0001,SS/1001,05-10-2026,29AAGCS6101U1ZN,29-Karnataka,Raw Material Purchases,MS rods,18,60000,,5400,5400,,70800,No,20-10-2026",
      "14-10-2026,Adv. R Iyer,Purchase,PUR-0002,RI/45,14-10-2026,,29-Karnataka,Legal Fees,Recovery suit,,50000,,,,,50000,Yes,",
    ].join("\n");
    const { docs, style } = parsePurchaseTable(table(csv, "purchases.csv"));
    expect(style).toBe("tally");
    expect(docs[0]).toMatchObject({ number: "SS/1001", date: "2026-10-05", supplier: "Sunrise Steel", ledger: "Raw Material Purchases", paidOn: "2026-10-20", reverseCharge: false });
    expect(docs[1]).toMatchObject({ number: "RI/45", gstin: null, reverseCharge: true, value: 5000000 });
    expect(docs[1].lines[0].rateBps).toBe(0);
  });

  it("Zoho: Bill Number / Account; falls back to the item description as ledger", () => {
    const csv = ["Bill Date,Bill Number,Vendor Name,Vendor GSTIN,Place of Supply,Item Name,Item Tax %,Item Total,IGST,CGST,SGST,CESS,Total,Is Reverse Charge Applied", "02/10/2026,TS/88,Tellapur Grains,36AALCY6505Y1Z1,Karnataka (29),Wheat flour,5,80000,4000,,,,84000,false"].join("\n");
    const { docs, style } = parsePurchaseTable(table(csv, "purchases.csv"));
    expect(style).toBe("zoho");
    expect(docs[0]).toMatchObject({ number: "TS/88", gstin: "36AALCY6505Y1Z1", pos: "29", ledger: "Wheat flour" });
  });

  it("payables ageing and e-invoice registers", () => {
    const pay = table(["Party Name,GSTIN,Invoice No,Invoice Date,Invoice Value,Amount Paid,IGST,CGST,SGST,Cess,ITC Reversed Earlier", "Coastal,33AAKCX6404X1ZD,CC/450,03-05-2026,118000,0,18000,0,0,0,No", "Total,,,,,,,,,,", "Old,33AAKCX6404X1ZD,CC/1,01-01-2026,100,0,10,0,0,0,Yes"].join("\n"), "payables.csv");
    const rows = parsePayablesTable(pay);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ number: "CC/450", date: "2026-05-03", value: 11800000, paid: 0, itc: { igst: 1800000 }, reversedEarlier: false });
    expect(rows[1].reversedEarlier).toBe(true);
    expect(() => parsePayablesTable(table("Party Name,Invoice No,Taxable Value\nA,B,1", "p.csv"))).toThrow(/needs a date column/);

    const ein = parseEinvoiceTable(table("Doc No,Doc Date,IRN,Taxable Value\nINV/26/901,02-10-2026,abc,1\n,,,", "einvoice.csv"));
    expect(ein.get("INV26901")).toBe("abc");
    const j = parseEinvoiceJson({ data: [{ DocNo: "INV-1", Irn: "x" }, { inum: "", irn: "y" }] });
    expect([...j.entries()]).toEqual([["INV1", "x"]]);
    expect(parseEinvoiceJson([{ docNo: "A-2", irn: "z" }]).get("A2")).toBe("z");
    expect(parseEinvoiceJson({}).size).toBe(0);
  });
});

describe("XLSX reader", () => {
  it("flattens rich text, formulas, dates and booleans; drops trailing blank rows", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S");
    ws.addRow([{ richText: [{ text: "Da" }, { text: "te" }] }, "Amount", "Flag", "Link"]);
    ws.addRow([new Date("2026-10-05T00:00:00Z"), { formula: "1+1", result: 2 }, true, { text: "x", hyperlink: "https://example.test" }]);
    ws.addRow([null, { error: "#N/A" }, null, null]); // an error cell reads as blank, so this row is blank
    ws.addRow([]);
    const [s] = await readXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(s.grid[0]).toEqual(["Date", "Amount", "Flag", "Link"]);
    expect(s.grid[1]).toEqual([new Date("2026-10-05T00:00:00Z"), 2, "TRUE", "x"]);
    expect(s.grid).toHaveLength(2);
  });
  it("rejects bytes that are not XLSX", async () => {
    await expect(readXlsx(Buffer.from("not a zip"))).rejects.toThrow(/not a readable XLSX/);
  });
});

const TWO_B = {
  data: {
    gstin: "29AAFCZ1001K1ZC",
    docdata: {
      b2b: [
        {
          ctin: "29AAGCS6101U1ZN",
          trdnm: "Sunrise Steel",
          inv: [
            { inum: "SS/1001", dt: "05-10-2026", val: 70800, pos: "29", rev: "N", itcavl: "Y", rsn: "", items: [{ rt: 18, txval: 60000, igst: 0, cgst: 5400, sgst: 5400, cess: 0 }] },
            { inum: "SS/1002", dt: "06-10-2026", val: "1180.50", pos: "29", rev: "Y", itcavl: "N", rsn: "POS", items: [{ txval: "1000.50", cgst: "90.00", sgst: "90.00" }] },
          ],
        },
      ],
      cdnr: [{ ctin: "29AAGCS6101U1ZN", trdnm: "Sunrise Steel", nt: [{ ntnum: "SCN/1", typ: "C", dt: "20-10-2026", val: -1180, items: [{ txval: -1000, cgst: -90, sgst: -90 }] }, { nt_num: "SDN/1", ntty: "D", nt_dt: "21-10-2026", val: 118, txval: 100, camt: 9, samt: 9 }] }],
      impg: [{ refdt: "01-10-2026" }],
    },
  },
};

describe("GSTR-2B JSON", () => {
  it("reads b2b and cdnr (2B keys), signs, availability, reverse charge; notes unused sections", () => {
    const { docs, notes } = parse2bJson(TWO_B, "gstr2b.json");
    expect(docs.map((d) => [d.docType, d.number, d.taxable, d.tax.cgst, d.itcAvailable, d.reverseCharge])).toEqual([
      ["INV", "SS/1001", 6000000, 540000, true, false],
      ["INV", "SS/1002", 100050, 9000, false, true],
      ["CRN", "SCN/1", 100000, 9000, true, false],
      ["DBN", "SDN/1", 10000, 900, true, false],
    ]);
    expect(docs[0]).toMatchObject({ loc: "gstr2b.json b2b[0].inv[0]", date: "2026-10-05", value: 7080000, ctin: "29AAGCS6101U1ZN" });
    expect(docs[2].value).toBe(118000);
    expect(notes).toEqual(["gstr2b.json: GSTR-2B sections impg are not used by GST Prep v1.0.0; review them by hand"]);
  });

  it("accepts the 2A-style keys (idt, itms[].itm_det.iamt/camt/samt/csamt)", () => {
    const { docs } = parse2bJson({ docdata: { b2b: [{ ctin: "36AALCY6505Y1Z1", inv: [{ inum: "TS/88", idt: "02-10-2026", val: 84000, itms: [{ num: 1, itm_det: { txval: 80000, iamt: 4000, csamt: 10 } }] }] }] } }, "2a.json");
    expect(docs[0]).toMatchObject({ number: "TS/88", date: "2026-10-02", taxable: 8000000, tax: { igst: 400000, cess: 1000 } });
  });

  it("rejects other JSON and bad dates", () => {
    expect(() => parse2bJson({ foo: 1 }, "x.json")).toThrow(/not a GSTR-2B JSON/);
    expect(() => parse2bJson({ docdata: { b2b: [{ ctin: "X", inv: [{ inum: "1", dt: "soon" }] }] } }, "x.json")).toThrow(/b2b\[0\]\.inv\[0\]: document date/);
    expect(parse2bJson({ docdata: { b2b: [], cdnr: [] } }, "empty.json").docs).toEqual([]);
  });
});

describe("GSTR-2B Excel", () => {
  it("two-row header, rate rows grouped into one document, CDNR sheet", async () => {
    const bytes = await xlsx({
      "Read me": [["synthetic"]],
      B2B: [
        ["title"],
        ["GSTIN of supplier", "Trade/Legal name", "Invoice Details", "", "", "", "Place of supply", "Supply Attract Reverse Charge", "Rate(%)", "Taxable Value (₹)", "Tax Amount", "", "", "", "ITC Availability", "Reason"],
        ["", "", "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", "", "", "", "", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", "", ""],
        ["29AAHCP6202V1ZL", "Prime", "PC-1", "Regular", "07/10/2026", 2360, "Karnataka", "N", 18, 1000, 0, 90, 90, 0, "Yes", ""],
        ["29AAHCP6202V1ZL", "Prime", "PC-1", "Regular", "07/10/2026", 2360, "Karnataka", "N", 18, 1000, 0, 90, 90, 0, "Yes", ""],
        ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ],
      "B2B-CDNR": [
        ["GSTIN of supplier", "Trade/Legal name", "Note number", "Note type", "Note Date", "Note Value(₹)", "Place of supply", "Rate(%)", "Taxable Value (₹)", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", "ITC Availability", "Reason"],
        ["27AAJCW6303W1ZC", "Westline", "WCN-9", "Credit Note", "15/10/2026", -118, "Karnataka", 18, -100, -18, 0, 0, 0, "No", "POS"],
      ],
    });
    const { docs } = parse2bSheets(await readXlsx(bytes), "gstr2b.xlsx");
    expect(docs).toHaveLength(2);
    expect(docs[0]).toMatchObject({ loc: "gstr2b.xlsx!B2B row 4", number: "PC-1", taxable: 200000, tax: { cgst: 18000, sgst: 18000 }, pos: "29", itcAvailable: true });
    expect(docs[1]).toMatchObject({ docType: "CRN", taxable: 10000, tax: { igst: 1800 }, value: 11800, itcAvailable: false, reason: "POS" });
  });
  it("errors when no 2B sheet is present or a value is not an amount", async () => {
    await expect(readXlsx(await xlsx({ Sheet1: [["a"]] })).then((s) => parse2bSheets(s, "x.xlsx"))).rejects.toThrow(/no B2B or B2B-CDNR sheet/);
    const bad = await xlsx({ B2B: [["GSTIN of supplier", "Invoice number", "Invoice Date", "Taxable Value"], ["29AAHCP6202V1ZL", "A", "07/10/2026", "lots"]] });
    expect(() => parse2bSheets([{ name: "B2B", grid: [] }], "x.xlsx")).toThrow(/no B2B/);
    await expect(readXlsx(bad).then((s) => parse2bSheets(s, "x.xlsx"))).rejects.toThrow(/row 2: taxable not an amount/);
  });
});

describe("wrong-department sniff (ADR-008)", () => {
  it("passes GST registers and stops trial balances, bank statements, 26AS and ROC files naming the agent", () => {
    expect(sniffRegister(parseCsv(TALLY_SALES), "s.csv", "sales")).toBeNull();
    expect(sniffRegister([["Particulars", "Group", "Opening Balance", "Debit", "Credit", "Closing Balance"]], "tb.csv", "sales")).toMatch(/trial balance.*Books Close/);
    expect(sniffRegister([["Txn Date", "Value Date", "Narration", "Withdrawal", "Deposit", "Balance"]], "bank.csv", "purchases")).toMatch(/bank statement.*Books Close/);
    expect(sniffRegister([["Name of Deductor", "TAN of Deductor", "Section", "Amount Paid/Credited", "Tax Deducted"]], "26as.csv", "sales")).toMatch(/26AS.*Tax Prep/);
    expect(sniffRegister([["DIN", "Director Name", "Designation", "Date of Appointment"]], "dirs.csv", "purchases")).toMatch(/ROC Prep/);
    expect(sniffRegister([["Name", "Age"]], "x.csv", "payables")).toMatch(/no GST columns.*payables/);
    expect(sniffRegister([["Doc No", "IRN"]], "e.csv", "einvoice")).toBeNull();
    expect(sniffRegister([["Doc No"]], "e.csv", "einvoice")).toMatch(/no IRN column/);
  });
  it("names the right agent for unrecognised file names", () => {
    expect(agentHintForName("Trial Balance Oct.xlsx")).toMatch(/Books Close/);
    expect(agentHintForName("hdfc-statement.csv")).toMatch(/Books Close/);
    expect(agentHintForName("26AS-2026.pdf")).toMatch(/Tax Prep/);
    expect(agentHintForName("AOC-4 data.xlsx")).toMatch(/ROC Prep/);
    expect(agentHintForName("notes.txt")).toBeNull();
  });
});
