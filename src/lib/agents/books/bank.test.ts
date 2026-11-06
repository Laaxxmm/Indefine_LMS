import { describe, expect, it } from "vitest";
import { LEDGER_ALIASES, STATEMENT_ALIASES, columnCell, normRef, parseBank, reconcile, signedCell, type BankData, type BankLine } from "./bank";
import { parseCsv } from "./table";

const line = (id: string, date: string, amountPaise: number, ref = "", narration = id): BankLine => ({ id, row: Number(id.slice(1)) + 1, date, narration, ref, amountPaise });
const data = (lines: BankLine[], openingPaise: number | null = null): BankData => ({ file: "x.csv", lines, openingPaise });

describe("parseBank", () => {
  it("statement: withdrawal / deposit columns, opening row, closing rows skipped", () => {
    const rows = parseCsv(
      [
        "Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance",
        "01/10/2026,OPENING BALANCE,,,,\"2,50,000.00\"",
        "03/10/2026,NEFT IN,UTR1,,\"1,000.00\",\"2,51,000.00\"",
        "04/10/2026,CHQ OUT,000451,\"500.00\",,\"2,50,500.00\"",
        ",Closing Balance,,,,\"2,50,500.00\"",
        ",,,,,",
      ].join("\n"),
    );
    const { data: d, issues } = parseBank("S", "stmt.csv", rows, STATEMENT_ALIASES);
    expect(issues).toEqual([]);
    expect(d!.openingPaise).toBe(25000000);
    expect(d!.lines).toEqual([
      { id: "S1", row: 3, date: "2026-10-03", narration: "NEFT IN", ref: "UTR1", amountPaise: 100000 },
      { id: "S2", row: 4, date: "2026-10-04", narration: "CHQ OUT", ref: "000451", amountPaise: -50000 },
    ]);
  });
  it("statement without an opening row derives it from the first running balance", () => {
    const { data: d } = parseBank("S", "s.csv", parseCsv("Date,Description,Debit,Credit,Balance\n02/10/2026,X,100.00,,900.00"), STATEMENT_ALIASES);
    expect(d!.openingPaise).toBe(100000);
  });
  it("ledger: Debit = money in, Credit = money out; signed Amount column", () => {
    const { data: d } = parseBank("L", "l.csv", parseCsv("Date,Particulars,Vch No,Debit,Credit\n01/10/2026,Opening Balance,,50.00,\n02/10/2026,Receipt,1,10.00,\n03/10/2026,Payment,2,,4.00"), LEDGER_ALIASES);
    expect(d!.openingPaise).toBe(5000);
    expect(d!.lines.map((l) => l.amountPaise)).toEqual([1000, -400]);
    const signed = parseBank("S", "s.csv", parseCsv("Date,Narration,Amount\n02/10/2026,A,-12.50\n03/10/2026,B,7"), STATEMENT_ALIASES).data!;
    expect(signed.lines.map((l) => l.amountPaise)).toEqual([-1250, 700]);
    expect(signed.openingPaise).toBeNull();
  });
  it("reports bad dates, bad amounts, zero lines and a missing header", () => {
    const { data: d, issues } = parseBank("S", "s.csv", parseCsv("Date,Narration,Withdrawal,Deposit\n32/10/2026,A,1,\n02/10/2026,B,x,\n03/10/2026,C,,\n04/10/2026,D,1,"), STATEMENT_ALIASES);
    expect(issues.map((i) => i.row)).toEqual([2, 3, 4]);
    expect(d!.lines).toHaveLength(1);
    expect(parseBank("S", "s.csv", parseCsv("a,b\n1,2"), STATEMENT_ALIASES).data).toBeNull();
  });
  it("an opening row with only a balance uses the balance", () => {
    const { data: d } = parseBank("L", "l.csv", parseCsv("Date,Particulars,Debit,Credit,Balance\n,B/F,,,75.00\n02/10/2026,X,1,,"), LEDGER_ALIASES);
    expect(d!.openingPaise).toBe(7500);
  });
});

