// Independent formula re-audit (audited commit d20227f): NEW-1, NEW-2, NEW-4 (Table 4 buckets) and
// NEW-5 (carry-forwards from the previous return). Each counterexample is the auditor's, with the
// figures before the fix in the comments (rupees in comments, paise in asserts).
import { describe, expect, it } from "vitest";
import type { CheckOutcome, RuleDefinition } from "@/lib/agents/core/checklist";
import type { InputFile } from "@/lib/agents/core/runner";
import { GSTIN, R, extract, line, lineTax, matched, purchase, twin } from "./__tests__/kit";
import { analyse, computeFigures } from "./compute";
import { gstDeliverables } from "./deliverables";
import { classifyFiles, loadGstData } from "./input";
import { zeroTax, type TaxSplit } from "./money";
import { GST_CHECKLIST, carriedForwardParts, gstRegistry, type GstCheckInput } from "./rules";
import type { GstExtract, LedgerClass, PrevReturn } from "./types";

const T = (igst: number, cgst: number, sgst: number, cess = 0): TaxSplit => ({ igst, cgst, sgst, cess });
const cls = (ledger: string, blockedCategory: LedgerClass["blockedCategory"], rcmService: LedgerClass["rcmService"] = "none"): LedgerClass => ({ ledger, blockedCategory, rcmService, evidence: null, note: "" });
const JOB = { jobTaskId: "j", title: "GSTR-3B", service: "GST" as const, fy: "2026-27", period: "2026-10", clientCode: "T1", clientName: "T", assigneeId: null, reviewerId: null };
const ci = (x: GstExtract): GstCheckInput => ({ input: { files: [], ignored: [] }, extracted: x, figures: computeFigures(x), job: JOB });
const check = (ruleId: string, x: GstExtract): CheckOutcome => {
  const rule = GST_CHECKLIST.rules.find((r) => r.id === ruleId) as RuleDefinition;
  return gstRegistry.get(rule.check)!(ci(x), rule);
};
const sheetsOf = (x: GstExtract) => {
  const ctx = { input: { files: [], ignored: [] }, extracted: x, figures: {}, results: [], job: JOB };
  const d = gstDeliverables(ctx as unknown as Parameters<typeof gstDeliverables>[0]).find((w) => w.title === "GSTR-3B computation") as { sheets: { name: string; rows: Record<string, unknown>[] }[] };
  return (name: string) => d.sheets.find((s) => s.name === name)!.rows;
};
/** 4(C) = 4(A) − 4(B), per head, before the pos0 clamp. */
const net4C = (a: ReturnType<typeof analyse>) => T(
  a.itc.a3.igst + a.itc.a5.igst - a.itc.b1.igst - a.itc.b2.igst,
  a.itc.a3.cgst + a.itc.a5.cgst - a.itc.b1.cgst - a.itc.b2.cgst,
  a.itc.a3.sgst + a.itc.a5.sgst - a.itc.b1.sgst - a.itc.b2.sgst,
  a.itc.a3.cess + a.itc.a5.cess - a.itc.b1.cess - a.itc.b2.cess,
);

