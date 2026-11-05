// Computation tests with hand-computed expected values (rupees in comments, paise in asserts).
import { describe, expect, it } from "vitest";
import { GSTIN, R, extract, line, lineTax, matched, payable, purchase, sale, twin } from "./__tests__/kit";
import { analyse, computeFigures, docsRows, dueDateOf, interestOn, lateFeeFor, rule37Rows, seriesOf } from "./compute";
import { GSTR1_COLUMNS, documentRequests, gstDeliverables, missingList } from "./deliverables";
import { periodInfo, zeroTax } from "./money";
import { setOff } from "./setoff";

const T = (igst: number, cgst: number, sgst: number, cess = 0) => ({ igst, cgst, sgst, cess });

describe("set-off (s.49(5), s.49A, rule 88A)", () => {
  it("IGST credit → IGST first, then CGST/SGST; own credits next; cash is the rest", () => {
    // L: IGST 9,000 CGST 10,800 SGST 10,800; C: IGST 1,800 CGST 7,650 SGST 7,650 → cash 7,200 / 3,150 / 3,150.
    const r = setOff(T(900000, 1080000, 1080000), T(180000, 765000, 765000));
    expect(r.cash).toEqual(T(720000, 315000, 315000));
    expect(r.used.igst).toEqual(T(180000, 0, 0));
    expect(r.creditUtilised).toBe(1710000);
    expect(r.closingCredit).toEqual(zeroTax());
  });

  it("IGST remainder covers the CGST then SGST deficit first (rule 88A, minimum cash)", () => {
    // L: IGST 18,000 CGST 36,000 SGST 36,000; C: IGST 54,000 CGST 4,500 SGST 4,500.
    // IGST→IGST 18,000; →CGST deficit 31,500; →SGST deficit 4,500 (exhausted). CGST 4,500→CGST; SGST 4,500→SGST. Cash SGST 27,000.
    const r = setOff(T(1800000, 3600000, 3600000), T(5400000, 450000, 450000));
    expect(r.used.igst).toEqual(T(1800000, 3150000, 450000));
    expect(r.cash).toEqual(T(0, 0, 2700000));
  });

  it("leftover IGST after deficits goes to remaining CGST then SGST, the rest carries forward", () => {
    // L: CGST 1,000 SGST 1,000; C: IGST 5,000 CGST 600 SGST 0. Deficits: CGST 400, SGST 1,000 → IGST 1,400; then CGST 600, SGST 0 → IGST 600 more.
    const r = setOff(T(0, 100000, 100000), T(500000, 60000, 0));
    expect(r.used.igst).toEqual(T(0, 100000, 100000));
    expect(r.cash).toEqual(zeroTax());
    expect(r.closingCredit).toEqual(T(300000, 60000, 0));
  });

  it("CGST credit pays IGST before SGST credit does; CGST never pays SGST and vice versa", () => {
    // L: IGST 27,000; C: CGST 5,400 SGST 5,400 → CGST→IGST 5,400, SGST→IGST 5,400, cash IGST 16,200.
    const r = setOff(T(2700000, 0, 0), T(0, 540000, 540000));
    expect(r.used.cgst).toEqual(T(540000, 0, 0));
    expect(r.used.sgst).toEqual(T(540000, 0, 0));
    expect(r.cash).toEqual(T(1620000, 0, 0));
    // CGST credit cannot touch SGST liability.
    const s = setOff(T(0, 0, 100000), T(0, 100000, 0));
    expect(s.cash).toEqual(T(0, 0, 100000));
    expect(s.closingCredit).toEqual(T(0, 100000, 0));
  });

  it("SGST credit pays IGST only after CGST credit is exhausted", () => {
    // L: IGST 1,000; C: CGST 1,500 SGST 1,000 → CGST pays all IGST; SGST untouched.
    const r = setOff(T(100000, 0, 0), T(0, 150000, 100000));
    expect(r.used.sgst).toEqual(zeroTax());
    expect(r.closingCredit).toEqual(T(0, 50000, 100000));
  });

  it("cess only against cess; RCM always cash; negative inputs rejected", () => {
    const r = setOff(T(0, 0, 0, 5000), T(10000, 0, 0, 2000), T(100, 200, 200, 0));
    expect(r.cash).toEqual(T(100, 200, 200, 3000));
    expect(r.closingCredit.igst).toBe(10000);
    expect(() => setOff(T(-1, 0, 0), zeroTax())).toThrow(RangeError);
    expect(() => setOff(zeroTax(), T(0.5, 0, 0))).toThrow(RangeError);
  });
});