describe("parseBank — Cr / Dr on balances (statement: bank wording; ledger: books wording)", () => {
  const stmt = (csv: string) => parseBank("S", "s.csv", parseCsv(csv), STATEMENT_ALIASES);
  it("audit counterexample: Deposit 1,000.00 with Balance '5,000.00 Cr' → opening +4,000.00 (was −6,000.00)", () => {
    const { data: d, issues } = stmt('Date,Narration,Withdrawal,Deposit,Balance\n02/10/2026,NEFT IN,,"1,000.00","5,000.00 Cr"');
    expect(issues).toEqual([]);
    expect(d!.openingPaise).toBe(400000);
    expect(d!.lines.map((l) => l.amountPaise)).toEqual([100000]);
  });
  it("audit counterexample: opening row '4,000.00 Cr' → +4,000.00 (was −4,000.00)", () => {
    expect(stmt('Date,Narration,Withdrawal,Deposit,Balance\n01/10/2026,Opening Balance,,,"4,000.00 Cr"\n02/10/2026,X,1.00,,"3,999.00 Cr"').data!.openingPaise).toBe(400000);
    expect(stmt('Date,Narration,Withdrawal,Deposit,Balance\n01/10/2026,Opening Balance,,,"Cr 4,000.00"').data!.openingPaise).toBe(400000);
  });
  it("overdraft statement: Dr balances are negative, on the opening row and on the first running balance", () => {
    expect(stmt('Date,Narration,Withdrawal,Deposit,Balance\n01/10/2026,Opening Balance,,,"2,000.00 Dr"').data!.openingPaise).toBe(-200000);
    // First row: withdrawal 500, balance 2,500.00 Dr → opening = −2,50,000 − (−50,000) = −2,00,000 paise.
    const derived = stmt('Date,Narration,Withdrawal,Deposit,Balance\n02/10/2026,CHQ OUT,500.00,,"2,500.00 Dr"\n03/10/2026,NEFT IN,,"3,000.00","500.00 Cr"').data!;
    expect(derived.openingPaise).toBe(-200000);
    // An overdrawn account (ledger opening on the credit side) reconciles to zero.
    const ledger = parseBank("L", "l.csv", parseCsv('Date,Particulars,Debit,Credit\n01/10/2026,Opening Balance,,"2,000.00"\n02/10/2026,Chq,,500.00\n03/10/2026,Receipt,"3,000.00",'), LEDGER_ALIASES).data!;
    expect(ledger.openingPaise).toBe(-200000);
    const r = reconcile(derived, ledger);
    expect(r.summary).toMatchObject({ balancePerBankPaise: 50000, balancePerBooksPaise: 50000, differencePaise: 0 });
  });
  it("statement opening row in the Deposit / Withdrawal / Amount column: the bank's marker never flips the sign", () => {
    expect(stmt('Date,Narration,Withdrawal,Deposit\n01/10/2026,Opening Balance,,"4,000.00 Cr"').data!.openingPaise).toBe(400000);
    expect(stmt('Date,Narration,Withdrawal,Deposit\n01/10/2026,Opening Balance,"4,000.00 Dr",').data!.openingPaise).toBe(-400000);
    expect(stmt('Date,Narration,Amount\n01/10/2026,Opening Balance,"4,000.00 Cr"').data!.openingPaise).toBe(400000);
    expect(stmt('Date,Narration,Amount\n01/10/2026,Opening Balance,"4,000.00 Dr"').data!.openingPaise).toBe(-400000);
  });
  it("unmarked statement balances are unchanged: plain = in credit, minus = overdrawn", () => {
    expect(stmt('Date,Narration,Withdrawal,Deposit,Balance\n02/10/2026,X,100.00,,"-2,100.00"').data!.openingPaise).toBe(-200000);
    expect(stmt('Date,Narration,Withdrawal,Deposit,Balance\n01/10/2026,Opening Balance,,,"0.00 Cr"').data!.openingPaise).toBe(0);
  });
  it("ledger keeps the books wording: balance Cr = negative, Dr = positive", () => {
    const led = (bal: string) => parseBank("L", "l.csv", parseCsv(`Date,Particulars,Debit,Credit,Balance\n,Opening Balance,,,"${bal}"\n02/10/2026,X,1,,`), LEDGER_ALIASES).data!.openingPaise;
    expect(led("75.00 Cr")).toBe(-7500);
    expect(led("75.00 Dr")).toBe(7500);
  });
});

