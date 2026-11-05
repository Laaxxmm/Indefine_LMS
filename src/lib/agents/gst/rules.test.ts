// One block per checklist rule: positive (fails when it should), negative (passes on clean data)
// and the boundary where the rule's threshold sits.
import { describe, expect, it } from "vitest";
import { loadRuleSet, type CheckOutcome, type RuleDefinition } from "@/lib/agents/core/checklist";
import { GSTIN, R, extract, line, lineTax, matched, payable, purchase, sale, twin } from "./__tests__/kit";
import { computeFigures } from "./compute";
import { GST_CONFIG, GST_VERIFY_NOTES } from "./config";
import { GST_CHECKLIST, gstRegistry, packConfigParams, type GstCheckInput } from "./rules";
import type { GstExtract, LedgerClass } from "./types";

const JOB = { jobTaskId: "j", title: "GSTR-3B", service: "GST" as const, fy: "2026-27", period: "2026-10", clientCode: "TEST01", clientName: "Test", assigneeId: null, reviewerId: null };
const ci = (x: GstExtract): GstCheckInput => ({ input: { files: [], ignored: [] }, extracted: x, figures: computeFigures(x), job: JOB });

function check(ruleId: string, x: GstExtract, params?: Record<string, unknown>): CheckOutcome {
  const base: RuleDefinition = GST_CHECKLIST.rules.find((r) => r.id === ruleId) ?? { id: ruleId, title: ruleId, severity: "warn", kind: "deterministic", check: ruleId, evidence: "row" };
  const rule: RuleDefinition = params ? { ...base, params: { ...(base.params ?? {}), ...params } } : base;
  return gstRegistry.get(rule.check)!(ci(x), rule);
}
const status = (o: CheckOutcome) => o.status;
const cls = (ledger: string, over: Partial<LedgerClass> = {}): LedgerClass => ({ ledger, blockedCategory: "none", rcmService: "none", evidence: { quote: ledger, location: "purchases.csv row 2" }, note: "", ...over });

describe("default SopPack gst 1.0.0", () => {
  it("loads with every deterministic rule implemented, ids unique, one LLM rule", () => {
    const r = loadRuleSet(GST_CHECKLIST, gstRegistry);
    expect(r.ok).toBe(true);
    expect(GST_CHECKLIST.rules.filter((x) => x.kind === "llm").map((x) => x.id)).toEqual(["gst.free-supplies"]);
    expect(GST_CHECKLIST.rules.filter((x) => x.severity === "block").length).toBeGreaterThanOrEqual(8);
  });
  it("every threshold rule carries a verify note, and every config value is listed for the partner", () => {
    for (const id of ["gst.hsn-digits", "gst.credit-note-time-limit", "gst.period-lock", "gst.einvoice-irn", "gst.2b-value-diff", "gst.rule37-180-days", "gst.b2cl-threshold", "gst.pack-config"]) {
      expect(GST_CHECKLIST.rules.find((r) => r.id === id)?.params?.verify, id).toBeTruthy();
    }
    expect(GST_VERIFY_NOTES.every((n) => n.verify.length > 10)).toBe(true);
  });
});

describe("gst.gstin-valid (block)", () => {
  it("passes valid GSTINs everywhere", () => expect(status(check("gst.gstin-valid", extract({ sales: [sale()], ...matched(purchase()) })))).toBe("pass"));
  it("fails a bad checksum with the GSTIN and row as evidence", () => {
    const o = check("gst.gstin-valid", extract({ sales: [sale({ gstin: GSTIN.bad, loc: "sales.csv row 7" })] }));
    expect(o).toMatchObject({ status: "fail", evidence: { quote: GSTIN.bad, location: "sales.csv row 7" } });
    expect(o.message).toMatch(/checksum/);
  });
  it("fails a bad client GSTIN, 2B GSTIN, payables GSTIN and tax charged without a supplier GSTIN", () => {
    expect(status(check("gst.gstin-valid", extract({ profile: { ...extract().profile, gstin: "29ABC" } })))).toBe("fail");
    expect(status(check("gst.gstin-valid", extract({ gstr2b: [twin(purchase(), { ctin: "99AAAAA0000A1Z5" })] })))).toBe("fail");
    expect(status(check("gst.gstin-valid", extract({ payables: [payable({ gstin: GSTIN.bad })] })))).toBe("fail");
    const o = check("gst.gstin-valid", extract({ purchases: [purchase({ gstin: null })] }));
    expect(o.message).toMatch(/no supplier GSTIN/);
  });
});

