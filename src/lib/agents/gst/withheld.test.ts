// Owner-approved 2026-11-06 (ADR-009): a ledger the injection screen withheld from the model is
// treated like an abstained one — its ITC is held back (not claimed in 4(A)(5) / 4(A)(3)), counted
// in itcHeldBackPaise, asked about (gst.model-questions) and requested from the client — and it is
// never blocked or reverse charge, whatever its fields say, because the model never classified it.
import { describe, expect, it } from "vitest";
import type { CheckInput } from "@/lib/agents/core/runner";
import { GSTIN, R, extract, line, purchase, twin } from "./__tests__/kit";
import { analyse, computeFigures, isAbstained } from "./compute";
import { documentRequests } from "./deliverables";
import { zeroTax } from "./money";
import { gstRegistry } from "./rules";
import type { GstExtract, GstInput, LedgerClass } from "./types";

const withheld = (ledger: string, over: Partial<LedgerClass> = {}): LedgerClass => ({
  ledger,
  blockedCategory: "insufficient_evidence",
  rcmService: "insufficient_evidence",
  evidence: null,
  note: "Not sent to the AI: the text asks the reader to ignore or override its instructions, so it may be a prompt-injection attempt. Check this item by hand.",
  withheld: true,
  ...over,
});

describe("a ledger withheld by the injection screen", () => {
  it("holds its ITC back like an abstention, and is never blocked or reverse charge", () => {
    const raw = purchase({ number: "SS/1" }); // CGST/SGST 5,400 each, claimed
    const car = purchase({ number: "HM/1", gstin: GSTIN.sup2, ledger: "Motor Car", lines: [line(R(10000))] }); // CGST/SGST 900 each → held back
    // Even if a withheld ledger carried a category, the model never gave it: no block, no RCM.
    const x = extract({ purchases: [raw, car], gstr2b: [twin(raw), twin(car)], ledgers: [withheld("Motor Car", { blockedCategory: "motor-vehicle", rcmService: "legal" as never })] });
    const a = analyse(x);
    expect(isAbstained(x.ledgers[0])).toBe(true);
    expect(a.purchases.map((p) => [p.number, p.abstained, p.blocked, p.rcm, p.heldBack.cgst])).toEqual([
      ["SS/1", false, null, false, 0],
      ["HM/1", true, null, false, R(900)],
    ]);
    expect(a.itc.a5).toEqual({ ...zeroTax(), cgst: R(5400), sgst: R(5400) });
    expect(a.itc.heldBack).toEqual({ ...zeroTax(), cgst: R(900), sgst: R(900) });
    expect(computeFigures(x)).toMatchObject({ itcAvailablePaise: R(10800), itcBlockedPaise: 0, itcHeldBackPaise: R(1800), itcNetPaise: R(10800) });
  });

  it("is a reviewer question naming the injection and a client document request with the amount", () => {
    const car = purchase({ number: "HM/1", gstin: GSTIN.sup2, ledger: "Motor Car", lines: [line(R(10000))] });
    const x: GstExtract = extract({ purchases: [car], gstr2b: [twin(car)], ledgers: [withheld("Motor Car")] });
    const ci = { input: { files: [], ignored: [] }, extracted: x, figures: {}, job: {} } as unknown as CheckInput<GstInput, GstExtract>;
    const q = gstRegistry.get("gst.model-questions")!(ci, { id: "gst.model-questions" } as never);
    expect(q.status).toBe("fail");
    expect(q.message).toMatch(/ledger "Motor Car": the books do not show whether ITC is blocked u\/s 17\(5\) or reverse charge applies \(Not sent to the AI: the text asks the reader to ignore or override its instructions, so it may be a prompt-injection attempt\. Check this item by hand\.\)/);
    expect(q.message).toMatch(/ITC of ₹1800\.00 on HM\/1 held back \(not claimed\) until answered/);
    expect(documentRequests(analyse(x), x).find((r) => r.item.includes('"Motor Car"'))?.reason).toBe("The books do not show whether ITC is blocked or reverse charge applies; ITC of ₹1,800.00 held back until answered");
  });
});