describe("Cr / Dr conventions on amounts (statement: Cr = in +, Dr = out −; ledger: Dr = increase +, Cr = decrease −)", () => {
  const stmt = (csv: string) => parseBank("S", "s.csv", parseCsv(csv), STATEMENT_ALIASES);
  const led = (csv: string) => parseBank("L", "l.csv", parseCsv(csv), LEDGER_ALIASES);
  const amounts = (r: ReturnType<typeof parseBank>) => r.data!.lines.map((l) => l.amountPaise);

  it.each([
    // [side, cell, expected paise | "conflict"]
    ["S", "1,000.00 Cr", 100000],
    ["S", "500.00 Dr", -50000],
    ["S", "Cr 1,000.00", 100000],
    ["S", "Dr. 500", -50000],
    ["S", "500.00 dr", -50000],
    ["S", "-500.00 Dr", -50000], // the minus agrees with Dr: redundant
    ["S", "(500.00) Dr", -50000],
    ["S", "-500.00 Cr", "conflict"],
    ["S", "-12.50", -1250], // unmarked: as written
    ["S", "7", 700],
    ["S", "0.00 Dr", 0],
    ["L", "1,000.00 Dr", 100000],
    ["L", "500.00 Cr", -50000],
    ["L", "-500.00 Cr", -50000], // redundant minus (parseAmountPaise alone gives +500)
    ["L", "-500.00 Dr", "conflict"],
    ["L", "-4", -400],
  ] as const)("signedCell %s %s → %s", (side, text, want) => {
    const p = signedCell(side, text);
    if (want === "conflict") expect(p).toMatchObject({ ok: false, conflict: true });
    else expect(p).toEqual({ ok: true, paise: want });
  });

  it.each([
    // [side, column, cell, expected paise as written in the column | "conflict"]
    ["S", "in", "1,000.00 Cr", 100000], // Deposit marked Cr: agrees, not flipped (parseAmountPaise alone gives −1,000)
    ["S", "out", "500.00 Dr", 50000],
    ["S", "in", "1,000.00 Dr", "conflict"],
    ["S", "out", "500.00 Cr", "conflict"],
    ["L", "in", "1,000.00 Dr", 100000],
    ["L", "out", "500.00 Cr", 50000], // Credit marked Cr: agrees, not flipped (parseAmountPaise alone gives −500)
    ["L", "in", "1,000.00 Cr", "conflict"],
    ["L", "out", "500.00 Dr", "conflict"],
    ["L", "out", "-500.00", -50000], // unmarked minus inside a column = a reversal, as before
    ["S", "in", "", 0],
  ] as const)("columnCell %s %s %s → %s", (side, column, text, want) => {
    const p = columnCell(side, column, text);
    if (want === "conflict") expect(p).toMatchObject({ ok: false, conflict: true });
    else expect(p).toEqual({ ok: true, paise: want });
  });

  it("audit counterexample: statement signed Amount '1,000.00 Cr' is money in (+1,000), '500.00 Dr' money out (was −1,000 / +500)", () => {
    const r = stmt('Date,Narration,Amount,Balance\n02/10/2026,NEFT IN,"1,000.00 Cr","5,000.00 Cr"\n03/10/2026,CHQ 451,"500.00 Dr","4,500.00 Cr"');
    expect(r.issues).toEqual([]);
    expect(amounts(r)).toEqual([100000, -50000]);
    expect(r.data!.openingPaise).toBe(400000); // 5,000 Cr − 1,000 in (old: 5,000 − (−1,000) = 6,000)
  });
  it("audit counterexample: ledger Credit '500.00 Cr' is a payment (−500), not a receipt (+500); Debit '1,000.00 Dr' +1,000", () => {
    const r = led('Date,Particulars,Debit,Credit\n01/10/2026,Opening Balance,"5,000.00 Dr",\n02/10/2026,Receipt,"1,000.00 Dr",\n03/10/2026,Chq 451,,"500.00 Cr"');
    expect(r.issues).toEqual([]);
    expect(r.data!.openingPaise).toBe(500000);
    expect(amounts(r)).toEqual([100000, -50000]);
  });
  it("statement Withdrawal / Deposit with redundant markers read like unmarked ones", () => {
    const marked = stmt('Date,Narration,Withdrawal,Deposit,Balance\n02/10/2026,NEFT IN,,"1,000.00 Cr","5,000.00 Cr"\n03/10/2026,CHQ,"500.00 Dr",,"4,500.00 Cr"');
    const plain = stmt('Date,Narration,Withdrawal,Deposit,Balance\n02/10/2026,NEFT IN,,"1,000.00","5,000.00 Cr"\n03/10/2026,CHQ,"500.00",,"4,500.00 Cr"');
    expect(marked.issues).toEqual([]);
    expect(marked.data).toEqual(plain.data);
    expect(amounts(marked)).toEqual([100000, -50000]);
  });
  it("ledger signed Amount: Dr +, Cr −, a redundant minus does not flip twice", () => {
    expect(amounts(led('Date,Particulars,Amount\n02/10/2026,R,"1,000.00 Dr"\n03/10/2026,P,"500.00 Cr"\n04/10/2026,P2,"-250.00 Cr"\n05/10/2026,R2,75'))).toEqual([100000, -50000, -25000, 7500]);
  });
  it("a marker that contradicts its column (or its own minus sign) is an issue and the row is not read", () => {
    const s = stmt('Date,Narration,Withdrawal,Deposit\n02/10/2026,A,,"1,000.00 Dr"\n03/10/2026,B,"500.00 Cr",\n04/10/2026,C,"10.00",');
    expect(s.issues.map((i) => [i.row, i.message])).toEqual([
      [2, '"1,000.00 Dr": a "Dr" marker in the "Deposit" column contradicts the column'],
      [3, '"500.00 Cr": a "Cr" marker in the "Withdrawal" column contradicts the column'],
    ]);
    expect(amounts(s)).toEqual([-1000]);
    const l = led('Date,Particulars,Debit,Credit\n01/10/2026,Opening Balance,"5,000.00 Cr",\n02/10/2026,X,,"4.00 Dr"\n03/10/2026,Y,"-9.00 Dr",');
    expect(l.issues.map((i) => i.row)).toEqual([2, 3]);
    expect(l.data!.openingPaise).toBeNull(); // the opening row is not read either
    expect(amounts(l)).toEqual([-900]); // "-9.00 Dr" in the Debit column: Dr agrees; the minus is a reversal, as unmarked
    expect(amounts(stmt('Date,Narration,Amount\n02/10/2026,A,"-500.00 Cr"\n03/10/2026,B,"5.00 Cr"'))).toEqual([500]);
  });
  it("a contradictory balance is reported but the transaction is still read (the balance is not used)", () => {
    const r = stmt('Date,Narration,Amount,Balance\n02/10/2026,A,"1,000.00 Cr","-5,000.00 Cr"\n03/10/2026,B,"10.00 Dr","4,990.00 Cr"');
    expect(r.issues.map((i) => [i.row, i.message])).toEqual([[2, '"-5,000.00 Cr": a minus sign with "Cr" contradicts the marker (statement: Cr = money in)']]);
    expect(amounts(r)).toEqual([100000, -1000]);
  });
  it("overdraft both ways reconciles to zero: statement Amount / Balance with Dr markers; ledger opening in Credit with a redundant Cr", () => {
    // Statement: first row 500.00 Dr out, balance 2,500.00 Dr → opening −2,500 − (−500) = −2,000; then 3,000.00 Cr in → 500.00 Cr.
    const s = stmt('Date,Narration,Ref,Amount,Balance\n02/10/2026,CHQ OUT,451,"500.00 Dr","2,500.00 Dr"\n03/10/2026,NEFT IN,U1,"3,000.00 Cr","500.00 Cr"').data!;
    expect(s.openingPaise).toBe(-200000);
    expect(s.lines.map((x) => x.amountPaise)).toEqual([-50000, 300000]);
    // Ledger: opening 2,000.00 Cr in the Credit column (overdrawn in the books) = −2,000 (old code: +2,000).
    const l = led('Date,Particulars,Vch No,Debit,Credit\n01/10/2026,Opening Balance,,,"2,000.00 Cr"\n02/10/2026,Chq,451,,"500.00 Cr"\n03/10/2026,Receipt,U1,"3,000.00 Dr",').data!;
    expect(l.openingPaise).toBe(-200000);
    const r = reconcile(s, l);
    expect(r.pairs).toHaveLength(2);
    expect(r.summary).toMatchObject({ balancePerBankPaise: 50000, balancePerBooksPaise: 50000, differencePaise: 0 });
  });
});