describe("gst.pos-tax-type (block)", () => {
  it("passes intra CGST+SGST and inter IGST", () => {
    expect(status(check("gst.pos-tax-type", extract({ sales: [sale(), sale({ gstin: GSTIN.mh, pos: "27", lines: [line(R(1000), 1800, true)] })], ...matched(purchase()) })))).toBe("pass");
  });
  it("fails IGST on an intra-state sale, CGST on an inter-state sale, unequal halves, and a purchase with the wrong head", () => {
    expect(check("gst.pos-tax-type", extract({ sales: [sale({ lines: [lineTax(R(1000), { igst: R(180) })] })] })).message).toMatch(/intra-state supply charged IGST/);
    expect(check("gst.pos-tax-type", extract({ sales: [sale({ gstin: GSTIN.mh, pos: "27" })] })).message).toMatch(/inter-state supply charged CGST/);
    expect(status(check("gst.pos-tax-type", extract({ sales: [sale({ lines: [lineTax(R(1000), { cgst: R(90), sgst: R(88.99) })] })] })))).toBe("fail");
    expect(check("gst.pos-tax-type", extract({ purchases: [purchase({ gstin: GSTIN.supMh })] })).message).toMatch(/purchase .* from 27/);
  });
  it("boundary: halves differing by exactly ₹1 pass; rate-0, cess-only and RC docs are skipped", () => {
    expect(status(check("gst.pos-tax-type", extract({ sales: [sale({ lines: [lineTax(R(1000), { cgst: R(90), sgst: R(89) })] })] })))).toBe("pass");
    expect(status(check("gst.pos-tax-type", extract({ sales: [sale({ lines: [line(R(1000), 0)] }), sale({ lines: [lineTax(R(1000), { cess: R(10) })] }), sale({ reverseCharge: true, lines: [lineTax(R(1000), { igst: R(180) })] })] })))).toBe("pass");
  });
});

describe("gst.rcm-liability (block)", () => {
  const legal = purchase({ gstin: null, ledger: "Legal Fees", lines: [lineTax(R(50000), {}, { rateBps: 0 })] });
  it("fails an unmarked notified service with the liability in the message", () => {
    const o = check("gst.rcm-liability", extract({ purchases: [legal], ledgers: [cls("Legal Fees", { rcmService: "legal" })] }));
    expect(o).toMatchObject({ status: "fail", evidence: { quote: "Legal Fees" } });
    expect(o.message).toMatch(/₹9000\.00 added to Table 3\.1\(d\)/);
  });
  it("passes when the books already mark it RCM, or the ledger is not an RCM service", () => {
    expect(status(check("gst.rcm-liability", extract({ purchases: [{ ...legal, reverseCharge: true }], ledgers: [cls("Legal Fees", { rcmService: "legal" })] })))).toBe("pass");
    expect(status(check("gst.rcm-liability", extract({ purchases: [legal], ledgers: [cls("Legal Fees")] })))).toBe("pass");
  });
  it("boundary: GTA charged forward at 12% by a registered supplier is not RCM; at 5% with tax it is", () => {
    const fwd = purchase({ gstin: GSTIN.supMh, ledger: "Freight", lines: [line(R(1000), 1200, true)] });
    expect(status(check("gst.rcm-liability", extract({ purchases: [fwd], ledgers: [cls("Freight", { rcmService: "gta" })] })))).toBe("pass");
    const at5 = purchase({ gstin: GSTIN.supMh, ledger: "Freight", lines: [line(R(1000), 500, true)] });
    expect(status(check("gst.rcm-liability", extract({ purchases: [at5], ledgers: [cls("Freight", { rcmService: "gta" })] })))).toBe("fail");
  });
});

