import { describe, expect, it } from "vitest";
import { ChecklistPackSchema, loadRuleSet, type RuleDefinition } from "@/lib/agents/core/checklist";
import { baseExtract, checkInput } from "./__fixtures__/base";
import type { RocExtract } from "./analyse";
import { ROC_CHECKLIST, rocRegistry } from "./rules";

const CR = 1_00_00_000_00;
const rule = (id: string, params?: Record<string, unknown>): RuleDefinition => ({ id, title: id, severity: "block", kind: "deterministic", check: id, evidence: "e", ...(params ? { params } : {}) });
const run = (id: string, x: RocExtract, params?: Record<string, unknown>) => rocRegistry.get(id)!(checkInput(x), rule(id, params));
const director = (din: string, o: Partial<RocExtract["directors"][number]> = {}) => ({ din, name: `D${din}`, designation: "Director", dinStatus: "active" as const, kycCompletedOn: "2026-08-01", residentInIndia: true, ...o });

describe("default pack", () => {
  it("is valid, version 1.0.0, and every deterministic rule has a body", () => {
    expect(ChecklistPackSchema.parse(ROC_CHECKLIST).version).toBe("1.0.0");
    expect(loadRuleSet(ROC_CHECKLIST, rocRegistry).ok).toBe(true);
    expect(ROC_CHECKLIST.rules.filter((r) => r.kind === "llm").map((r) => r.id)).toEqual(["roc.aoc2-related-party"]);
  });
  it("clean company passes every deterministic rule", () => {
    for (const r of ROC_CHECKLIST.rules.filter((x) => x.kind === "deterministic")) {
      expect([r.id, run(r.id, baseExtract()).status]).toEqual([r.id, "pass"]);
    }
  });
});

describe("roc.agm-due-date", () => {
  it("on the due date passes; one day late fails with evidence", () => {
    expect(run("roc.agm-due-date", baseExtract({ company: { agmDate: "2026-09-30" } })).status).toBe("pass");
    const r = run("roc.agm-due-date", baseExtract({ company: { agmDate: "2026-10-01" } }));
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/1 day\(s\) after the due date 30 Sep 2026/);
    expect(r.evidence).toEqual({ quote: "agmDate: 2026-10-01", location: "company.json agmDate" });
  });
  it("missing AGM fails; OPC is not applicable", () => {
    expect(run("roc.agm-due-date", baseExtract({ company: { agmDate: null } })).message).toMatch(/AGM date not given/);
    expect(run("roc.agm-due-date", baseExtract({ company: { companyClass: "opc", agmDate: null } })).status).toBe("na");
  });
});

describe("roc.agm-gap", () => {
  it("exactly 15 months passes, a day more fails, no previous date is na", () => {
    expect(run("roc.agm-gap", baseExtract({ company: { previousAgmDate: "2025-06-25" } })).status).toBe("pass");
    expect(run("roc.agm-gap", baseExtract({ company: { previousAgmDate: "2025-06-24" } })).status).toBe("fail");
    expect(run("roc.agm-gap", baseExtract({ company: { previousAgmDate: null } })).status).toBe("na");
  });
});

describe("roc.din-kyc", () => {
  it("passes when all active with KYC; fails naming the row", () => {
    expect(run("roc.din-kyc", baseExtract()).status).toBe("pass");
    const r = run("roc.din-kyc", baseExtract({ directors: [director("01000001"), director("01000003", { kycCompletedOn: null })] }));
    expect(r.status).toBe("fail");
    expect(r.evidence?.location).toBe("directors.csv row 3");
    expect(r.message).toMatch(/DIR-3 KYC pending/);
  });
  it("a deactivated DIN fails even with KYC", () => {
    expect(run("roc.din-kyc", baseExtract({ directors: [director("01000001", { dinStatus: "deactivated" }), director("01000002")] })).message).toMatch(/DIN deactivated/);
  });
});

describe("roc.auditor-term", () => {
  it("year 5 passes; year 6 fails; rotation breach fails", () => {
    expect(run("roc.auditor-term", baseExtract({ auditor: { termStartFy: "2021-22" } })).status).toBe("pass");
    expect(run("roc.auditor-term", baseExtract({ auditor: { termStartFy: "2020-21" } })).message).toMatch(/year 6 of a 5-year term/);
    const r = run("roc.auditor-term", baseExtract({ company: { listed: true }, auditor: { type: "individual", termStartFy: "2021-22", reappointedAtThisAgm: true } }));
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/Rotation/);
  });
});

