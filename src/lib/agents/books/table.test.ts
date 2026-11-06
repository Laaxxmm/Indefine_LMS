import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { addMonths, cellText, daysBetween, headerKey, isXlsx, locateColumns, monthEnd, nameKey, parseAmountPaise, parseCsv, parseDay, parseMonth, readTable } from "./table";
import { parseTb, tbTotals, netByLedger, matchRows, TB_ALIASES } from "./tb";

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b,c\r\n"1,000.00","say ""hi""",x\r\n')).toEqual([
      ["a", "b", "c"],
      ["1,000.00", 'say "hi"', "x"],
    ]);
  });
  it("sniffs semicolon, tab and pipe delimiters", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a|b\n1|2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps a last line without a newline and single-column files", () => {
    expect(parseCsv("x\ny")).toEqual([["x"], ["y"]]);
  });
});

describe("parseAmountPaise", () => {
  const ok = (s: string | number | null | undefined) => {
    const r = parseAmountPaise(s);
    if (!r.ok) throw new Error(r.reason);
    return r.paise;
  };
  it.each([
    ["1,23,456.78", 12345678],
    ["123456.78", 12345678],
    ["(1,234.00)", -123400],
    ["-50", -5000],
    ["+50.5", 5050],
    ["12,000.00 Cr", -1200000],
    ["12,000.00 Dr", 1200000],
    ["Cr 500", -50000],
    ["1000cr", -100000],
    ["₹ 5", 500],
    ["Rs. 1,000", 100000],
    ["INR 7.25", 725],
    ["-₹10", -1000],
    ["0.01", 1],
    [".5", 50],
    ["1.005", 101],
    ["1.004", 100],
    ["1e3", 100000],
    ["", 0],
    ["-", 0],
    [null, 0],
    [undefined, 0],
    [182345.5, 18234550],
  ])("%s → %d paise", (s, p) => expect(ok(s as string)).toBe(p));
  it("rejects text that is not an amount", () => {
    expect(parseAmountPaise("12,O00.00").ok).toBe(false);
    expect(parseAmountPaise("abc").ok).toBe(false);
    expect(parseAmountPaise(".").ok).toBe(false);
    expect(parseAmountPaise("1e999").ok).toBe(false);
    expect(parseAmountPaise("99999999999999999999").ok).toBe(false);
  });
  it("never yields negative zero", () => expect(Object.is(ok("-0.00"), 0)).toBe(true));
});

describe("dates and months", () => {
  it.each([
    ["2026-10-05", "2026-10-05"],
    ["2026-10-05T00:00:00Z", "2026-10-05"],
    ["05/10/2026", "2026-10-05"],
    ["5.10.26", "2026-10-05"],
    ["05-Oct-2026", "2026-10-05"],
    ["5 October 2026", "2026-10-05"],
    ["5 Sept 2026", "2026-09-05"],
    ["46300", "2026-10-05"], // 2026-01-01 = serial 46023; +277 days = day 278 = 05 Oct
  ])("parseDay(%s) = %s", (s, d) => expect(parseDay(s)).toBe(d));
  it("rejects impossible dates", () => {
    expect(parseDay("31/02/2026")).toBeNull();
    expect(parseDay("2026-13-01")).toBeNull();
    expect(parseDay("5 Foo 2026")).toBeNull();
    expect(parseDay("")).toBeNull();
    expect(parseDay(undefined)).toBeNull();
    expect(parseDay("1800-01-01")).toBeNull();
  });
  it.each([
    ["2026-10", "2026-10"],
    ["2026-3", "2026-03"],
    ["10/2026", "2026-10"],
    ["Oct-2026", "2026-10"],
    ["March 26", "2026-03"],
    ["2026-10-15", "2026-10"],
  ])("parseMonth(%s) = %s", (s, m) => expect(parseMonth(s)).toBe(m));
  it("parseMonth rejects junk", () => {
    expect(parseMonth("Foo 2026")).toBeNull();
    expect(parseMonth("")).toBeNull();
    expect(parseMonth("13/2026")).toBeNull();
  });
  it("day helpers", () => {
    expect(daysBetween("2026-09-15", "2026-10-31")).toBe(46);
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(nameKey("  Cash   in Hand. ")).toBe("cash in hand");
    expect(headerKey("Debit (₹)")).toBe("debit");
  });
});

describe("locateColumns", () => {
  const rows = [["Company"], ["Period"], ["Account Head", "Classification", "Dr Total", "Cr Total"], ["Cash", "Cash-in-Hand", "10", ""]];
  it("finds nothing without an override when headers are unusual", () => {
    expect(locateColumns(rows, TB_ALIASES, ["ledger", "debit|balance"])).toBeNull();
  });
  it("uses the column-map override", () => {
    const loc = locateColumns(rows, TB_ALIASES, ["ledger", "debit|balance"], { ledger: "Account Head", debit: "Dr Total", credit: "Cr Total", group: "Classification" });
    expect(loc).toEqual({ headerRow: 2, columns: { ledger: 0, group: 1, debit: 2, credit: 3 } });
  });
});