describe("gst.hsn-digits (block)", () => {
  const small = R(2_00_00_000);
  const big = R(12_00_00_000);
  const withAato = (aato: number, sales: ReturnType<typeof sale>[]) => extract({ profile: { ...extract().profile, aatoPaise: aato }, sales });
  it("AATO ≤ ₹5 cr: 4 digits on B2B pass; 2 digits or missing fail; B2C optional", () => {
    expect(status(check("gst.hsn-digits", withAato(small, [sale(), sale({ gstin: null, lines: [line(R(1), 1800, false, { hsn: null })] })])))).toBe("pass");
    expect(status(check("gst.hsn-digits", withAato(small, [sale({ lines: [line(R(1), 1800, false, { hsn: "73" })] })])))).toBe("fail");
    expect(check("gst.hsn-digits", withAato(small, [sale({ lines: [line(R(1), 1800, false, { hsn: null })] })])).message).toMatch(/no HSN/);
  });
  it("AATO > ₹5 cr: 4 digits fail, 6 pass, B2C included", () => {
    expect(check("gst.hsn-digits", withAato(big, [sale()])).evidence).toMatchObject({ quote: "7318" });
    expect(status(check("gst.hsn-digits", withAato(big, [sale({ lines: [line(R(1), 1800, false, { hsn: "731815" })] })])))).toBe("pass");
    expect(status(check("gst.hsn-digits", withAato(big, [sale({ gstin: null, lines: [line(R(1), 1800, false, { hsn: null })] })])))).toBe("fail");
  });
  it("boundary: AATO exactly ₹5 cr uses the 4-digit slab; params can change the slabs", () => {
    expect(status(check("gst.hsn-digits", withAato(R(5_00_00_000), [sale()])))).toBe("pass");
    expect(status(check("gst.hsn-digits", withAato(R(5_00_00_000) + 1, [sale()])))).toBe("fail");
    expect(status(check("gst.hsn-digits", withAato(small, [sale()]), { slabs: [{ uptoAatoPaise: null, minDigits: 8 }] }))).toBe("fail");
  });
});

describe("gst.invoice-duplicates (block)", () => {
  it("fails numbers equal ignoring case and spaces, in sales and purchases", () => {
    const o = check("gst.invoice-duplicates", extract({ sales: [sale({ number: "INV/26/501" }), sale({ number: "inv/26/501 ", gstin: GSTIN.ka2 })] }));
    expect(o).toMatchObject({ status: "fail", evidence: { quote: '"INV/26/501" and "inv/26/501 "' } });
    expect(status(check("gst.invoice-duplicates", extract({ purchases: [purchase({ number: "SS/7007" }), purchase({ number: "SS / 7007" })] })))).toBe("fail");
  });
  it("passes distinct numbers, punctuation differences, and the same number from different suppliers or doc types", () => {
    expect(status(check("gst.invoice-duplicates", extract({ sales: [sale({ number: "INV/1" }), sale({ number: "INV-1" }), sale({ number: "INV/1", docType: "CRN", origNumber: "X" })] })))).toBe("pass");
    expect(status(check("gst.invoice-duplicates", extract({ purchases: [purchase({ number: "A1" }), purchase({ number: "A1", gstin: GSTIN.sup2 })] })))).toBe("pass");
  });
});

