import { describe, expect, it } from "vitest";
import type { InputFile } from "@/lib/agents/core/runner";
import { BOOKS_PROBE_TARGETS, TB_PROBE, probeCsvAmount } from "./probe";

const f = (name: string, text: string): InputFile => ({ name, source: "fixture", bytes: Buffer.from(text) });
const text = (files: InputFile[], name: string) => files.find((x) => x.name === name)!.bytes.toString("utf8");

describe("probeCsvAmount (input-sensitivity probe)", () => {
  it("raises the first non-zero TB amount by ₹1 and leaves the original untouched (copy)", () => {
    const files = [f("trial-balance.csv", 'Title row\nParticulars,Group,Debit,Credit\nShare Capital,Capital Account,,"5,00,000.00"\nCash,Cash-in-Hand,"1,000.00",')];
    const out = probeCsvAmount(files, BOOKS_PROBE_TARGETS);
    expect(text(out, "trial-balance.csv")).toBe("Title row\nParticulars,Group,Debit,Credit\nShare Capital,Capital Account,,500001.00\nCash,Cash-in-Hand,\"1,000.00\",\n");
    expect(text(files, "trial-balance.csv")).toContain('"5,00,000.00"');
    expect(out).not.toBe(files);
  });
  it("negative / Cr amounts move away from zero; totals, opening and zero rows are skipped", () => {
    // A Dr / Cr marker is kept and the magnitude raised: "500.00 Cr" → "501.00 Cr" (−501 in the books reading, as before).
    const out = probeCsvAmount([f("tb.csv", "Ledger,Closing Balance\nGrand Total,100\nOpening Balance,5\nZero,0\nLoan,500.00 Cr")], [TB_PROBE]);
    expect(text(out, "tb.csv")).toContain("Loan,501.00 Cr");
    expect(text(probeCsvAmount([f("tb.csv", "Ledger,Closing Balance\nLoan,-500.00")], [TB_PROBE]), "tb.csv")).toContain("Loan,-501.00");
  });
  it("a bank statement's signed Amount keeps its marker (statement Cr = money in): +₹1 in magnitude, never a sign flip", () => {
    const out = probeCsvAmount([f("bank-statement.csv", 'Date,Narration,Amount\n03/10/2026,NEFT IN,"1,50,000.00 Cr"\n05/10/2026,CHQ,"500.00 Dr"')], [BOOKS_PROBE_TARGETS[1]]);
    expect(text(out, "bank-statement.csv")).toBe('Date,Narration,Amount\n03/10/2026,NEFT IN,150001.00 Cr\n05/10/2026,CHQ,500.00 Dr\n');
  });
  it("honours column-map.json for unusual TB headers", () => {
    const files = [f("column-map.json", JSON.stringify({ tb: { ledger: "Account Head", debit: "Dr Total", credit: "Cr Total" } })), f("trial-balance.csv", "Account Head,Dr Total,Cr Total\nCash,10.00,")];
    expect(text(probeCsvAmount(files, BOOKS_PROBE_TARGETS), "trial-balance.csv")).toContain("Cash,11.00,");
    const broken = [f("column-map.json", "{nope"), f("trial-balance.csv", "Account Head,Dr Total\nCash,10.00")];
    expect(probeCsvAmount(broken, BOOKS_PROBE_TARGETS)).toBe(broken);
    const notObject = [f("column-map.json", "5"), f("trial-balance.csv", "Account Head,Dr Total\nCash,10.00")];
    expect(probeCsvAmount(notObject, BOOKS_PROBE_TARGETS)).toBe(notObject);
  });
  it("an XLSX trial balance is skipped (sync contract): the next CSV target is used; the prior TB is never probed", () => {
    const files = [
      f("Trial_Balance.xlsx", "PK..."),
      f("trial-balance-prior.csv", "Ledger,Debit\nRent,100"),
      f("tds-deducted.csv", "Section,Deductee,Date,TDS Amount\n194J,X,10/10/2026,2000.00"),
      f("tds-challans.csv", "Challan No,Section,Deposit Date,Amount\nC1,194J,06/11/2026,2000.00"),
    ];
    const out = probeCsvAmount(files, BOOKS_PROBE_TARGETS);
    expect(text(out, "tds-deducted.csv")).toContain("194J,X,10/10/2026,2001.00");
    expect(text(out, "tds-challans.csv")).toContain("2000.00");
    expect(text(out, "trial-balance-prior.csv")).toContain("Rent,100");
  });
  it("bank statement, bank ledger and GST fall-backs; quoting is preserved for cells with commas", () => {
    expect(text(probeCsvAmount([f("hdfc-statement.csv", 'Date,Narration,Withdrawal,Deposit\n01/10/2026,"A, B",50.00,')], BOOKS_PROBE_TARGETS), "hdfc-statement.csv")).toBe('Date,Narration,Withdrawal,Deposit\n01/10/2026,"A, B",51.00,\n');
    expect(text(probeCsvAmount([f("bank-ledger.csv", "Date,Particulars,Debit,Credit\n01/10/2026,R,,5.00")], BOOKS_PROBE_TARGETS), "bank-ledger.csv")).toContain("R,,6.00");
    expect(text(probeCsvAmount([f("gst-ledger.csv", "Ledger,Amount\nOutput CGST,9.00")], BOOKS_PROBE_TARGETS), "gst-ledger.csv")).toContain("Output CGST,10.00");
  });
  it("nothing eligible → the same array back (the harness reports 'unchanged')", () => {
    const files = [f("notes.txt", "x"), f("trial-balance.csv", "nothing,here\n1,2")];
    expect(probeCsvAmount(files, BOOKS_PROBE_TARGETS)).toBe(files);
  });
});