describe("NEW-1 (HIGH): a blocked forward invoice and a blocked reverse-charge credit note in one head are not netted", () => {
  // Client state 29. B-1 "Food" (food-beverage), taxable 50,000, CGST/SGST 4,500 each, matched in 2B.
  // C-1 "FoodRcm" (food-beverage), reverse charge, credit note taxable 1,00,000, CGST/SGST −9,000 each.
  const b1 = purchase({ number: "B-1", gstin: GSTIN.sup1, ledger: "Food", lines: [line(R(50000))] });
  const c1 = purchase({ number: "C-1", docType: "CRN", gstin: null, reverseCharge: true, ledger: "FoodRcm", lines: [line(R(100000))] });
  const x = extract({ purchases: [b1, c1], gstr2b: [twin(b1)], ledgers: [cls("Food", "food-beverage"), cls("FoodRcm", "food-beverage")] });

  it("the auditor's counterexample: 4(A)(5) 9,000; 4(B)(1) 9,000; net ITC 0; excess 18,000 out of 4(A)(3); RCM carry-forward 18,000", () => {
    const a = analyse(x);
    expect(analyse(extract()).clientState).toBe("29");
    expect(a.itc.a5).toEqual(T(0, R(4500), R(4500)));
    // Before: blockedSigned = 9,000 − 18,000 → 4(B)(1) = 0 and net ITC 9,000 (the blocked invoice's ITC availed).
    expect(a.itc.b1).toEqual(T(0, R(4500), R(4500)));
    expect(a.itc.net).toEqual(zeroTax());
    expect(a.itc.blockedNoteExcess).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.a3).toEqual(zeroTax());
    expect(a.itc.a3CarryForward).toEqual(zeroTax());
    expect(a.rcm.tax).toEqual(T(0, R(-9000), R(-9000)));
    expect(a.rcm.carryForward).toEqual(T(0, R(9000), R(9000)));
    expect(computeFigures(x)).toMatchObject({
      itcAvailablePaise: R(9000),
      itcBlockedPaise: R(9000),
      itcNetPaise: 0,
      itcBlockedNoteExcessPaise: R(18000),
      rcmCarryForwardPaise: R(18000),
      itcRcmCarryForwardPaise: 0,
      cashTaxPaise: 0,
    });
  });
  it("the 3B sheet shows the excess as a memo row and explains it per kind", () => {
    const rows = sheetsOf(x)("4 ITC");
    expect(rows.find((r) => String(r.details).startsWith("(B)(1)"))).toMatchObject({ cgst: 4500, sgst: 4500 });
    expect(rows.find((r) => String(r.details).startsWith("Memo: credit notes on s.17(5)"))).toMatchObject({ cgst: 9000, sgst: 9000 });
    expect(sheetsOf(x)("Notes").find((r) => r.topic === "Credit notes on blocked purchases")?.note).toMatch(/of the same kind \(forward charge in 4\(A\)\(5\), reverse charge in 4\(A\)\(3\)\) by CGST ₹9,000\.00, SGST ₹9,000\.00.*a blocked bill of the other kind is still reversed in full/);
  });
});

describe("NEW-2 (MEDIUM): held-back reverse-charge ITC is not also reversed as blocked", () => {
  // One bill: ledger "Canteen", model says food-beverage but abstains on the RCM service; the books mark it RCM.
  const bill = purchase({ number: "CB-1", gstin: null, reverseCharge: true, ledger: "Canteen", lines: [line(R(100000))] });
  const x = extract({ purchases: [bill], ledgers: [cls("Canteen", "food-beverage", "insufficient_evidence")] });

  it("the auditor's counterexample: 3.1(d) 18,000; held back 18,000; 4(B)(1) 0; cash 18,000 (was 36,000)", () => {
    const a = analyse(x);
    expect(a.rcm.tax).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.heldBack).toEqual(T(0, R(9000), R(9000)));
    // Before: 4(B)(1) 18,000 reversed although nothing was claimed → net −18,000 → liability 18,000 → cash 36,000.
    expect(a.itc.b1).toEqual(zeroTax());
    expect(a.itc.a3).toEqual(zeroTax());
    expect(a.liability).toEqual(zeroTax());
    expect(a.setoff.cash).toEqual(T(0, R(9000), R(9000)));
    expect(computeFigures(x)).toMatchObject({ rcmTaxPaise: R(18000), itcHeldBackPaise: R(18000), itcBlockedPaise: 0, itcNetPaise: 0, cashTaxPaise: R(18000) });
  });
  it("gst.blocked-credit still asks for the classification but says the ITC is held back, not reversed", () => {
    const o = check("gst.blocked-credit", x);
    expect(o.status).toBe("fail");
    expect(o.message).toMatch(/₹0\.00 moved to Table 4\(B\)\(1\).*CB-1 "Canteen" → .*ITC held back until the question on this ledger is answered, not reversed/);
  });
  it("a blocked forward bill whose RCM answer is abstained is held back the same way (neither claimed nor reversed)", () => {
    const fwd = purchase({ number: "CB-2", gstin: GSTIN.sup2, ledger: "Canteen", lines: [line(R(100000))] });
    const a = analyse(extract({ ...matched(fwd), ledgers: [cls("Canteen", "food-beverage", "insufficient_evidence")] }));
    expect(a.itc.heldBack).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.a5).toEqual(zeroTax());
    expect(a.itc.b1).toEqual(zeroTax());
    expect(a.setoff.cash).toEqual(zeroTax());
  });
});

