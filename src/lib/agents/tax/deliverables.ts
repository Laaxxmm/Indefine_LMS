// Tax deliverable: one workbook — computation of income (old vs new regime for individuals /
// HUFs), 26AS vs books, AIS vs books, advance tax with 234B/234C, capital gains, s.43B(h),
// audit + ITR form, missing documents, checklist and verify notes. Draft for review; the
// return is prepared and filed by a person on the income-tax portal.
import type { ChecklistResultItem } from "@/lib/agents/core/checklist";
import { formatDayKey } from "@/lib/agents/core/format";
import type { DeliverableDraft } from "@/lib/agents/core/runner";
import type { RowSpec, SheetSpec } from "@/lib/agents/core/templates";
import { checklistSheet } from "@/lib/agents/roc/deliverables";
import { analyseTax, type RegimeResult, type TaxAnalysis, type TaxExtract } from "./analyse";
import { taxVerifyNotes } from "./data";

export const TAX_WORKBOOK_TITLE = "Tax computation";
const r = (paise: number) => paise / 100;

function computationSheet(a: TaxAnalysis): SheetSpec {
  const chosen = a.chosen;
  const line = (label: string, f: (x: RegimeResult) => number): RowSpec => ({
    item: label,
    chosen: r(f(chosen)),
    old: a.old ? r(f(a.old)) : null,
    new: a.personal ? r(f(a.new)) : null,
  });
  const rows: RowSpec[] = [
    line("Income from salary", (x) => x.salary),
    line("Income from house property", (x) => x.houseProperty),
    line("Profits and gains of business or profession", (x) => x.business),
    line("Short-term capital gains (slab rate)", (x) => x.cg.stcgOther),
    line("Short-term capital gains u/s 111A", (x) => x.cg.stcg111A),
    line("Long-term capital gains u/s 112", (x) => x.cg.ltcg112),
    line("Long-term capital gains u/s 112A", (x) => x.cg.ltcg112A),
    line("Income from other sources", (x) => x.otherSources),
    line("Gross total income", (x) => x.grossTotalIncome),
    line("Deductions under Chapter VI-A", (x) => x.deductionsAllowed),
    line("Total income (rounded u/s 288A)", (x) => x.totalIncome),
    line("Tax at normal rates", (x) => x.tax.normalTax),
    line("Tax at special rates", (x) => x.tax.specialTax),
    line("Rebate u/s 87A", (x) => x.tax.rebate),
    line("Surcharge", (x) => x.tax.surcharge),
    line("Marginal relief", (x) => x.tax.marginalRelief),
    line("Health and education cess", (x) => x.tax.cess),
    line("Tax liability", (x) => x.tax.total),
  ];
  const fixed = (item: string, paise: number): RowSpec => ({ item, chosen: r(paise), old: null, new: null });
  rows.push(
    fixed("Less: TDS credit (lower of books and 26AS)", a.tds.credit),
    fixed("Less: advance tax paid", a.advance.paidPaise),
    fixed("Add: interest u/s 234A", a.i234A),
    fixed("Add: interest u/s 234B", a.advance.i234B),
    fixed("Add: interest u/s 234C", a.advance.i234C),
    fixed("Add: fee u/s 234F", a.fee234F),
    fixed("Net payable / (refund), rounded u/s 288B", a.netPayablePaise),
  );
  return {
    name: "Computation",
    columns: [
      { key: "item", header: "Particulars", width: 46 },
      { key: "chosen", header: "Amount (regime used)", type: "inr" },
      { key: "old", header: "Old regime", type: "inr" },
      { key: "new", header: "New regime", type: "inr" },
    ],
    rows,
  };
}

function tdsSheet(a: TaxAnalysis): SheetSpec {
  return {
    name: "26AS vs books",
    columns: [
      { key: "tan", header: "TAN" },
      { key: "deductor", header: "Deductor", width: 30 },
      { key: "books", header: "TDS per books", type: "inr" },
      { key: "f26", header: "TDS per 26AS", type: "inr" },
      { key: "diff", header: "Difference", type: "inr" },
      { key: "credit", header: "Credit claimed", type: "inr" },
    ],
    rows: a.tds.rows.map((t) => ({ tan: t.tan, deductor: t.deductor, books: r(t.books), f26: r(t.form26as), diff: r(t.diff), credit: r(t.credit) })),
    totals: true,
  };
}

function aisSheet(a: TaxAnalysis): SheetSpec {
  return {
    name: "AIS vs books",
    columns: [
      { key: "id", header: "AIS id" },
      { key: "category", header: "Category" },
      { key: "source", header: "Source", width: 28 },
      { key: "amount", header: "AIS amount", type: "inr" },
      { key: "book", header: "Books ledger" },
      { key: "unexplained", header: "Not explained", type: "inr" },
      { key: "note", header: "Result", width: 50 },
    ],
    rows: a.ais.rows.map((x) => ({ id: x.line.id, category: x.line.category, source: x.line.source, amount: r(x.line.amountPaise), book: x.bookId ?? "", unexplained: r(x.unexplainedPaise), note: x.note })),
    totals: true,
  };
}

