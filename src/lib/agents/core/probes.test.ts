// Per-input probe helpers: one value in one file changed, on copies, by column header.
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { bumpAmountText, bumpCellAmount, bumpJsonAmount, findInput, headerName, mutateCsvCell, mutateJsonInput, mutateXlsxColumn, splitCsvCells } from "./probes";
import type { InputFile } from "./runner";

const file = (name: string, text: string | Buffer): InputFile => ({ name, source: "fixture", bytes: Buffer.isBuffer(text) ? text : Buffer.from(text) });

describe("amount bumps", () => {
  it("keep decimals; Indian grouping and ₹ accepted; non-amounts are null", () => {
    expect(bumpAmountText("10,00,000")).toBe("1000001");
    expect(bumpAmountText("15000.00")).toBe("15001.00");
    expect(bumpAmountText("₹ 2,000.5", 10)).toBe("2010.5");
    expect(bumpAmountText("-2,000.50")).toBe("-1999.50");
    expect(bumpAmountText("abc")).toBeNull();
    expect(bumpAmountText("")).toBeNull();
    expect(bumpJsonAmount(100.5)).toBe(101.5);
    expect(bumpJsonAmount("1,000")).toBe("1001");
    expect(bumpJsonAmount(null)).toBeNull();
    expect(bumpCellAmount(0)).toBeUndefined();
    expect(bumpCellAmount("0.00")).toBeUndefined();
    expect(bumpCellAmount(12)).toBe(13);
    expect(bumpCellAmount("1,200")).toBe("1201");
    expect(headerName("GSTIN/UIN ")).toBe("gstin uin");
    expect(splitCsvCells('a,"b,c","d ""q"""')).toEqual(["a", "b,c", 'd "q"']);
  });
});

describe("mutateCsvCell", () => {
  const csv = "Title line\nDate,Party,IGST,CGST\n01-10,Acme,,9.00\n02-10,\"Beta, Ltd\",18.00,\n";
  it("finds the header below a title, tries candidate columns in order, changes one cell, keeps quoting", () => {
    const files = [file("purchase-register.csv", csv), file("other.csv", "x")];
    const out = mutateCsvCell(files, /purchase/i, ["IGST", "CGST"], (v) => (v.trim() ? bumpAmountText(v) : null));
    expect(out[0].bytes.toString()).toBe('Title line\nDate,Party,IGST,CGST\n01-10,Acme,,9.00\n02-10,"Beta, Ltd",19.00,\n');
    expect(out[1].bytes).not.toBe(files[1].bytes); // copies
    expect(files[0].bytes.toString()).toBe(csv); // original untouched
    const cgstOnly = mutateCsvCell([file("p.csv", "Party,CGST\nA,,\nB,5\n")], "p.csv", ["igst", "cgst"], (v) => (v.trim() ? bumpAmountText(v) : null));
    expect(cgstOnly[0].bytes.toString()).toBe("Party,CGST\nA,,\nB,6\n");
  });
  it("no file, no column or no changeable row → the same array back", () => {
    const files = [file("a.csv", "x,y\n1,2\n")];
    expect(mutateCsvCell(files, "b.csv", "x", () => "9")).toBe(files);
    expect(mutateCsvCell(files, "a.csv", "z", () => "9")).toBe(files);
    expect(mutateCsvCell(files, "a.csv", "x", () => null)).toBe(files);
    expect(findInput(files, /A\.CSV/i)?.name).toBe("a.csv");
  });
});

describe("mutateJsonInput", () => {
  it("edits a parsed copy; false or invalid JSON leaves the files", () => {
    const files = [file("profile.json", '{"d":"2026-11-20"}')];
    const out = mutateJsonInput(files, "profile.json", (p) => ((p.d = "2099-12-31"), true));
    expect(JSON.parse(out[0].bytes.toString())).toEqual({ d: "2099-12-31" });
    expect(mutateJsonInput(files, "profile.json", () => false)).toBe(files);
    expect(mutateJsonInput([file("x.json", "{bad")], "x.json", () => true)).toHaveLength(1);
  });
});

describe("mutateXlsxColumn", () => {
  it("changes the first data cell under the named header", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("TB");
    ws.addRow(["Company"]);
    ws.addRow(["Ledger", "Debit", "Credit"]);
    ws.addRow(["Cash", 0, null]);
    ws.addRow(["Bank", 1500, null]);
    const files = [file("Trial_Balance.xlsx", Buffer.from(await wb.xlsx.writeBuffer()))];
    const out = await mutateXlsxColumn(files, /trial/i, ["debit"], (v) => bumpCellAmount(v));
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(out[0].bytes as unknown as ArrayBuffer);
    expect(back.worksheets[0].getRow(4).getCell(2).value).toBe(1501);
    expect(await mutateXlsxColumn(files, /trial/i, ["nope"], (v) => bumpCellAmount(v))).toBe(files);
    expect(await mutateXlsxColumn([file("Trial.xlsx", "not a workbook")], /trial/i, ["debit"], () => 1)).toHaveLength(1);
  });
});