describe("normRef", () => {
  it.each([
    ["000451", "451"],
    ["CHQ 000123", "CHQ123"],
    ["utr-001", "UTR1"],
    ["", ""],
    ["N4411", "N4411"],
  ])("%s → %s", (a, b) => expect(normRef(a)).toBe(b));
});

describe("reconcile — matching algorithm", () => {
  it("pass 1 matches on reference + amount within the reference window (31 days)", () => {
    const r = reconcile(data([line("S1", "2026-10-30", -500, "CHQ 451")]), data([line("L1", "2026-09-30", -500, "451"), line("L2", "2026-10-29", -500, "chq451")]));
    expect(r.pairs).toEqual([{ statementId: "S1", ledgerId: "L2", method: "reference", gapDays: 1 }]);
  });
  it("pass 2: amount + date within 5 days matches; 6 days does not (boundary)", () => {
    const five = reconcile(data([line("S1", "2026-10-10", -100)]), data([line("L1", "2026-10-05", -100)]));
    expect(five.pairs[0]).toMatchObject({ method: "amount-date", gapDays: 5 });
    const six = reconcile(data([line("S1", "2026-10-11", -100)]), data([line("L1", "2026-10-05", -100)]));
    expect(six.pairs).toEqual([]);
    expect(six.amountOnly).toEqual([{ statementId: "S1", ledgerIds: ["L1"] }]);
  });
  it("conflicting references never match in pass 2", () => {
    const r = reconcile(data([line("S1", "2026-10-10", -100, "A1")]), data([line("L1", "2026-10-10", -100, "B2")]));
    expect(r.pairs).toEqual([]);
  });
  it("sign matters: a receipt never matches a payment of the same size", () => {
    expect(reconcile(data([line("S1", "2026-10-10", 100)]), data([line("L1", "2026-10-10", -100)])).pairs).toEqual([]);
  });
  it("ties go to the smallest gap, then the earlier ledger line", () => {
    const r = reconcile(data([line("S1", "2026-10-10", -100)]), data([line("L2", "2026-10-08", -100), line("L1", "2026-10-12", -100), line("L3", "2026-10-09", -100)]));
    expect(r.pairs[0].ledgerId).toBe("L3");
    const tie = reconcile(data([line("S1", "2026-10-10", -100)]), data([line("L1", "2026-10-12", -100), line("L2", "2026-10-08", -100)]));
    expect(tie.pairs[0].ledgerId).toBe("L2"); // equal gap 2: L2 is earlier by date
  });
  it("is order-independent of the input line order (lines are sorted by date, row)", () => {
    const a = reconcile(data([line("S1", "2026-10-03", -100), line("S2", "2026-10-04", -100)]), data([line("L1", "2026-10-03", -100)]));
    const b = reconcile(data([line("S2", "2026-10-04", -100), line("S1", "2026-10-03", -100)]), data([line("L1", "2026-10-03", -100)]));
    expect(a.pairs).toEqual(b.pairs);
    expect(a.pairs[0].statementId).toBe("S1");
  });
  it("finds duplicates on either side and computes the BRS", () => {
    const S = [line("S1", "2026-10-03", 1000, "U1", "NEFT"), line("S2", "2026-10-03", 1000, "U1", "NEFT"), line("S3", "2026-10-31", -50, "", "CHARGES")];
    const L = [line("L1", "2026-10-03", 1000, "U1", "Receipt"), line("L2", "2026-10-29", -300, "452", "Chq 452"), line("L3", "2026-10-30", 200, "", "Deposit")];
    const r = reconcile(data(S, 5000), data(L, 5000));
    expect(r.duplicates).toEqual([{ side: "statement", ids: ["S1", "S2"] }]);
    expect(r.unmatchedStatement.map((x) => x.id)).toEqual(["S2", "S3"]);
    expect(r.summary).toEqual({
      statementOpeningPaise: 5000,
      ledgerOpeningPaise: 5000,
      balancePerBankPaise: 5000 + 1000 + 1000 - 50,
      balancePerBooksPaise: 5000 + 1000 - 300 + 200,
      unpresentedPaise: 300,
      unclearedPaise: 200,
      bankCreditsNotInBooksPaise: 1000,
      bankDebitsNotInBooksPaise: 50,
      adjustedBooksPaise: 5900 + 300 - 200 + 1000 - 50,
      differencePaise: 0,
    });
  });
  it("difference equals statement opening − ledger opening; null without openings", () => {
    const r = reconcile(data([line("S1", "2026-10-03", 10)], 700), data([line("L1", "2026-10-03", 10)], 500));
    expect(r.summary.differencePaise).toBe(200);
    expect(reconcile(data([], null), data([], 0)).summary.differencePaise).toBeNull();
    expect(reconcile(data([], 0), data([], null)).summary.adjustedBooksPaise).toBeNull();
  });
});