describe("readTable / XLSX", () => {
  it("reads the first sheet with data, numbers and dates as text", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Empty");
    const ws = wb.addWorksheet("TB");
    ws.addRow(["Account", "Date", "Net Debit", "Formula", "Rich", "Flag"]);
    ws.addRow(["Cash", new Date("2026-10-31T00:00:00Z"), 4654.5, { formula: "1+1", result: 2 }, { richText: [{ text: "a" }, { text: "b" }] }, true]);
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const { table, issues } = await readTable({ name: "tb.xlsx", bytes });
    expect(issues).toEqual([]);
    expect(table.rows[1]).toEqual(["Cash", "2026-10-31", "4654.5", "2", "ab", "TRUE"]);
  });
  it("reports an unreadable workbook instead of throwing", async () => {
    const { table, issues } = await readTable({ name: "broken.xlsx", bytes: Buffer.from("PK not really a zip") });
    expect(table.rows).toEqual([]);
    expect(issues[0].message).toMatch(/could not read/);
  });
  it("cellText edge cases", () => {
    expect(cellText(null)).toBe("");
    expect(cellText(new Date("x"))).toBe("");
    expect(cellText(Number.NaN)).toBe("");
    expect(cellText({ text: " link " } as never)).toBe("link");
    expect(cellText({ error: "#REF!" } as never)).toBe("");
    expect(cellText(" plain ")).toBe("plain");
    expect(isXlsx({ name: "a.csv", bytes: Buffer.from("PK..") })).toBe(true);
  });
});

describe("parseTb", () => {
  it("Tally layout: skips title rows, group headings and totals; Dr/Cr columns", () => {
    const rows = parseCsv(["Fixture Co", "Particulars,Group,Debit,Credit", "Current Assets,,,", "Cash,Cash-in-Hand,100.00,", "Capital,Capital Account,,100.00", "Grand Total,,100.00,100.00"].join("\n"));
    const { tb, issues } = parseTb("tb.csv", rows);
    expect(issues).toEqual([]);
    expect(tb!.rows).toEqual([
      { row: 4, ledger: "Cash", group: "Cash-in-Hand", debitPaise: 10000, creditPaise: 0 },
      { row: 5, ledger: "Capital", group: "Capital Account", debitPaise: 0, creditPaise: 10000 },
    ]);
    expect(tbTotals(tb!)).toEqual({ debitPaise: 10000, creditPaise: 10000, differencePaise: 0 });
  });
  it("signed / Dr-Cr closing balance column", () => {
    const { tb } = parseTb("tb.csv", parseCsv("Ledger,Closing Balance\nCash,500.00 Dr\nCapital,500.00 Cr\nLoan,-20"));
    expect(tb!.rows.map((r) => [r.debitPaise, r.creditPaise])).toEqual([
      [50000, 0],
      [0, 50000],
      [0, 2000],
    ]);
  });
  it("a negative in the Debit column is a credit", () => {
    const { tb } = parseTb("tb.csv", parseCsv("Ledger,Debit,Credit\nX,-5,\nY,,-7"));
    expect(tb!.rows.map((r) => [r.debitPaise, r.creditPaise])).toEqual([
      [0, 500],
      [700, 0],
    ]);
  });
  it("reports unreadable amounts and a missing header", () => {
    const bad = parseTb("tb.csv", parseCsv("Ledger,Debit,Credit\nX,1O0,\nY,,abc\nZ,,,\nW,,5"));
    expect(bad.issues.map((i) => i.row)).toEqual([2, 3]);
    expect(bad.tb!.rows.map((r) => r.ledger)).toEqual(["W"]);
    const balBad = parseTb("tb.csv", parseCsv("Ledger,Balance\nX,zz"));
    expect(balBad.issues).toHaveLength(1);
    expect(parseTb("tb.csv", parseCsv("foo,bar\n1,2")).tb).toBeNull();
  });
  it("netByLedger adds repeated names; matchRows by ledger or group", () => {
    const { tb } = parseTb("tb.csv", parseCsv("Ledger,Group,Debit,Credit\nCash,Cash-in-Hand,10,\ncash,Cash-in-Hand,5,\nPetty,Cash-in-hand,1,"));
    expect(netByLedger(tb!).get("cash")!.netPaise).toBe(1500);
    expect(matchRows(tb!, { group: ["cash-in-hand"] })).toHaveLength(3);
    expect(matchRows(tb!, { ledger: ["^petty"] })).toHaveLength(1);
    expect(matchRows(tb!, {})).toHaveLength(0);
  });
});