describe("interest u/s 50 and late fee", () => {
  it("interest per head on cash for days late at 18% / 365", () => {
    // ₹7,200 × 18% × 10/365 = ₹35.5068 → 3551 paise; ₹3,150 → 15.5342 → 1553.
    expect(interestOn(T(720000, 315000, 315000), 10)).toEqual(T(3551, 1553, 1553));
    expect(interestOn(T(720000, 0, 0), 0)).toEqual(zeroTax());
  });
  it("late fee ₹50/day capped by AATO slab; nil ₹20/day capped at ₹500", () => {
    expect(lateFeeFor(10, R(2_00_00_000), false)).toBe(50000);
    expect(lateFeeFor(60, R(1_00_00_000), false)).toBe(200000); // ₹3,000 capped at ₹2,000 (AATO ≤ ₹1.5 cr)
    expect(lateFeeFor(200, R(3_00_00_000), false)).toBe(500000); // ₹5,000 cap (≤ ₹5 cr)
    expect(lateFeeFor(300, R(6_00_00_000), false)).toBe(1000000); // ₹10,000 cap
    expect(lateFeeFor(30, R(1_00_00_000), true)).toBe(50000); // ₹600 → ₹500 nil cap
    expect(lateFeeFor(0, R(1), false)).toBe(0);
  });
  it("due date: monthly 20th, QRMP 22nd/24th by state, profile override", () => {
    const x = extract();
    expect(dueDateOf(x, periodInfo("2026-10", "2026-27"), "29")).toBe("2026-11-20");
    expect(dueDateOf(x, periodInfo("Q3", "2026-27"), "29")).toBe("2027-01-22");
    expect(dueDateOf(x, periodInfo("Q3", "2026-27"), "07")).toBe("2027-01-24");
    expect(dueDateOf(extract({ profile: { ...x.profile, dueDate: "2026-11-25" } }), periodInfo("2026-10", "2026-27"), "29")).toBe("2026-11-25");
  });
});

describe("rule 37", () => {
  it("reverses ITC beyond 180 days, proportionately for part payment; not at exactly 180; not twice", () => {
    const rows = rule37Rows(
      [
        payable({ number: "A", date: "2026-05-03" }), // 181 days → IGST 18,000
        payable({ number: "B", date: "2026-05-04" }), // 180 days → no
        payable({ number: "C", date: "2026-04-10", value: R(100000), paid: R(60000), itc: T(R(10000), 0, 0) }), // 40% of 10,000 = 4,000
        payable({ number: "D", date: "2026-01-01", reversedEarlier: true }),
        payable({ number: "E", date: "2026-01-01", paid: R(118000) }),
      ],
      "2026-10-31",
    );
    expect(rows.map((r) => [r.doc.number, r.days, r.reversal.igst])).toEqual([
      ["A", 181, 1800000],
      ["C", 204, 400000],
    ]);
  });
});