function advanceSheet(a: TaxAnalysis): SheetSpec {
  const rows: RowSpec[] = a.advance.rows.map((i) => ({ date: i.date, required: `${i.requiredBp / 100}%`, due: r(i.requiredPaise), paid: r(i.paidPaise), shortfall: r(i.shortfallPaise), months: String(i.months), interest: r(i.interestPaise) }));
  rows.push({ date: null, required: "234B", due: r(a.advance.assessedTaxPaise), paid: r(a.advance.paidPaise), shortfall: null, months: "", interest: r(a.advance.i234B) });
  return {
    name: "Advance tax",
    columns: [
      { key: "date", header: "Instalment date", type: "date" },
      { key: "required", header: "Cumulative %" },
      { key: "due", header: "Tax due", type: "inr" },
      { key: "paid", header: "Paid by date", type: "inr" },
      { key: "shortfall", header: "Shortfall (rounded)", type: "inr" },
      { key: "months", header: "Months" },
      { key: "interest", header: "Interest", type: "inr" },
    ],
    rows,
  };
}

function cgSheet(a: TaxAnalysis): SheetSpec {
  return {
    name: "Capital gains",
    columns: [
      { key: "asset", header: "Asset", width: 30 },
      { key: "type", header: "Type" },
      { key: "acq", header: "Acquired", type: "date" },
      { key: "sold", header: "Sold", type: "date" },
      { key: "sale", header: "Sale value", type: "inr" },
      { key: "cost", header: "Cost + expenses", type: "inr" },
      { key: "gain", header: "Gain / (loss)", type: "inr" },
      { key: "bucket", header: "Section" },
    ],
    rows: a.cgResult.rows.map((x) => ({ asset: x.asset, type: x.assetType, acq: x.acquiredOn, sold: x.soldOn, sale: r(x.saleValuePaise), cost: r(x.costPaise + x.expensesPaise), gain: r(x.gainPaise), bucket: { stcgOther: "STCG (slab)", stcg111A: "111A", ltcg112: "112", ltcg112A: "112A" }[x.bucket] })),
  };
}

function msmeSheet(a: TaxAnalysis): SheetSpec {
  return {
    name: "MSME 43B(h)",
    columns: [
      { key: "vendor", header: "Vendor", width: 28 },
      { key: "category", header: "Category" },
      { key: "accepted", header: "Accepted on", type: "date" },
      { key: "paid", header: "Paid on", type: "date" },
      { key: "days", header: "Days to pay" },
      { key: "allowed", header: "Allowed days" },
      { key: "amount", header: "Amount", type: "inr" },
      { key: "result", header: "Result" },
    ],
    rows: a.msme.findings.map((f) => ({
      vendor: f.vendor,
      category: f.category,
      accepted: f.acceptanceDate,
      paid: f.paidOn,
      days: f.daysToPay === null ? "unpaid" : String(f.daysToPay),
      allowed: String(f.allowedDays),
      amount: r(f.amountPaise),
      result: f.disallowed ? (a.msme.applied ? "Disallowed u/s 43B(h)" : "Beyond limit (presumptive: not applied)") : "Allowed",
    })),
  };
}

function auditSheet(x: TaxExtract, a: TaxAnalysis): SheetSpec {
  const rows: [string, string][] = [
    ["Rule set", `${a.rules.act}; AY ${a.rules.ay}`],
    ["Taxpayer status", `${x.organiser.profile.status} (${x.organiser.profile.residentialStatus})`],
    ["Regime", a.regime.used ? `${a.regime.used} (${a.regime.reason})` : a.regime.reason],
    ["Presumptive scheme", a.presumptive.claimed ? `${a.presumptive.claimed}: ${a.presumptive.eligible ? "conditions met" : a.presumptive.reasons.join("; ")}` : "not claimed"],
    ["Tax audit u/s 44AB", `${a.audit.required ? "required" : "not required"}: ${a.audit.reason}`],
    ["Due date u/s 139(1)", `${formatDayKey(a.due139)} (${a.dueCategory})`],
    ["Planned filing", formatDayKey(x.organiser.profile.plannedFilingDate)],
    ["ITR form", a.itrForm],
    ["Loss carried forward", `₹${r(a.losses.carriedForwardPaise)}`],
  ];
  return {
    name: "Audit and ITR",
    columns: [
      { key: "check", header: "Check", width: 28 },
      { key: "result", header: "Result", width: 80 },
    ],
    rows: rows.map(([check, result]) => ({ check, result })),
  };
}

function missingSheet(a: TaxAnalysis): SheetSpec {
  const questions = a.ais.rows.filter((x) => x.outcome !== "matched" && x.outcome !== "not_in_books").map((x) => `AIS ${x.line.id} (${x.line.source}): which books ledger holds this income?`);
  return {
    name: "Missing documents",
    columns: [
      { key: "item", header: "Document or question", width: 80 },
      { key: "kind", header: "Kind" },
    ],
    rows: [...a.missingDocs.map((item) => ({ item, kind: "document" })), ...questions.map((item) => ({ item, kind: "reviewer question" }))],
  };
}

export function taxDeliverables(x: TaxExtract, results: ChecklistResultItem[]): DeliverableDraft[] {
  const a = analyseTax(x);
  return [
    {
      type: "xlsx",
      title: TAX_WORKBOOK_TITLE,
      sheets: [
        computationSheet(a),
        tdsSheet(a),
        aisSheet(a),
        advanceSheet(a),
        cgSheet(a),
        msmeSheet(a),
        auditSheet(x, a),
        missingSheet(a),
        checklistSheet(results),
        { name: "Verify", columns: [{ key: "item", header: "Rate / threshold / date", width: 40 }, { key: "verify", header: "Partner to verify", width: 90 }], rows: taxVerifyNotes(a.rules) },
      ],
    },
  ];
}