describe("NEW-4 (LOW): Table 4 presentation in mixed-sign heads", () => {
  it("a blocked forward credit note plus a blocked RCM invoice in one head reverse in 4(B)(1), not 4(B)(2)", () => {
    // Forward "Food" credit note 50,000 (−4,500 / −4,500, in 2B); RCM "FoodRcm" bill 1,00,000 (9,000 / 9,000).
    const note = purchase({ number: "FC-1", docType: "CRN", gstin: GSTIN.sup1, ledger: "Food", lines: [line(R(50000))] });
    const rcm = purchase({ number: "R-1", gstin: null, reverseCharge: true, ledger: "FoodRcm", lines: [line(R(100000))] });
    const a = analyse(extract({ purchases: [note, rcm], gstr2b: [twin(note)], ledgers: [cls("Food", "food-beverage"), cls("FoodRcm", "food-beverage")] }));
    // Before: 4(B)(1) = pos0(−4,500 + 9,000) = 4,500 and 4(B)(2) = 4,500 per head (the note reversed as "others").
    expect(a.itc.a3).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.a5).toEqual(zeroTax());
    expect(a.itc.b1).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.b2).toEqual(zeroTax());
    expect(a.itc.blockedNoteExcess).toEqual(T(0, R(4500), R(4500)));
    expect(a.itc.net).toEqual(zeroTax());
    expect(a.setoff.cash).toEqual(T(0, R(9000), R(9000))); // the RCM liability, unchanged
  });
  it("a negative not-blocked RCM is not netted against blocked RCM ITC; 3.1(d) already used it, so its ITC reduction is applied now in 4(B)(2)", () => {
    // RCM "Legal" (legal) credit note 50,000 (−4,500 / −4,500); RCM "FoodRcm" (blocked) bill 1,00,000 (9,000 / 9,000).
    const legal = purchase({ number: "L-CN", docType: "CRN", gstin: null, reverseCharge: true, ledger: "Legal", lines: [line(R(50000))] });
    const rcm = purchase({ number: "R-2", gstin: null, reverseCharge: true, ledger: "FoodRcm", lines: [line(R(100000))] });
    const x = extract({ purchases: [legal, rcm], ledgers: [cls("Legal", "none", "legal"), cls("FoodRcm", "food-beverage")] });
    const a = analyse(x);
    // 3.1(d) nets every reverse-charge document: L = 9,000 − 4,500 = 4,500 per head, paid in cash; nothing to carry there.
    expect(a.rcm.tax).toEqual(T(0, R(4500), R(4500)));
    expect(a.rcm.carryForward).toEqual(zeroTax());
    // N = 4,500 per head; carry min(N, neg0(L)) = 0; apply 4,500 per head now in 4(B)(2).
    // Before NEW-4: 4(A)(3) 4,500 (netted). First NEW-4 cut: carried 4,500 (cash 9,000, less conservative).
    expect(a.itc.a3).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.b1).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.b2).toEqual(T(0, R(4500), R(4500)));
    expect(a.itc.rcmNoteReversal).toEqual(T(0, R(4500), R(4500)));
    expect(a.itc.a3CarryForward).toEqual(zeroTax());
    expect(net4C(a)).toEqual(T(0, R(-4500), R(-4500)));
    expect(a.itc.net).toEqual(zeroTax());
    expect(a.liability).toEqual(T(0, R(4500), R(4500))); // the reduction lands this period
    expect(a.setoff.cash).toEqual(T(0, R(9000), R(9000)));
    expect(computeFigures(x)).toMatchObject({ itcRcmCarryForwardPaise: 0, rcmCarryForwardPaise: 0, itcOtherReversalPaise: R(9000), cashTaxPaise: R(18000) });
    expect(check("gst.negative-rcm", x).status).toBe("pass"); // nothing carried on either side
    const rows = sheetsOf(x)("4 ITC");
    expect(rows.find((r) => String(r.details).startsWith("(B)(2)"))).toMatchObject({ cgst: 4500, sgst: 4500 });
    expect(rows.find((r) => String(r.details).includes("applied now in (B)(2)"))).toMatchObject({ cgst: 4500, sgst: 4500 });
    expect(sheetsOf(x)("Notes").find((r) => r.topic === "Reverse-charge credit notes applied now")?.note).toMatch(/the difference, CGST ₹4,500\.00, SGST ₹4,500\.00, is reversed now in Table 4\(B\)\(2\)/);
  });
  it("coordinator case: a not-blocked RCM credit note −9,000 and a held-back RCM bill +18,000 in one head → 3.1(d) 9,000, 9,000 applied now in 4(B)(2), carry 0", () => {
    // "Labour" bill 1,00,000 (9,000 / 9,000): the model abstained on reverse charge, so its ITC is held back but its liability counts.
    const held = purchase({ number: "LB/7", gstin: null, reverseCharge: true, ledger: "Labour", lines: [line(R(100000))] });
    const legal = purchase({ number: "L-CN2", docType: "CRN", gstin: null, reverseCharge: true, ledger: "Legal", lines: [line(R(50000))] }); // −4,500 / −4,500
    const x = extract({ purchases: [held, legal], ledgers: [cls("Labour", "none", "insufficient_evidence"), cls("Legal", "none", "legal")] });
    const a = analyse(x);
    expect(a.rcm.tax).toEqual(T(0, R(4500), R(4500))); // L = 9,000 − 4,500 per head → 3.1(d) 9,000
    expect(a.itc.heldBack).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.a3).toEqual(zeroTax());
    // N = 4,500 per head; neg0(L) = 0 → carry 0; the ITC reduction 9,000 is applied now.
    // First NEW-4 cut: carried 9,000 in a3CarryForward (cash 9,000).
    expect(a.itc.a3CarryForward).toEqual(zeroTax());
    expect(a.itc.rcmNoteReversal).toEqual(T(0, R(4500), R(4500)));
    expect(a.itc.b2).toEqual(T(0, R(4500), R(4500)));
    expect(a.liability).toEqual(T(0, R(4500), R(4500)));
    expect(a.setoff.cash).toEqual(T(0, R(9000), R(9000)));
    expect(computeFigures(x)).toMatchObject({ rcmTaxPaise: R(9000), itcHeldBackPaise: R(18000), itcOtherReversalPaise: R(9000), itcRcmCarryForwardPaise: 0, cashTaxPaise: R(18000) });
  });
  it("a blocked RCM credit note with a negative not-blocked RCM in one head: L < 0, so the ITC side carries min(N, |L|)", () => {
    // Legal note −4,500 / −4,500 (not blocked) and a blocked "FoodRcm" note −1,000 / −1,000.
    const legal = purchase({ number: "L-CN3", docType: "CRN", gstin: null, reverseCharge: true, ledger: "Legal", lines: [line(R(50000))] });
    const food = purchase({ number: "F-CN3", docType: "CRN", gstin: null, reverseCharge: true, ledger: "FoodRcm", lines: [lineTax(R(11111.11), { cgst: R(1000), sgst: R(1000) })] });
    const ledgers = [cls("Legal", "none", "legal"), cls("FoodRcm", "food-beverage"), cls("Labour", "none", "insufficient_evidence")];
    const a = analyse(extract({ purchases: [legal, food], ledgers }));
    // L = −5,500 per head → 3.1(d) nil, carry 5,500; N = 4,500 ≤ 5,500 → all 4,500 carried, nothing applied now.
    expect(a.rcm.carryForward).toEqual(T(0, R(5500), R(5500)));
    expect(a.itc.a3CarryForward).toEqual(T(0, R(4500), R(4500)));
    expect(a.itc.rcmNoteReversal).toEqual(zeroTax());
    expect(a.itc.blockedNoteExcess).toEqual(T(0, R(1000), R(1000)));
    expect(a.itc.b2).toEqual(zeroTax());
    // Partly covered: add a held-back bill +2,000 / +2,000 → L = −3,500 → carry min(4,500, 3,500) = 3,500, apply 1,000 now.
    const held = purchase({ number: "LB/8", gstin: null, reverseCharge: true, ledger: "Labour", lines: [lineTax(R(22222.22), { cgst: R(2000), sgst: R(2000) })] });
    const x = extract({ purchases: [legal, food, held], ledgers });
    const b = analyse(x);
    expect(b.rcm.tax).toEqual(T(0, R(-3500), R(-3500)));
    expect(b.rcm.carryForward).toEqual(T(0, R(3500), R(3500)));
    expect(b.itc.a3CarryForward).toEqual(T(0, R(3500), R(3500)));
    expect(b.itc.rcmNoteReversal).toEqual(T(0, R(1000), R(1000)));
    expect(b.itc.b2).toEqual(T(0, R(1000), R(1000)));
    expect(b.itc.blockedNoteExcess).toEqual(T(0, R(1000), R(1000)));
    expect(check("gst.negative-rcm", x).message).toMatch(/^Reverse-charge credit notes exceed this period's reverse-charge bills: Table 3\.1\(d\) excess CGST ₹3500\.00, SGST ₹3500\.00 and Table 4\(A\)\(3\) excess CGST ₹3500\.00, SGST ₹3500\.00 .*; the rest of those notes, CGST ₹1000\.00, SGST ₹1000\.00, is reversed now in Table 4\(B\)\(2\)/);
  });
  it("pure negative RCM (round-2 case): both sides still carried in full", () => {
    const bill = purchase({ number: "KD/91", gstin: null, reverseCharge: true, ledger: "Legal", lines: [line(R(20000))] }); // 1,800 / 1,800
    const note = purchase({ number: "KD/CN/12", gstin: null, reverseCharge: true, docType: "CRN", ledger: "Legal", lines: [line(R(50000))] }); // −4,500 / −4,500
    const a = analyse(extract({ purchases: [bill, note], ledgers: [cls("Legal", "none", "legal")] }));
    expect(a.rcm.carryForward).toEqual(T(0, R(2700), R(2700)));
    expect(a.itc.a3CarryForward).toEqual(T(0, R(2700), R(2700)));
    expect(a.itc.rcmNoteReversal).toEqual(zeroTax());
    expect(a.itc.b2).toEqual(zeroTax());
  });
  it("forward heads too: a not-blocked credit note above the not-blocked ITC goes to 4(B)(2) and does not shrink the blocked 4(A)(5)", () => {
    // Blocked "Food" bill 50,000 (4,500 / 4,500) and a raw-material credit note 30,000 (−2,700 / −2,700), both in 2B.
    const food = purchase({ number: "B-9", gstin: GSTIN.sup1, ledger: "Food", lines: [line(R(50000))] });
    const note = purchase({ number: "RM-CN", docType: "CRN", gstin: GSTIN.sup2, lines: [line(R(30000))] });
    const a = analyse(extract({ ...matched(food, note), ledgers: [cls("Food", "food-beverage")] }));
    // Before: 4(A)(5) = pos0(4,500 − 2,700) = 1,800 and 4(B)(2) 0. The 4(C) result is the same (−2,700 per head → liability).
    expect(a.itc.a5).toEqual(T(0, R(4500), R(4500)));
    expect(a.itc.b1).toEqual(T(0, R(4500), R(4500)));
    expect(a.itc.b2).toEqual(T(0, R(2700), R(2700)));
    expect(net4C(a)).toEqual(T(0, R(-2700), R(-2700)));
    expect(a.liability).toEqual(T(0, R(2700), R(2700)));
  });
  it("same-kind netting is unchanged: blocked forward bills net against blocked forward notes", () => {
    const bill = purchase({ number: "HM/3", gstin: GSTIN.sup2, ledger: "Motor Car", lines: [line(R(200000))] }); // +18,000 / +18,000
    const note = purchase({ number: "HM/CN/1", gstin: GSTIN.sup2, docType: "CRN", ledger: "Motor Car", lines: [line(R(100000))] }); // −9,000 / −9,000
    const a = analyse(extract({ ...matched(bill, note), ledgers: [cls("Motor Car", "motor-vehicle")] }));
    expect(a.itc.b1).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.a5).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.blockedNoteExcess).toEqual(zeroTax());
  });
});