describe("analysis: GSTR-1 tables, 3.1, 4, set-off", () => {
  it("classifies B2B / B2CL / B2CS / CDNR with the B2CL boundary (> ₹1,00,000)", () => {
    const x = extract({
      sales: [
        sale({ number: "B1" }),
        sale({ number: "L1", gstin: null, pos: "33", lines: [lineTax(8474577, { igst: 1525424 })], value: 10000001 }),
        sale({ number: "S1", gstin: null, pos: "33", lines: [lineTax(8474576, { igst: 1525424 })], value: 10000000 }),
        sale({ number: "S2", gstin: null, pos: null }),
        sale({ number: "C1", docType: "CRN", lines: [line(R(1000))], origNumber: "B1" }),
        sale({ number: "U1", docType: "CRN", gstin: null, pos: "29", lines: [line(R(500))] }),
      ],
    });
    const a = analyse(x);
    expect(a.sales.map((d) => [d.number, d.table, d.posResolved])).toEqual([
      ["B1", "B2B", "29"],
      ["L1", "B2CL", "33"],
      ["S1", "B2CS", "33"],
      ["S2", "B2CS", "29"],
      ["C1", "CDNR", "29"],
      ["U1", "B2CS", "29"],
    ]);
    // B2CS: POS 29 = 1,00,000 − 500 = 99,500; POS 33 = 84,745.76.
    expect(a.gstr1.b2cs.map((r) => [r.pos, r.taxable])).toEqual([
      ["29", 9950000],
      ["33", 8474576],
    ]);
    const f = computeFigures(x);
    expect(f).toMatchObject({ b2bInvoiceCount: 1, b2clInvoiceCount: 1, b2clTaxablePaise: 8474577, cdnrNoteCount: 1, cdnrNetTaxablePaise: -100000 });
    expect(analyse(x)).toBe(a); // memoised
  });

  it("3.1(a) nets credit notes, 3.1(c) takes rate-0 lines, RC-outward carries no liability", () => {
    const x = extract({
      sales: [
        sale({ lines: [line(R(100000)), line(R(2000), 0, false, { hsn: "0401" })] }),
        sale({ docType: "CRN", lines: [line(R(10000))], origNumber: "X" }),
        sale({ reverseCharge: true, lines: [line(R(5000))] }),
      ],
    });
    const f = computeFigures(x);
    // 1,00,000 − 10,000 = 90,000; CGST 9,000 − 900 = 8,100.
    expect(f).toMatchObject({ outwardTaxablePaise: 9000000, outwardCgstPaise: 810000, outwardSgstPaise: 810000, nilExemptPaise: 200000 });
    expect(analyse(x).gstr1.hsn.map((h) => [h.supply, h.hsn, h.rateBps, h.taxable])).toEqual([
      ["B2B", "0401", 0, 200000],
      ["B2B", "7318", 1800, 9500000],
    ]);
  });

  it("a credit note past the s.34(2) time limit does not reduce 3.1, CDNR, B2CS or HSN; one in time does; Table 13 still counts both", () => {
    // Invoice 2,00,000 (CGST/SGST 18,000). In-time note 20,000 (no original date). Time-barred notes: 10,000 to a
    // registered customer (invoice of 15 Mar 2025, limit 30 Nov 2025) and 5,000 to an unregistered one (invoice of
    // 1 Apr 2024, limit 30 Nov 2025). Boundary: a note dated 30 Nov 2026 against a 2025-26 invoice is in time.
    const x = extract({
      sales: [
        sale({ number: "INV/26/601", lines: [line(R(200000))] }),
        sale({ number: "CN/26/011", docType: "CRN", lines: [line(R(20000))] }),
        sale({ number: "CN/26/012", docType: "CRN", date: "2026-10-26", lines: [line(R(10000))], origNumber: "INV/24/990", origDate: "2025-03-15" }),
        sale({ number: "CN/26/013", docType: "CRN", date: "2026-10-27", gstin: null, pos: "29", lines: [line(R(5000))], origNumber: "INV/24/100", origDate: "2024-04-01" }),
      ],
    });
    const a = analyse(x);
    expect(a.timeBarredNotes.map((d) => d.number)).toEqual(["CN/26/012", "CN/26/013"]);
    // 3.1(a): 2,00,000 − 20,000 = 1,80,000; CGST 18,000 − 1,800 = 16,200.
    const f = computeFigures(x);
    expect(f).toMatchObject({ outwardTaxablePaise: R(180000), outwardCgstPaise: R(16200), outwardSgstPaise: R(16200), cdnrNoteCount: 1, cdnrNetTaxablePaise: -R(20000), b2csTaxablePaise: 0, salesDocCount: 4 });
    expect(a.gstr1.hsn.map((h) => [h.supply, h.taxable])).toEqual([["B2B", R(180000)]]);
    expect(f.docsIssuedCount).toBe(4); // the notes were issued: Table 13 counts them
    // Without the limit passing, the same note reduces liability as booked.
    const inTime = computeFigures(extract({ sales: [sale({ lines: [line(R(200000))] }), sale({ docType: "CRN", date: "2026-11-30", lines: [line(R(10000))], origNumber: "X", origDate: "2025-06-01" })] }));
    expect(inTime).toMatchObject({ outwardTaxablePaise: R(190000), cdnrNoteCount: 1 });
  });

  it("4(A)(5) is lower of books and 2B; deferred, unavailable, not-booked memos; credit notes reduce", () => {
    const p1 = purchase({ number: "M1" }); // CGST/SGST 5,400
    const p2 = purchase({ number: "D1", lines: [lineTax(R(24000), { cgst: R(2250), sgst: R(2250) })] }); // books higher than 2B
    const p3 = purchase({ number: "N1", gstin: GSTIN.supMh, lines: [line(R(10000), 1800, true)] }); // not in 2B
    const p4 = purchase({ number: "U1", gstin: GSTIN.supTn, lines: [line(R(5000), 1800, true)] }); // ITC not available
    const cn = purchase({ number: "SCN1", docType: "CRN", lines: [line(R(1000))] }); // supplier credit note, not in 2B
    const x = extract({
      purchases: [p1, p2, p3, p4, cn],
      gstr2b: [twin(p1), twin(p2, { taxable: R(24000), tax: T(0, R(2160), R(2160)) }), twin(p4, { itcAvailable: false, reason: "POS" }), twin(purchase({ number: "X9", gstin: GSTIN.supTn, lines: [line(R(8000), 1800, true)] }))],
    });
    const a = analyse(x);
    expect(a.recon.map((r) => [r.number, r.status])).toEqual([
      ["M1", "matched"],
      ["D1", "value-diff"],
      ["N1", "missing-in-2b"],
      ["U1", "itc-unavailable"],
      ["SCN1", "missing-in-2b"],
      ["X9", "missing-in-books"],
    ]);
    // a5 CGST = 5,400 + 2,160 − 90 = 7,470.
    expect(a.itc.a5).toEqual(T(0, 747000, 747000));
    expect(a.itc.deferred).toEqual(T(180000, 0, 0));
    expect(a.itc.unavailable2b).toEqual(T(90000, 0, 0));
    expect(a.itc.notBooked).toEqual(T(144000, 0, 0));
  });

  it("RCM: unmarked legal fees at 18% intra; recorded RCM tax kept; GTA forward charge at 12% is not RCM", () => {
    const legal = purchase({ number: "L1", gstin: null, ledger: "Legal Fees", lines: [lineTax(R(50000), {}, { rateBps: 0 })] });
    const marked = purchase({ number: "R1", gstin: null, reverseCharge: true, ledger: "Security", lines: [lineTax(R(10000), { cgst: R(900), sgst: R(900) })] });
    const gtaFwd = purchase({ number: "G1", gstin: GSTIN.supMh, ledger: "Freight", lines: [line(R(10000), 1200, true)] });
    const gtaRcm = purchase({ number: "G2", gstin: GSTIN.supMh, pos: "29", ledger: "Freight", lines: [lineTax(R(20000), {}, { rateBps: 0 })] });
    const x = extract({
      purchases: [legal, marked, gtaFwd, gtaRcm],
      gstr2b: [twin(gtaFwd)],
      ledgers: [
        { ledger: "Legal Fees", blockedCategory: "none", rcmService: "legal", evidence: null, note: "" },
        { ledger: "Security", blockedCategory: "none", rcmService: "security", evidence: null, note: "" },
        { ledger: "Freight", blockedCategory: "none", rcmService: "gta", evidence: null, note: "" },
      ],
    });
    const a = analyse(x);
    expect(a.purchases.map((p) => [p.number, p.rcm, p.rcmUnmarked])).toEqual([
      ["L1", true, true],
      ["R1", true, false],
      ["G1", false, false],
      ["G2", true, true],
    ]);
    // Legal 4,500 + 4,500; security recorded 900 + 900; GTA G2 5% inter (27 → 29) = IGST 1,000.
    expect(a.rcm.tax).toEqual(T(100000, 540000, 540000));
    expect(a.itc.a3).toEqual(a.rcm.tax);
    // No outward liability: RCM is paid in cash, and all ITC (RCM 1,000 + G1 1,200 IGST; RCM CGST/SGST 5,400) carries forward.
    expect(a.setoff.cash).toEqual(T(100000, 540000, 540000));
    expect(a.setoff.closingCredit).toEqual(T(220000, 540000, 540000));
  });

  it("ITC on a bill the model abstained on is held back, not claimed; credit notes still reduce; RCM liability stays", () => {
    const misc = { ledger: "Misc", blockedCategory: "insufficient_evidence" as const, rcmService: "insufficient_evidence" as const, evidence: null, note: "" };
    const rcmOnly = { ledger: "Labour", blockedCategory: "none" as const, rcmService: "insufficient_evidence" as const, evidence: null, note: "" };
    const raw = purchase({ number: "SS/1" }); // CGST/SGST 5,400, claimed
    const bill = purchase({ number: "PC-1201", gstin: GSTIN.sup2, ledger: "Misc", lines: [line(R(10000))] }); // CGST/SGST 900 → held back
    const cn = purchase({ number: "PC-CN1", gstin: GSTIN.sup2, ledger: "Misc", docType: "CRN", lines: [line(R(1000))] }); // −90/−90 still reduces
    const late = purchase({ number: "PC-1300", gstin: GSTIN.sup2, ledger: "Misc", lines: [line(R(2000))] }); // not in 2B: deferred, not held back
    const labour = purchase({ number: "LB/1", gstin: null, reverseCharge: true, ledger: "Labour", lines: [lineTax(R(5000), { cgst: R(450), sgst: R(450) })] }); // RCM 450/450
    const x = extract({ purchases: [raw, bill, cn, late, labour], gstr2b: [twin(raw), twin(bill), twin(cn)], ledgers: [misc, rcmOnly] });
    const a = analyse(x);
    expect(a.purchases.map((p) => [p.number, p.abstained, p.heldBack.cgst])).toEqual([
      ["SS/1", false, 0],
      ["PC-1201", true, R(900)],
      ["PC-CN1", true, 0],
      ["PC-1300", true, 0],
      ["LB/1", true, R(450)],
    ]);
    // 4(A)(5) CGST = 5,400 − 90 = 5,310 (PC-1201 held back); 4(A)(3) = 0 (LB/1 held back); RCM tax 450 still payable in cash.
    expect(a.itc.a5).toEqual(T(0, R(5310), R(5310)));
    expect(a.itc.a3).toEqual(zeroTax());
    expect(a.rcm.tax).toEqual(T(0, R(450), R(450)));
    expect(a.itc.heldBack).toEqual(T(0, R(1350), R(1350)));
    expect(a.itc.deferred).toEqual(T(0, R(180), R(180)));
    expect(a.recon.find((r) => r.number === "PC-1201")).toMatchObject({ status: "matched", claimed: zeroTax(), heldBack: T(0, R(900), R(900)) });
    expect(computeFigures(x)).toMatchObject({ itcAvailablePaise: R(10620), itcHeldBackPaise: R(2700), itcNetPaise: R(10620), rcmTaxPaise: R(900) });
    // The client document request names the amount held back on the ledger (PC-1201: 900 + 900).
    expect(documentRequests(a, x).find((r) => r.item.includes('"Misc"'))?.reason).toBe("The books do not show whether ITC is blocked or reverse charge applies; ITC of ₹1,800.00 held back until answered");
    // Answered ledgers hold nothing back.
    expect(computeFigures(extract({ ...matched(raw), ledgers: [{ ...misc, ledger: raw.ledger, blockedCategory: "none", rcmService: "none" }] })).itcHeldBackPaise).toBe(0);
  });

  it("blocked credit goes to 4(B)(1); reversal beyond ITC becomes liability", () => {
    const car = purchase({ number: "CAR", ledger: "Motor Car", lines: [line(R(800000))] });
    const x = extract({ ...matched(car), ledgers: [{ ledger: "Motor Car", blockedCategory: "motor-vehicle", rcmService: "none", evidence: null, note: "" }], payables: [payable()] });
    const a = analyse(x);
    expect(a.itc.b1).toEqual(T(0, R(72000), R(72000)));
    expect(a.itc.net).toEqual(zeroTax());
    // rule 37 IGST 18,000 with no IGST ITC → IGST liability 18,000.
    expect(a.liability.igst).toBe(R(18000));
    expect(computeFigures(x)).toMatchObject({ itcBlockedPaise: R(144000), itcRule37Paise: R(18000), cashIgstPaise: R(18000) });
  });

  it("opening credit, previous-period gap, lateness and nil-return late fee", () => {
    const x = extract({
      sales: [sale({ lines: [line(R(100000))] })],
      prev: { loc: "prev.json", period: "2026-09", gstr1: T(0, R(12000), R(12000)), gstr3b: T(0, R(10000), R(10000)), closingCredit: T(R(3000), 0, 0), filedOn: null, dueOn: null },
      profile: { ...extract().profile, expectedFilingDate: "2026-11-25" },
    });
    const f = computeFigures(x);
    expect(f).toMatchObject({ prevLiabilityGapPaise: R(4000), daysLate: 5, lateFeePaise: 25000 });
    // L 9,000 / 9,000; IGST 3,000 → CGST deficit → cash CGST 6,000, SGST 9,000.
    expect(f).toMatchObject({ cashCgstPaise: R(6000), cashSgstPaise: R(9000) });
    const nil = computeFigures(extract({ profile: { ...extract().profile, expectedFilingDate: "2026-11-30" } }));
    expect(nil).toMatchObject({ daysLate: 10, lateFeePaise: 20000, interestPaise: 0 });
  });
});