describe("gst.credit-note-time-limit (block)", () => {
  const cn = (date: string, origDate: string | null) => sale({ docType: "CRN", number: "CN/1", date, origNumber: "INV/9", origDate });
  it("fails a note after 30 Nov following the FY of the invoice", () => expect(status(check("gst.credit-note-time-limit", extract({ sales: [cn("2026-10-26", "2025-03-15")] })))).toBe("fail"));
  it("passes within the limit or without an original date", () => {
    expect(status(check("gst.credit-note-time-limit", extract({ sales: [cn("2026-10-26", "2026-04-01")] })))).toBe("pass");
    expect(status(check("gst.credit-note-time-limit", extract({ sales: [cn("2026-10-26", null)] })))).toBe("pass");
  });
  it("boundary: 30 Nov itself passes, 1 Dec fails", () => {
    expect(status(check("gst.credit-note-time-limit", extract({ sales: [cn("2026-11-30", "2025-06-01")] })))).toBe("pass");
    expect(status(check("gst.credit-note-time-limit", extract({ sales: [cn("2026-12-01", "2025-06-01")] })))).toBe("fail");
  });
  it("lists each note as a reviewer item: time-barred credit note excluded: <no>, ₹<value>", () => {
    // Note value 10,000 + 18% = 11,800; tax 1,800.
    const o = check("gst.credit-note-time-limit", extract({ sales: [sale({ docType: "CRN", number: "CN/26/012", date: "2026-10-26", lines: [line(R(10000))], origNumber: "INV/24/990", origDate: "2025-03-15", loc: "sales.csv row 4" })] }));
    expect(o).toMatchObject({ status: "fail", evidence: { quote: "CN/26/012 2026-10-26", location: "sales.csv row 4" } });
    expect(o.message).toMatch(/the draft leaves them out of Table 3\.1/);
    expect(o.message).toContain("time-barred credit note excluded: CN/26/012, ₹11800.00 (taxable ₹10000.00, tax ₹1800.00; dated 2026-10-26 against invoice INV/24/990 of 2025-03-15; time limit 2025-11-30)");
  });
  it("a pack limit set apart from the computation's lists the notes the two treat differently", () => {
    const x = extract({ sales: [cn("2026-12-15", "2025-06-01")] }); // past 30 Nov 2026: excluded by the computation; the pack says 31 Dec
    expect(check("gst.credit-note-time-limit", x, { deadlineMonthDay: "12-31" }).message).toMatch(/excluded from the draft figures by the computation's time limit \(2026-11-30\) although the SOP pack allows it/);
    const y = extract({ sales: [cn("2026-11-15", "2025-06-01")] }); // in time for the computation (30 Nov 2026)
    expect(check("gst.credit-note-time-limit", y, { deadlineMonthDay: "10-31" }).message).toMatch(/past the SOP pack's time limit but the computation's limit \(2026-11-30\) keeps it in the draft figures/);
    expect(status(check("gst.credit-note-time-limit", y))).toBe("pass");
  });
});

describe("gst.period-lock (block)", () => {
  const prev = (g1: number, g3: number) => ({ loc: "prev.json", period: "2026-09", gstr1: { igst: 0, cgst: g1, sgst: g1, cess: 0 }, gstr3b: { igst: 0, cgst: g3, sgst: g3, cess: 0 }, closingCredit: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, filedOn: null, dueOn: null });
  it("fails when GSTR-1 exceeds 3B Table 3.1", () => expect(check("gst.period-lock", extract({ prev: prev(R(12000), R(10000)) }))).toMatchObject({ status: "fail", evidence: { location: "prev.json" } }));
  it("passes equal or 3B higher; na without a previous return", () => {
    expect(status(check("gst.period-lock", extract({ prev: prev(R(100), R(200)) })))).toBe("pass");
    expect(status(check("gst.period-lock", extract()))).toBe("na");
  });
  it("boundary: a ₹1.00 shortfall passes, ₹1.01 fails", () => {
    expect(status(check("gst.period-lock", extract({ prev: prev(10100, 10000) })))).toBe("pass");
    expect(status(check("gst.period-lock", extract({ prev: prev(10101, 10000) })))).toBe("fail");
  });
});

describe("gst.einvoice-irn (block)", () => {
  const aato = (p: number) => ({ ...extract().profile, aatoPaise: p });
  it("fails a B2B invoice without IRN above ₹5 cr AATO", () => expect(status(check("gst.einvoice-irn", extract({ profile: aato(R(8_00_00_000)), sales: [sale()] })))).toBe("fail"));
  it("passes with IRNs, and B2C needs none", () => expect(status(check("gst.einvoice-irn", extract({ profile: aato(R(8_00_00_000)), sales: [sale({ irn: "x" }), sale({ gstin: null })] })))).toBe("pass"));
  it("boundary: AATO exactly ₹5 cr is not liable (na)", () => expect(status(check("gst.einvoice-irn", extract({ profile: aato(R(5_00_00_000)), sales: [sale()] })))).toBe("na"));
});

describe("gst.pack-config (block)", () => {
  it("passes the default pack and a pack without the params", () => {
    expect(status(check("gst.pack-config", extract()))).toBe("pass");
    const rule = { ...GST_CHECKLIST.rules.find((r) => r.id === "gst.pack-config")!, params: undefined };
    expect(gstRegistry.get("gst.pack-config")!(ci(extract()), rule).status).toBe("pass");
  });
  it("fails when a partner changes a computation rate in the pack only", () => {
    const o = check("gst.pack-config", extract(), { b2clThresholdPaise: R(250000) });
    expect(o.message).toMatch(/disagree/);
    expect(o.evidence?.quote).toMatch(/b2clThresholdPaise: pack 25000000, module 10000000/);
    expect(packConfigParams().interestRateBps).toBe(GST_CONFIG.interestRateBps);
  });
  it("states the s.34(2) credit-note limit the computation uses", () => {
    expect(packConfigParams().creditNoteDeadlineMonthDay).toBe("11-30");
    expect(check("gst.pack-config", extract(), { creditNoteDeadlineMonthDay: "12-31" }).message).toMatch(/creditNoteDeadlineMonthDay differs/);
  });
});

describe("2B reconciliation rules (warn)", () => {
  const p = purchase({ number: "SS/1" });
  it("missing in 2B / missing in books / ITC not available", () => {
    expect(check("gst.2b-missing-in-2b", extract({ purchases: [p] }))).toMatchObject({ status: "fail", evidence: { quote: `${GSTIN.sup1} SS/1` } });
    expect(status(check("gst.2b-missing-in-books", extract({ gstr2b: [twin(p)] })))).toBe("fail");
    expect(check("gst.2b-itc-unavailable", extract({ purchases: [p], gstr2b: [twin(p, { itcAvailable: false, reason: "POS" })] })).message).toMatch(/POS/);
  });
  it("all pass when books and 2B agree", () => {
    const x = extract(matched(p));
    for (const id of ["gst.2b-missing-in-2b", "gst.2b-missing-in-books", "gst.2b-value-diff", "gst.2b-itc-unavailable"]) expect(status(check(id, x)), id).toBe("pass");
  });
  it("boundary: value-diff passes at exactly ₹1.00 and fails at ₹1.01 on any head or the taxable value", () => {
    const at = (tax: number) => extract({ purchases: [p], gstr2b: [twin(p, { tax: { igst: 0, cgst: tax, sgst: tax, cess: 0 } })] });
    expect(status(check("gst.2b-value-diff", at(540100)))).toBe("pass");
    expect(status(check("gst.2b-value-diff", at(540101)))).toBe("fail");
    expect(status(check("gst.2b-value-diff", extract({ purchases: [p], gstr2b: [twin(p, { taxable: R(60001.01) })] })))).toBe("fail");
    expect(status(check("gst.2b-value-diff", at(540101), { tolerancePaise: 200 }))).toBe("pass");
  });
});

describe("gst.blocked-credit (warn) and gst.model-questions (warn)", () => {
  const car = purchase({ ledger: "Motor Car" });
  it("fails a blocked category with ITC; passes ordinary inputs and blocked items without ITC", () => {
    expect(check("gst.blocked-credit", extract({ ...matched(car), ledgers: [cls("Motor Car", { blockedCategory: "motor-vehicle" })] })).message).toMatch(/s\.17\(5\)\(a\)/);
    expect(status(check("gst.blocked-credit", extract({ ...matched(car), ledgers: [cls("Motor Car")] })))).toBe("pass");
    expect(status(check("gst.blocked-credit", extract({ purchases: [purchase({ ledger: "Motor Car", lines: [line(R(1000), 0)] })], ledgers: [cls("Motor Car", { blockedCategory: "motor-vehicle" })] })))).toBe("pass");
  });
  it("insufficient_evidence ledgers and HSN reads become questions; clean answers do not", () => {
    const x = extract({
      ...matched(purchase({ ledger: "Misc" })),
      ledgers: [cls("Misc", { blockedCategory: "insufficient_evidence", rcmService: "insufficient_evidence", note: "too vague" })],
      hsnReads: [{ description: "Assorted", location: "sales.csv row 2", hsn: null, status: "insufficient_evidence", evidence: null, note: "" }],
    });
    const o = check("gst.model-questions", x);
    expect(o).toMatchObject({ status: "fail", evidence: { quote: "Misc" } });
    expect(o.message).toMatch(/2 question/);
    expect(o.message).toMatch(/blocked u\/s 17\(5\) and whether reverse charge applies/);
    expect(status(check("gst.model-questions", extract({ ledgers: [cls("Raw")], hsnReads: [{ description: "x", location: "l", hsn: "7318", status: "read", evidence: null, note: "" }] })))).toBe("pass");
    expect(status(check("gst.model-questions", extract({ ledgers: [cls("Ghost", { rcmService: "insufficient_evidence" })] })))).toBe("fail");
  });
});

describe("gst.rule37-180-days (warn)", () => {
  it("fails at 181 days unpaid; passes at 180, when paid, or when reversed earlier", () => {
    expect(check("gst.rule37-180-days", extract({ payables: [payable({ date: "2026-05-03" })] })).message).toMatch(/₹18000\.00 reversed/);
    expect(status(check("gst.rule37-180-days", extract({ payables: [payable({ date: "2026-05-04" }), payable({ paid: R(118000), date: "2026-01-01" }), payable({ reversedEarlier: true, date: "2026-01-01" })] })))).toBe("pass");
  });
  it("params change the day count", () => expect(status(check("gst.rule37-180-days", extract({ payables: [payable({ date: "2026-05-04" })] }), { days: 179 }))).toBe("fail"));
});

describe("gst.invoice-gaps (warn)", () => {
  it("fails on missing numbers in a series; passes a continuous series", () => {
    expect(check("gst.invoice-gaps", extract({ sales: [sale({ number: "INV/1001" }), sale({ number: "INV/1004" })] }))).toMatchObject({ status: "fail", evidence: { quote: "INV/1002, INV/1003" } });
    expect(status(check("gst.invoice-gaps", extract({ sales: [sale({ number: "INV/1001" }), sale({ number: "INV/1002" })] })))).toBe("pass");
  });
});

describe("gst.credit-note-linked (warn)", () => {
  it("fails a note with no original invoice; passes a linked note", () => {
    expect(status(check("gst.credit-note-linked", extract({ sales: [sale({ docType: "CRN" })] })))).toBe("fail");
    expect(status(check("gst.credit-note-linked", extract({ sales: [sale({ docType: "DBN", origNumber: "INV/1" })] })))).toBe("pass");
  });
});

describe("gst.late-fee-interest (warn)", () => {
  const prof = (d: string | null) => ({ ...extract().profile, expectedFilingDate: d });
  it("fails when filing is expected after the due date, with interest and fee", () => {
    const o = check("gst.late-fee-interest", extract({ profile: prof("2026-11-30"), sales: [sale()] }));
    expect(o).toMatchObject({ status: "fail", evidence: { quote: "expectedFilingDate 2026-11-30", location: "profile.json" } });
    expect(o.message).toMatch(/10 day/);
  });
  it("boundary: filing on the due date passes; a previous return filed late fails", () => {
    expect(status(check("gst.late-fee-interest", extract({ profile: prof("2026-11-20") })))).toBe("pass");
    const prev = { loc: "prev.json", period: "2026-09", gstr1: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, gstr3b: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, closingCredit: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, filedOn: "2026-10-25", dueOn: "2026-10-20" };
    expect(check("gst.late-fee-interest", extract({ prev })).evidence).toMatchObject({ quote: "filedOn 2026-10-25" });
    expect(status(check("gst.late-fee-interest", extract({ prev: { ...prev, filedOn: "2026-10-20" } })))).toBe("pass");
  });
});

describe("gst.b2cl-threshold (info)", () => {
  it("lists inter-state B2C invoices above ₹1,00,000; boundary at exactly ₹1,00,000 is B2CS", () => {
    const b2c = (value: number) => sale({ gstin: null, pos: "33", lines: [lineTax(8474577, { igst: 1525424 })], value });
    expect(status(check("gst.b2cl-threshold", extract({ sales: [b2c(10000001)] })))).toBe("fail");
    expect(status(check("gst.b2cl-threshold", extract({ sales: [b2c(10000000)] })))).toBe("pass");
  });
});

describe("mistake-only parameterised checks", () => {
  it("gst.party-listed", () => {
    expect(status(check("gst.party-listed", extract({ purchases: [purchase()], sales: [sale()] }), { gstins: [GSTIN.sup1.toLowerCase()] }))).toBe("fail");
    expect(status(check("gst.party-listed", extract({ sales: [sale()] }), { gstins: [GSTIN.ka1] }))).toBe("fail");
    expect(status(check("gst.party-listed", extract({ purchases: [purchase()] }), { gstins: ["x"] }))).toBe("pass");
    expect(status(check("gst.party-listed", extract({ purchases: [purchase()] })))).toBe("pass");
  });
  it("gst.amount-over (boundary: equal passes)", () => {
    expect(status(check("gst.amount-over", extract({ purchases: [purchase()] }), { limitPaise: R(60000) }))).toBe("pass");
    expect(status(check("gst.amount-over", extract({ purchases: [purchase()] }), { limitPaise: R(59999.99) }))).toBe("fail");
    expect(status(check("gst.amount-over", extract({ sales: [sale()] }), { limitPaise: 1 }))).toBe("fail");
  });
  it("gst.itc-time-limit", () => {
    expect(status(check("gst.itc-time-limit", extract({ purchases: [purchase({ date: "2025-02-10" })] }), { deadlineMonthDay: "11-30" }))).toBe("fail");
    expect(status(check("gst.itc-time-limit", extract({ purchases: [purchase({ date: "2025-06-10" })] })))).toBe("pass");
    expect(status(check("gst.itc-time-limit", extract({ purchases: [purchase({ date: "2025-02-10", docType: "CRN" })] })))).toBe("pass");
  });
});