describe("roc.adt1-trigger", () => {
  it("term ending without appointment fails; with reappointment passes; mid-term passes", () => {
    expect(run("roc.adt1-trigger", baseExtract({ auditor: { termStartFy: "2021-22" } })).status).toBe("fail");
    expect(run("roc.adt1-trigger", baseExtract({ auditor: { termStartFy: "2021-22", reappointedAtThisAgm: true } })).message).toMatch(/ADT-1 required/);
    expect(run("roc.adt1-trigger", baseExtract()).message).toMatch(/no auditor appointment/);
  });
});

describe("roc.shareholding-ties", () => {
  it("off by one share fails; equal passes", () => {
    const off = baseExtract({ shareholding: [{ folio: "F", holder: "H", shareClass: "Equity", shares: 99999, faceValuePaise: 1000, paidUpPerSharePaise: 1000 }] });
    const r = run("roc.shareholding-ties", off);
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/difference ₹-10\.00/);
    expect(run("roc.shareholding-ties", baseExtract()).status).toBe("pass");
  });
});

describe("roc.annual-return-form", () => {
  it("declared MGT-7A for a non-small company fails; right form passes; none declared passes", () => {
    const over = run("roc.annual-return-form", baseExtract({ previous: { revenueFromOperations: 40 * CR + 100 } }));
    expect(over.status).toBe("fail");
    expect(over.message).toMatch(/do not file the declared form on the strength of limits a partner has not verified/);
    expect(run("roc.annual-return-form", baseExtract({ previous: { revenueFromOperations: 40 * CR } })).status).toBe("pass");
    // ₹100 cr is small only under the unverified limits: MGT-7A declared still fails.
    expect(run("roc.annual-return-form", baseExtract({ previous: { revenueFromOperations: 100 * CR } })).status).toBe("fail");
    expect(run("roc.annual-return-form", baseExtract({ company: { declaredAnnualReturnForm: null } })).message).toMatch(/MGT-7A applies/);
    expect(run("roc.annual-return-form", baseExtract({ company: { companyClass: "public", declaredAnnualReturnForm: "MGT-7" } })).status).toBe("pass");
  });
});

describe("roc.small-company-pending-verification", () => {
  it("between the verified and unverified limits: fails naming both limit sets and both forms", () => {
    const r = run("roc.small-company-pending-verification", baseExtract({ company: { paidUpCapitalPaise: 6 * CR, declaredAnnualReturnForm: "MGT-7" }, previous: { revenueFromOperations: 70 * CR } }));
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/Applied \(verified — Companies \(Specification of Definitions Details\) Amendment Rules, 2022/);
    expect(r.message).toMatch(/not a small company → MGT-7\. Unverified limits from 01 Dec 2025 .* → small company → MGT-7A/);
    expect(r.evidence).toEqual({ quote: "paidUpCapital 6,00,00,000.00; previous revenueFromOperations 70,00,00,000.00", location: "company.json paidUpCapital / financials previous revenueFromOperations" });
  });
  it("within both, over both, an ineligible class or an FY before the unverified entry: passes", () => {
    expect(run("roc.small-company-pending-verification", baseExtract()).status).toBe("pass");
    expect(run("roc.small-company-pending-verification", baseExtract({ previous: { revenueFromOperations: 100 * CR + 1 } })).status).toBe("pass");
    expect(run("roc.small-company-pending-verification", baseExtract({ company: { companyClass: "opc", agmDate: null }, previous: { revenueFromOperations: 70 * CR } })).status).toBe("pass");
    expect(run("roc.small-company-pending-verification", baseExtract({ fy: "2024-25", previous: { revenueFromOperations: 70 * CR } })).status).toBe("pass");
  });
});

describe("roc.financials-tie", () => {
  it("unmapped ledger, unbalanced sheet, capital mismatch", () => {
    expect(run("roc.financials-tie", baseExtract({ unmapped: ["GST Input"] })).message).toMatch(/not mapped/);
    expect(run("roc.financials-tie", baseExtract({ current: { cashAndBank: 7_00_000_01 } })).message).toMatch(/does not tie.*₹0\.01/);
    expect(run("roc.financials-tie", baseExtract({ company: { paidUpCapitalPaise: 1 } })).message).toMatch(/differs from paid-up/);
  });
});