describe("NEW-5 (LOW): carry-forwards from the previous return are listed for a partner, never consumed", () => {
  const prev = (carryForward?: PrevReturn["carryForward"]): PrevReturn => ({ loc: "prev-return.json", period: "2026-09", gstr1: zeroTax(), gstr3b: zeroTax(), closingCredit: zeroTax(), filedOn: null, dueOn: null, ...(carryForward ? { carryForward } : {}) });
  const raw = purchase({ number: "SS/RAW", lines: [line(R(100000))] }); // CGST 9,000 + SGST 9,000
  const base = { ...matched(raw) };

  it("absent previous return or absent field → na; stated nil → pass", () => {
    expect(check("gst.prior-carry-forward", extract(base))).toMatchObject({ status: "na", message: "No previous return figures given" });
    expect(check("gst.prior-carry-forward", extract({ ...base, prev: prev() }))).toMatchObject({ status: "na", message: "The previous return figures do not say whether anything was carried forward" });
    expect(check("gst.prior-carry-forward", extract({ ...base, prev: prev({ outward: zeroTax(), rcm: zeroTax(), rcmItc: zeroTax() }) })).status).toBe("pass");
    expect(carriedForwardParts(undefined)).toEqual([]);
  });
  it("lists the amount and head of each carried kind (warn) and leaves this period's figures alone", () => {
    const cf = { outward: T(R(36000), 0, 0), rcm: T(0, R(2700), R(2700)), rcmItc: T(0, R(2700), R(2700)) };
    const x = extract({ ...base, prev: prev(cf) });
    const o = check("gst.prior-carry-forward", x);
    expect(o).toMatchObject({ status: "fail", evidence: { quote: "carriedForward.outputTax: IGST 36000.00, CGST 0.00, SGST 0.00", location: "prev-return.json" } });
    expect(o.message).toBe(
      "Last period (2026-09) carried forward ₹36000.00 of output tax (IGST ₹36000.00); ₹5400.00 of reverse-charge tax (CGST ₹2700.00, SGST ₹2700.00); ₹5400.00 of reverse-charge input tax credit (CGST ₹2700.00, SGST ₹2700.00). The draft does not use these amounts: adjust them in this return after a partner confirms",
    );
    expect(GST_CHECKLIST.rules.find((r) => r.id === "gst.prior-carry-forward")).toMatchObject({ severity: "warn", kind: "deterministic" });
    // Not auto-consumed: every figure equals the same period without the field.
    expect(computeFigures(x)).toEqual(computeFigures(extract({ ...base, prev: prev() })));
    expect(sheetsOf(x)("Notes").find((r) => r.topic === "Carried forward from last period")?.note).toMatch(/^The previous return \(2026-09\) carried forward output tax IGST ₹36,000\.00; reverse-charge tax CGST ₹2,700\.00, SGST ₹2,700\.00; reverse-charge input tax credit CGST ₹2,700\.00, SGST ₹2,700\.00 .*does not use these amounts/);
    expect(sheetsOf(extract({ ...base, prev: prev() }))("Notes").map((r) => r.topic)).not.toContain("Carried forward from last period");
  });
  it("one kind only: singular wording", () => {
    const o = check("gst.prior-carry-forward", extract({ ...base, prev: prev({ outward: zeroTax(), rcm: zeroTax(), rcmItc: T(0, 45, 45) }) }));
    expect(o.message).toBe("Last period (2026-09) carried forward ₹0.90 of reverse-charge input tax credit (CGST ₹0.45, SGST ₹0.45). The draft does not use it: adjust it in this return after a partner confirms");
    expect(o.evidence?.quote).toBe("carriedForward.reverseChargeCredit: IGST 0.00, CGST 0.45, SGST 0.45");
  });

  describe("previous-return file: optional carriedForward per head (rupees)", () => {
    const f = (name: string, text: string): InputFile => ({ name, source: "fixture", bytes: Buffer.from(text) });
    const BASE = [
      f("profile.json", JSON.stringify({ gstin: "29aafcz1001k1zc", aatoInr: "2,00,00,000" })),
      f("sales.csv", "Date,Voucher No.,Particulars,GSTIN/UIN,Place of Supply,HSN/SAC,GST Rate,Taxable Value,IGST,CGST,SGST/UTGST\n03-10-2026,INV/1,Tanvir,29AABCT5101P1Z3,29,7318,18,1000,,90,90"),
      f("purchase-register.csv", "Date,Supplier Invoice No.,Particulars,GSTIN/UIN,Purchase Ledger,GST Rate,Taxable Value,IGST,CGST,SGST/UTGST\n05-10-2026,SS/1,Sunrise,29AAGCS6101U1ZN,Raw Material,18,600,,54,54"),
      f("gstr2b.json", JSON.stringify({ data: { docdata: { b2b: [] } } })),
    ];
    const load = (prevJson: unknown) => {
      const { input } = classifyFiles([...BASE, f("prev-return.json", JSON.stringify(prevJson))]);
      return loadGstData(input, { period: "2026-10", fy: "2026-27" });
    };
    const P = { period: "2026-09", gstr1Liability: {}, gstr3bLiability: {} };
    it("reads each kind into paise; missing kinds are nil; the field absent stays absent", async () => {
      const x = await load({ ...P, carriedForward: { outputTax: { igst: "36,000" }, reverseChargeCredit: { cgst: 2700, sgst: "2,700.00" } } });
      expect(x.prev?.carryForward).toEqual({ outward: T(R(36000), 0, 0), rcm: zeroTax(), rcmItc: T(0, R(2700), R(2700)) });
      expect((await load(P)).prev).not.toHaveProperty("carryForward");
    });
    it("a negative amount carried forward is refused with a plain message", async () => {
      await expect(load({ ...P, carriedForward: { outputTax: { igst: -5 } } })).rejects.toThrow(/prev-return\.json: carriedForward\.outputTax: an amount carried forward cannot be negative/);
    });
  });
});
