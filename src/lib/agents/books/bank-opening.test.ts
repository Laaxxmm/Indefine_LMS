// Formula re-audit NEW-3 (audited commit d20227f): a statement with no opening row whose first line
// has no balance cell took its opening from a later row by subtracting only that row's amount — a
// false opening, a false BRS difference and a false block (books.bank-recon-difference).
import { describe, expect, it } from "vitest";
import { LEDGER_ALIASES, STATEMENT_ALIASES, parseBank, reconcile } from "./bank";
import { parseCsv } from "./table";

const stmt = (csv: string) => parseBank("S", "s.csv", parseCsv(csv), STATEMENT_ALIASES);
const HEADER = "Date,Narration,Chq No,Withdrawal,Deposit,Balance";

describe("NEW-3: statement opening when the first line has no balance", () => {
  it("the auditor's counterexample: 01/10 deposit 1,000 (no balance), 02/10 deposit 2,000 balance 7,000 Cr → opening 4,000 (was 5,000)", () => {
    const { data, issues } = stmt(`${HEADER}\n01/10/2026,NEFT A,,,"1,000.00",\n02/10/2026,NEFT B,,,"2,000.00","7,000.00 Cr"`);
    expect(issues).toEqual([]);
    expect(data!.lines.map((l) => l.amountPaise)).toEqual([100000, 200000]);
    expect(data!.openingPaise).toBe(400000);
    // The balance per bank now equals the printed closing balance.
    expect(data!.openingPaise! + data!.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(700000);
  });

  it("the BRS against a ledger that opens at 4,000 ties (before: a false ₹1,000 difference, a block)", () => {
    const s = stmt(`${HEADER}\n01/10/2026,NEFT A,,,"1,000.00",\n02/10/2026,NEFT B,,,"2,000.00","7,000.00 Cr"`).data!;
    const l = parseBank("L", "l.csv", parseCsv('Date,Particulars,Vch No,Debit,Credit\n,Opening Balance,,"4,000.00",\n01/10/2026,NEFT A,1,"1,000.00",\n02/10/2026,NEFT B,2,"2,000.00",'), LEDGER_ALIASES).data!;
    expect(reconcile(s, l).summary).toMatchObject({ statementOpeningPaise: 400000, ledgerOpeningPaise: 400000, balancePerBankPaise: 700000, balancePerBooksPaise: 700000, differencePaise: 0 });
  });

  it("withdrawals and several balance-less lines count too; the first printed balance decides, later ones are ignored", () => {
    // Opening 10,000: −2,500 → 7,500 (blank), +500 → 8,000 (blank), −1,000 → 7,000 printed, +3,000 → 10,000 printed.
    const { data } = stmt(`${HEADER}\n01/10/2026,CHQ,11,"2,500.00",,\n02/10/2026,UPI,,,500.00,\n03/10/2026,ATM,,"1,000.00",,"7,000.00"\n04/10/2026,NEFT,,,"3,000.00","10,000.00 Cr"`);
    expect(data!.openingPaise).toBe(1000000);
  });

  it("an overdrawn running balance (Dr) after balance-less lines", () => {
    // Opening −2,000 (overdrawn): −500 (blank) → −2,500; +1,000 → −1,500 printed "1,500.00 Dr".
    expect(stmt(`${HEADER}\n01/10/2026,CHQ,9,500.00,,\n02/10/2026,NEFT,,,"1,000.00","1,500.00 Dr"`).data!.openingPaise).toBe(-200000);
  });

  it("rows that are not read (no amount, unreadable date) are not counted; an opening row still wins", () => {
    const { data, issues } = stmt(`${HEADER}\n01/10/2026,NOTE,,,,\n32/10/2026,BAD,,,50.00,\n02/10/2026,NEFT,,,"2,000.00","7,000.00 Cr"`);
    expect(issues.map((i) => i.row)).toEqual([2, 3]);
    expect(data!.openingPaise).toBe(500000);
    expect(stmt(`${HEADER}\n,Opening Balance,,,,"4,500.00 Cr"\n01/10/2026,NEFT A,,,"1,000.00",\n02/10/2026,NEFT B,,,"2,000.00","7,000.00 Cr"`).data!.openingPaise).toBe(450000);
  });

  it("no balance printed on any line → the opening stays unknown (unchanged), so the BRS difference is not computed", () => {
    const s = stmt(`${HEADER}\n01/10/2026,NEFT A,,,"1,000.00",\n02/10/2026,NEFT B,,,"2,000.00",`).data!;
    expect(s.openingPaise).toBeNull();
    const l = parseBank("L", "l.csv", parseCsv('Date,Particulars,Vch No,Debit,Credit\n,Opening Balance,,"4,000.00",\n01/10/2026,NEFT A,1,"1,000.00",'), LEDGER_ALIASES).data!;
    expect(reconcile(s, l).summary.differencePaise).toBeNull();
  });

  it("the ledger never derives an opening from its running balance", () => {
    expect(parseBank("L", "l.csv", parseCsv('Date,Particulars,Vch No,Debit,Credit,Balance\n01/10/2026,A,1,"1,000.00",,\n02/10/2026,B,2,"2,000.00",,"7,000.00 Dr"'), LEDGER_ALIASES).data!.openingPaise).toBeNull();
  });
});