describe("roc.csr-applicability", () => {
  it("at threshold fails (warn); below passes", () => {
    const at = { previous: { revenueFromOperations: 60 * CR, otherIncome: 0, totalExpenses: 55 * CR } };
    expect(run("roc.csr-applicability", baseExtract(at)).status).toBe("fail");
    expect(run("roc.csr-applicability", baseExtract({ previous: { revenueFromOperations: 60 * CR, otherIncome: 0, totalExpenses: 55 * CR + 1 } })).status).toBe("pass");
  });
});

describe("roc.msme1-applicability", () => {
  it("46 days fails with the row; 45 passes", () => {
    const r = run("roc.msme1-applicability", baseExtract({ msme: [{ vendor: "A", halfYear: "H1", amountPaise: 1, daysOutstanding: 45 }, { vendor: "B", halfYear: "H2", amountPaise: 1, daysOutstanding: 46 }] }));
    expect(r.status).toBe("fail");
    expect(r.evidence?.location).toBe("msme.csv row 3");
    expect(run("roc.msme1-applicability", baseExtract({ msme: [{ vendor: "A", halfYear: "H1", amountPaise: 1, daysOutstanding: 45 }] })).status).toBe("pass");
  });
});

describe("roc.dpt3-applicability", () => {
  it("filed passes, not filed fails, nothing outstanding passes, government na", () => {
    expect(run("roc.dpt3-applicability", baseExtract()).message).toMatch(/filed 25 Jun 2026/);
    expect(run("roc.dpt3-applicability", baseExtract({ company: { deposits: { depositsOutstandingPaise: 0, loansNotDepositsPaise: 1, dpt3FiledOn: null } } })).status).toBe("fail");
    expect(run("roc.dpt3-applicability", baseExtract({ company: { deposits: { depositsOutstandingPaise: 0, loansNotDepositsPaise: 0, dpt3FiledOn: null } } })).status).toBe("pass");
    expect(run("roc.dpt3-applicability", baseExtract({ company: { governmentCompany: true } })).status).toBe("na");
  });
});

describe("roc.filing-delay-fee", () => {
  it("filing on the due date passes; a day later fails", () => {
    expect(run("roc.filing-delay-fee", baseExtract({ company: { estimateFilingOn: "2026-10-24" } })).status).toBe("pass");
    const r = run("roc.filing-delay-fee", baseExtract({ company: { estimateFilingOn: "2026-10-25" } }));
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/AOC-4 ₹100\.00/);
    expect(run("roc.filing-delay-fee", baseExtract({ company: { estimateFilingOn: null } })).message).toMatch(/no planned filing date/);
  });
});

describe("mistake-loop checks", () => {
  it("roc.min-directors uses params and class", () => {
    const one = baseExtract({ directors: [director("01000001")] });
    expect(run("roc.min-directors", one).status).toBe("fail");
    expect(run("roc.min-directors", one, { private: 1 }).status).toBe("pass");
    expect(run("roc.min-directors", baseExtract({ company: { companyClass: "public" } })).status).toBe("fail");
    expect(run("roc.min-directors", baseExtract({ directors: [director("01000001"), director("01000002", { dinStatus: "disqualified" })] })).status).toBe("fail");
  });
  it("roc.resident-director", () => {
    expect(run("roc.resident-director", baseExtract()).status).toBe("pass");
    expect(run("roc.resident-director", baseExtract({ directors: [director("01000001", { residentInIndia: false })] })).status).toBe("fail");
  });
  it("roc.borrowing-limit: public in scope, at the limit passes, above fails, private na", () => {
    const pub = { companyClass: "public" as const };
    expect(run("roc.borrowing-limit", baseExtract({ company: pub, current: { longTermBorrowings: 40 * 1_00_000_00 } })).status).toBe("pass");
    expect(run("roc.borrowing-limit", baseExtract({ company: pub, current: { longTermBorrowings: 40 * 1_00_000_00 + 1 } })).status).toBe("fail");
    expect(run("roc.borrowing-limit", baseExtract({ current: { longTermBorrowings: 100 * CR } })).status).toBe("na");
    expect(run("roc.borrowing-limit", baseExtract({ current: { longTermBorrowings: 100 * CR } }), { classes: ["private"] }).status).toBe("fail");
  });
});