describe("independent formula audit: blocked credit notes, negative outward tax, unregistered RCM state", () => {
  const car = { ledger: "Motor Car", blockedCategory: "motor-vehicle" as const, rcmService: "none" as const, evidence: null, note: "" };
  const sheetsOf = (x: ReturnType<typeof extract>) => {
    const ctx = { input: { files: [], ignored: [] }, extracted: x, figures: {}, results: [], job: { jobTaskId: "j", title: "GSTR-3B", service: "GST", fy: "2026-27", period: "2026-10", clientCode: "T1", clientName: "T", assigneeId: null, reviewerId: null } };
    const d = gstDeliverables(ctx as unknown as Parameters<typeof gstDeliverables>[0]).find((w) => w.title === "GSTR-3B computation") as { sheets: { name: string; rows: Record<string, unknown>[] }[] };
    return (name: string) => d.sheets.find((s) => s.name === name)!.rows;
  };

  it("a blocked-ledger credit note above this period's blocked ITC does not reduce net ITC (4(B)(1) nil, excess kept out of 4(A)(5))", () => {
    // Raw material +5,400 / +5,400; car credit note −9,000 / −9,000 (2B-matched); no blocked bill this period.
    // Old: a5 = −3,600 → 0 and 4(B)(2) 3,600 per head, 4(B)(1) = pos0(−9,000) = 0 → net 0 (ITC understated by 10,800).
    const raw = purchase({ number: "SS/RAW" });
    const note = purchase({ number: "HM/CN/1", gstin: GSTIN.sup2, docType: "CRN", ledger: "Motor Car", lines: [line(R(100000))] });
    const x = extract({ sales: [sale({ lines: [line(R(100000))] })], ...matched(raw, note), ledgers: [car] });
    const a = analyse(x);
    expect(a.itc.b1).toEqual(zeroTax());
    expect(a.itc.blockedNoteExcess).toEqual(T(0, R(9000), R(9000)));
    expect(a.itc.a5).toEqual(T(0, R(5400), R(5400)));
    expect(a.itc.b2).toEqual(zeroTax());
    expect(a.itc.net).toEqual(T(0, R(5400), R(5400)));
    // 4(C) = 4(A) − 4(B) on the sheet; liability 9,000 / 9,000 − 5,400 → cash 3,600 / 3,600.
    expect(a.itc.net).toEqual(subTaxes(addTaxes(a.itc.a3, a.itc.a5), addTaxes(a.itc.b1, a.itc.b2)));
    expect(computeFigures(x)).toMatchObject({ itcNetPaise: R(10800), itcBlockedPaise: 0, itcBlockedNoteExcessPaise: R(18000), cashTaxPaise: R(7200) });
    expect(sheetsOf(x)("4 ITC").at(-1)).toMatchObject({ cgst: 9000, sgst: 9000 });
    expect(sheetsOf(x)("Notes").map((r) => r.topic)).toContain("Credit notes on blocked purchases");
  });

  it("partly offset: blocked bill 2,700 and blocked note 9,000 → 4(B)(1) nil, excess 6,300; blocked bills above notes → 4(B)(1) = the net (unchanged)", () => {
    const raw = purchase({ number: "SS/RAW" });
    const bill = purchase({ number: "HM/2", gstin: GSTIN.sup2, ledger: "Motor Car", lines: [line(R(30000))] }); // +2,700 / +2,700
    const note = purchase({ number: "HM/CN/1", gstin: GSTIN.sup2, docType: "CRN", ledger: "Motor Car", lines: [line(R(100000))] });
    const a = analyse(extract({ ...matched(raw, bill, note), ledgers: [car] }));
    expect(a.itc.blockedNoteExcess).toEqual(T(0, R(6300), R(6300)));
    expect(a.itc.b1).toEqual(zeroTax());
    // a5 = 5,400 + 2,700 − 9,000 + 6,300 = 5,400; net = 5,400 (only the raw material).
    expect(a.itc.a5).toEqual(T(0, R(5400), R(5400)));
    expect(a.itc.net).toEqual(T(0, R(5400), R(5400)));
    const big = purchase({ number: "HM/3", gstin: GSTIN.sup2, ledger: "Motor Car", lines: [line(R(200000))] }); // +18,000
    const b = analyse(extract({ ...matched(raw, big, note), ledgers: [car] }));
    expect(b.itc.b1).toEqual(T(0, R(9000), R(9000))); // 18,000 − 9,000
    expect(b.itc.blockedNoteExcess).toEqual(zeroTax());
    expect(b.itc.net).toEqual(T(0, R(5400), R(5400)));
  });

  it("a reverse-charge credit note on a blocked ledger comes back to 4(A)(3), not 4(A)(5)", () => {
    const rcmBill = purchase({ number: "LB/1", gstin: null, reverseCharge: true, ledger: "Labour", lines: [lineTax(R(20000), { cgst: R(1800), sgst: R(1800) })] });
    const rcmNote = purchase({ number: "CAB/CN", gstin: null, reverseCharge: true, docType: "CRN", ledger: "Motor Car", lines: [lineTax(R(10000), { cgst: R(900), sgst: R(900) })] });
    const a = analyse(extract({ purchases: [rcmBill, rcmNote], ledgers: [car] }));
    // RCM tax 1,800 − 900 = 900 per head is still the 3.1(d) liability; 4(A)(3) = 900 + 900 excess = 1,800.
    expect(a.rcm.tax).toEqual(T(0, R(900), R(900)));
    expect(a.itc.a3).toEqual(T(0, R(1800), R(1800)));
    expect(a.itc.a5).toEqual(zeroTax());
    expect(a.itc.net).toEqual(T(0, R(1800), R(1800)));
  });

  it("negative outward IGST (credit note above invoices): nil in the set-off, carried forward, shown on the 3B sheet", () => {
    const x = extract({
      sales: [sale({ lines: [line(R(500000))] }), sale({ number: "CN/1", docType: "CRN", gstin: GSTIN.mh, pos: "27", lines: [line(R(200000), 1800, true)], origNumber: "INV/9", origDate: "2026-08-20" })],
    });
    const a = analyse(x);
    expect(a.outward.tax).toEqual(T(R(-36000), R(45000), R(45000)));
    expect(a.outward.carryForward).toEqual(T(R(36000), 0, 0));
    expect(a.liability).toEqual(T(0, R(45000), R(45000)));
    expect(a.setoff.cash).toEqual(T(0, R(45000), R(45000)));
    expect(computeFigures(x)).toMatchObject({ outwardIgstPaise: R(-36000), outwardCarryForwardPaise: R(36000) });
    const rows = sheetsOf(x)("3.1 Outward");
    expect(rows[0]).toMatchObject({ igst: 0, cgst: 45000, sgst: 45000 }); // what is entered in 3.1(a)
    expect(rows.at(-1)).toMatchObject({ igst: 36000, cgst: 0, sgst: 0 }); // the memo row
    expect(sheetsOf(x)("Notes").find((r) => r.topic === "Output tax carried forward")?.note).toMatch(/IGST ₹36,000\.00/);
    // No negative head: nothing carried forward, row (a) unchanged.
    expect(analyse(extract({ sales: [sale()] })).outward.carryForward).toEqual(zeroTax());
  });

  it("RCM from an unregistered supplier: IGST when the register's supplier state differs; client state when the column is absent; GSTIN state wins", () => {
    const legal = (over: Parameters<typeof purchase>[0] = {}) => purchase({ number: "L1", gstin: null, ledger: "Legal Fees", lines: [lineTax(R(50000), {}, { rateBps: 0 })], ...over });
    const ledgers = [{ ledger: "Legal Fees", blockedCategory: "none" as const, rcmService: "legal" as const, evidence: null, note: "" }];
    expect(analyse(extract({ purchases: [legal({ supplierState: "27" })], ledgers })).rcm.tax).toEqual(T(R(9000), 0, 0));
    expect(analyse(extract({ purchases: [legal()], ledgers })).rcm.tax).toEqual(T(0, R(4500), R(4500)));
    expect(analyse(extract({ purchases: [legal({ supplierState: "29" })], ledgers })).rcm.tax).toEqual(T(0, R(4500), R(4500)));
    expect(analyse(extract({ purchases: [legal({ gstin: GSTIN.sup1, supplierState: "27" })], ledgers })).rcm.tax).toEqual(T(0, R(4500), R(4500)));
  });
});

