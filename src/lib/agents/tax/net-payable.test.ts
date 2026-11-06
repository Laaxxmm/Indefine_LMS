// Formula re-audit NEW-6 (audited commit d20227f): the net payable subtracted advance / self-assessment
// tax rows dated AFTER the planned filing date, while s.234B ignored them. Both now use the same
// on-or-before-filing-date filter, and the pack says plainly which rows were not deducted.
import { describe, expect, it } from "vitest";
import { extractOf } from "./__fixtures__/base";
import { analyseTax } from "./analyse";
import { taxDeliverables } from "./deliverables";
import { taxFigures } from "./index";

const rs = (n: number) => Math.round(n * 100);
// Salary 20,00,000 − 75,000 = 19,25,000 (new regime); tax 1,85,000 + cess 7,400 = 1,92,400; no TDS → assessed 1,92,400.
const caseOf = (payments: { date: string; amount: string }[], filed = "2026-08-01") =>
  extractOf("clean-salaried-new", (o) => Object.assign(o, { tdsInBooks: [], otherSources: [], advanceTax: payments }) && Object.assign(o.salary, { gross: "20,00,000" }) && (o.profile.plannedFilingDate = filed), {
    files: { "26as.csv": "tan,deductor,section,amount_paid,tds_deposited\n" },
  });
const computationRows = (x: ReturnType<typeof caseOf>) => {
  const wb = taxDeliverables(x, [])[0] as { sheets: { name: string; rows: Record<string, unknown>[] }[] };
  return wb.sheets.find((s) => s.name === "Computation")!.rows;
};

describe("NEW-6: tax paid after the planned filing date does not reduce the net payable", () => {
  it("counterexample: 1,92,400 paid 5 Aug, filing planned 1 Aug → net payable 2,18,660 (was 26,260)", () => {
    const x = caseOf([{ date: "2026-08-05", amount: "1,92,400" }]);
    const a = analyseTax(x);
    // 234B ignores the payment (after filing): 1,92,400 × 1% × 5 months (Apr – Aug) = 9,620.
    expect(a.advance.i234B).toBe(rs(9_620));
    // 234C 9,712 (no instalment paid); 234A 1,92,400 × 1% × 1 = 1,924; 234F 5,000.
    expect([a.advance.i234C, a.i234A, a.fee234F]).toEqual([rs(9_712), rs(1_924), rs(5_000)]);
    // 1,92,400 + 1,924 + 9,620 + 9,712 + 5,000 = 2,18,656 → 2,18,660 (s.288B). Before: − 1,92,400 → 26,256 → 26,260.
    expect(a.netPayablePaise).toBe(rs(2_18_660));
    expect(a.advance).toMatchObject({ paidPaise: rs(1_92_400), paidAfterFilingPaise: rs(1_92_400), paidAfterFiling: [{ date: "2026-08-05", amountPaise: rs(1_92_400) }] });
    // The figure keeps every row the organiser lists (it is the advance-tax total, not the deduction).
    expect(taxFigures(x)).toMatchObject({ advanceTaxPaidPaise: rs(1_92_400), netPayablePaise: rs(2_18_660), interest234BPaise: rs(9_620) });
  });

  it("the pack says plainly what was not deducted, and deducts only the rows on or before the filing date", () => {
    const x = caseOf([
      { date: "2026-03-15", amount: "50,000" },
      { date: "2026-08-05", amount: "1,42,400" },
    ]);
    const rows = computationRows(x);
    expect(rows.find((r) => String(r.item).startsWith("Less: advance and self-assessment tax paid on or before"))?.chosen).toBe(50_000);
    const note = rows.find((r) => String(r.item).startsWith("Not deducted:"));
    expect(note?.item).toMatch(/^Not deducted: ₹1,42,400\.00 of tax paid after the planned filing date 01 Aug 2026 \(05 Aug 2026 ₹1,42,400\.00\)\. It does not reduce the amount payable on filing, and interest u\/s 234B ignores it too\./);
    expect(note?.chosen).toBeNull();
    const a = analyseTax(x);
    expect(a.netPayablePaise).toBe(Math.round((a.chosen.tax.total + a.i234A + a.advance.i234B + a.advance.i234C + a.fee234F - rs(50_000)) / 1000) * 1000);
  });

  it("boundary: a payment ON the filing date is deducted (and 234B counts it); no note, the usual label", () => {
    const x = caseOf([{ date: "2026-08-01", amount: "1,92,400" }]);
    const a = analyseTax(x);
    expect(a.advance.paidAfterFiling).toEqual([]);
    expect(a.advance.paidAfterFilingPaise).toBe(0);
    expect(a.netPayablePaise).toBe(Math.round((a.chosen.tax.total + a.i234A + a.advance.i234B + a.advance.i234C + a.fee234F - rs(1_92_400)) / 1000) * 1000);
    const rows = computationRows(x);
    expect(rows.find((r) => r.item === "Less: advance tax paid")?.chosen).toBe(1_92_400);
    expect(rows.some((r) => String(r.item).startsWith("Not deducted:"))).toBe(false);
  });
});