const addTaxes = (a: ReturnType<typeof zeroTax>, b: ReturnType<typeof zeroTax>) => T(a.igst + b.igst, a.cgst + b.cgst, a.sgst + b.sgst, a.cess + b.cess);
const subTaxes = (a: ReturnType<typeof zeroTax>, b: ReturnType<typeof zeroTax>) => T(a.igst - b.igst, a.cgst - b.cgst, a.sgst - b.sgst, a.cess - b.cess);

describe("document series (GSTR-1 Table 13)", () => {
  it("prefix + number, gaps listed separately (never presumed cancelled), non-numeric numbers on their own row", () => {
    expect(seriesOf(" inv/26/0101 ")).toEqual({ prefix: "INV/26/", num: 101, width: 4 });
    expect(seriesOf("ABC")).toEqual({ prefix: "ABC", num: null, width: 0 });
    const rows = docsRows([sale({ number: "INV/26/1001" }), sale({ number: "INV/26/1004" }), sale({ number: "inv/26/1001 " }), sale({ number: "CASH" }), sale({ number: "CN-1", docType: "CRN" })]);
    expect(rows.map((r) => [r.nature, r.from, r.to, r.total, r.cancelled, r.gaps, r.net, r.missing])).toEqual([
      ["Invoices for outward supply", "CASH", "CASH", 1, 0, 0, 1, []],
      ["Invoices for outward supply", "INV/26/1001", "INV/26/1004", 4, 0, 2, 2, ["INV/26/1002", "INV/26/1003"]],
      ["Credit Note", "CN-1", "CN-1", 1, 0, 0, 1, []],
    ]);
    // Total = net issued + cancelled + gaps on every row.
    for (const r of rows) expect(r.net + r.cancelled + r.gaps).toBe(r.total);
  });
  it("the Docs sheet shows gaps in their own column and caps the missing-number list", () => {
    expect(missingList(["A1", "A2"])).toBe("A1, A2");
    expect(missingList(Array.from({ length: 23 }, (_, i) => `N${i + 1}`))).toBe(`${Array.from({ length: 20 }, (_, i) => `N${i + 1}`).join(", ")} … (+3 more)`);
    expect(GSTR1_COLUMNS.Docs.map((c) => c.header)).toEqual(["Nature of Document", "Sr. No. From", "Sr. No. To", "Total Number", "Cancelled", "Net Issued", "Gaps — to be explained", "Missing numbers (cancelled or not in the register?)"]);
  });
});
