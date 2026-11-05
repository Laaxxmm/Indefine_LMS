import { describe, expect, it } from "vitest";
import { CARO_CLAUSES, caroChecklist, caroPendingVerification, determineCaro, fyEndOf, type EntityProfile } from "./caro";
import { CARO, OPINION_PHRASES, WP_INDEX } from "./config";
import { opinionHits } from "./opinion";

const CR = 1_000_000_000; // ₹1 crore in paise
const base: EntityProfile = {
  companyClass: "private",
  holdingOrSubsidiary: false,
  holdingOrSubsidiaryOfPublic: false,
  paidUpCapitalPaise: 0.1 * CR,
  reservesPaise: 0.155 * CR,
  maxBorrowingsPaise: 0.24 * CR,
  turnoverPaise: 1.2 * CR,
  priorTurnoverPaise: 1 * CR,
  materialityPaise: null,
};
const p = (over: Partial<EntityProfile>): EntityProfile => ({ ...base, ...over });
const tbNone = { revenuePaise: null, priorRevenuePaise: null };
const facts = { ppePaise: 1, inventoryPaise: 1, investmentsPaise: 0, loansAdvancesPaise: 1, borrowingsPaise: 1 };

describe("determineCaro — para 1(2)", () => {
  it("no profile → undetermined", () => expect(determineCaro(null, tbNone).status).toBe("undetermined"));
  it.each(["llp", "partnership", "proprietorship", "trust", "other-non-company"] as const)("%s is not a company → not applicable", (c) => {
    expect(determineCaro(p({ companyClass: c }), tbNone).status).toBe("not-applicable");
  });
  it.each(["banking", "insurance", "section8", "opc"] as const)("%s is excluded", (c) => {
    const d = determineCaro(p({ companyClass: c }), tbNone);
    expect(d.status).toBe("not-applicable");
    expect(d.reasons[0]).toMatch(/Excluded by para 1\(2\)/);
  });
  it("public company → applicable", () => expect(determineCaro(p({ companyClass: "public" }), tbNone).status).toBe("applicable"));
  it("small company under the VERIFIED limits (≤ ₹4 crore paid-up and ≤ ₹40 crore preceding-year turnover) → not applicable", () => {
    const d = determineCaro(p({ paidUpCapitalPaise: 4 * CR, priorTurnoverPaise: 40 * CR, reservesPaise: 50 * CR }), tbNone, "2026-03-31");
    expect(d.status).toBe("not-applicable");
    expect(d.reasons[0]).toBe("Small company: paid-up capital ≤ ₹4 crore and preceding-year turnover ≤ ₹40 crore (limits as tested), not a holding/subsidiary");
  });
  it("paid-up ₹4 crore + 1 paisa → not small; exemption fails on capital → applicable", () => {
    const d = determineCaro(p({ paidUpCapitalPaise: 4 * CR + 1 }), tbNone, "2026-03-31");
    expect(d.status).toBe("applicable");
    expect(d.reasons.join(" ")).toMatch(/Not a small company.*paid-up capital \+ reserves above/);
  });
  it("preceding-year turnover above ₹40 crore → not small (the unverified ₹100 crore limit is never applied)", () => {
    expect(determineCaro(p({ priorTurnoverPaise: 40 * CR + 1, turnoverPaise: 40 * CR }), tbNone, "2026-03-31").reasons[0]).toBe("Not a small company");
    expect(determineCaro(p({ priorTurnoverPaise: 100 * CR, turnoverPaise: 40 * CR }), tbNone, "2026-03-31").status).toBe("applicable");
    // FY unknown → still only verified limits applied.
    expect(determineCaro(p({ paidUpCapitalPaise: 6 * CR }), tbNone).status).toBe("applicable");
  });
  it("prior turnover falls back to the prior-year TB revenue", () => {
    expect(determineCaro(p({ priorTurnoverPaise: null }), { revenuePaise: null, priorRevenuePaise: 1 * CR }).status).toBe("not-applicable");
    // Exempt either way → not applicable even though "small" cannot be decided.
    expect(determineCaro(p({ priorTurnoverPaise: null, holdingOrSubsidiary: undefined }), tbNone).status).toBe("not-applicable");
    // Exemption fails (borrowings ₹2 crore) and "small" cannot be decided → undetermined, listing what is missing.
    const d = determineCaro(p({ priorTurnoverPaise: null, holdingOrSubsidiary: undefined, maxBorrowingsPaise: 2 * CR }), tbNone);
    expect(d.status).toBe("undetermined");
    expect(d.missing).toEqual(expect.arrayContaining(["turnover of the preceding financial year (or the prior-year TB)", "whether the company is a holding or subsidiary company"]));
  });
  it("special-act or holding/subsidiary companies are never small", () => {
    expect(determineCaro(p({ specialAct: true }), tbNone).reasons[0]).toBe("Not a small company");
  });

  describe("private-company exemption (not small: a subsidiary of a private company)", () => {
    const sub = (over: Partial<EntityProfile>) => p({ holdingOrSubsidiary: true, ...over });
    it("exactly at every limit → exempt (limits are 'not more than')", () => {
      expect(determineCaro(sub({ paidUpCapitalPaise: 0.4 * CR, reservesPaise: 0.6 * CR, maxBorrowingsPaise: 1 * CR, turnoverPaise: 10 * CR }), tbNone).status).toBe("not-applicable");
    });
    it.each([
      ["capital + reserves", { paidUpCapitalPaise: 0.4 * CR, reservesPaise: 0.6 * CR + 1 }],
      ["borrowings", { maxBorrowingsPaise: 1 * CR + 1 }],
      ["revenue", { turnoverPaise: 10 * CR + 1 }],
      ["subsidiary of a public company", { holdingOrSubsidiaryOfPublic: true }],
    ])("one paisa over on %s → applicable", (_l, over) => {
      expect(determineCaro(sub(over as Partial<EntityProfile>), tbNone).status).toBe("applicable");
    });
    it("revenue falls back to TB revenue + other income", () => {
      expect(determineCaro(sub({ turnoverPaise: null }), { revenuePaise: 10 * CR + 1, priorRevenuePaise: null }).status).toBe("applicable");
      expect(determineCaro(sub({ turnoverPaise: null }), { revenuePaise: 10 * CR, priorRevenuePaise: null }).status).toBe("not-applicable");
    });
    it("unknown inputs → undetermined, listing what is missing", () => {
      const d = determineCaro(sub({ reservesPaise: null, maxBorrowingsPaise: null, turnoverPaise: null, holdingOrSubsidiaryOfPublic: undefined }), tbNone);
      expect(d.status).toBe("undetermined");
      expect(d.missing).toHaveLength(4);
    });
    it("small-company status unknown but the exemption clearly fails → undetermined (cannot rule out 'small')", () => {
      const d = determineCaro(p({ holdingOrSubsidiary: undefined, maxBorrowingsPaise: 2 * CR }), tbNone);
      expect(d.status).toBe("undetermined");
    });
  });
});

describe("small-company limits awaiting partner verification", () => {
  it("fyEndOf", () => {
    expect(fyEndOf("2025-26")).toBe("2026-03-31");
    expect(fyEndOf(null)).toBeNull();
    expect(fyEndOf("FY26")).toBeNull();
  });
  it("CARO.smallCompany is the ROC table: ₹4 cr / ₹40 cr verified, ₹10 cr / ₹100 cr unverified", () => {
    expect(CARO.smallCompany.map((l) => [l.verified, l.paidUpMaxPaise / CR, l.turnoverMaxPaise / CR])).toEqual([
      [true, 4, 40],
      [false, 10, 100],
    ]);
  });
  it("between the limit sets (paid-up ₹6 cr, prior turnover ₹70 cr): applicable as applied, not applicable under the pending limits", () => {
    const prof = p({ paidUpCapitalPaise: 6 * CR, priorTurnoverPaise: 70 * CR, turnoverPaise: 75 * CR, reservesPaise: 4.5 * CR, maxBorrowingsPaise: 2 * CR });
    expect(determineCaro(prof, tbNone, "2026-03-31").status).toBe("applicable");
    const pend = caroPendingVerification(prof, tbNone, "2026-03-31");
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ effectiveFrom: "2025-12-01", paidUpMaxPaise: 10 * CR, turnoverMaxPaise: 100 * CR, status: "not-applicable", applied: { effectiveFrom: "2022-09-15", paidUpMaxPaise: 4 * CR, turnoverMaxPaise: 40 * CR } });
    expect(pend[0].reasons[0]).toMatch(/^Small company: paid-up capital ≤ ₹10 crore/);
  });
  it("same outcome either way, or an FY that ends before the unverified entry → nothing pending", () => {
    expect(caroPendingVerification(base, tbNone, "2026-03-31")).toEqual([]); // small under both
    expect(caroPendingVerification(p({ paidUpCapitalPaise: 11 * CR }), tbNone, "2026-03-31")).toEqual([]); // not small under either
    expect(caroPendingVerification(p({ companyClass: "public", paidUpCapitalPaise: 6 * CR }), tbNone, "2026-03-31")).toEqual([]);
    // Subsidiary of a private company, exempt by the para 1(2)(v) limits whatever its small status.
    expect(caroPendingVerification(p({ holdingOrSubsidiary: true }), tbNone, "2026-03-31")).toEqual([]);
    expect(caroPendingVerification(p({ paidUpCapitalPaise: 6 * CR }), tbNone, "2025-03-31")).toEqual([]);
    // FY unknown → the pending entry is considered (conservative).
    expect(caroPendingVerification(p({ paidUpCapitalPaise: 6 * CR }), tbNone)).toHaveLength(1);
  });
});

describe("CARO clause checklist", () => {
  it("21 clauses 3(i)…3(xxi), every clause has a WP ref and information", () => {
    expect(CARO_CLAUSES.map((c) => c.clause)).toEqual(Array.from({ length: 21 }, (_, i) => `3(${["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx", "xxi"][i]})`));
    for (const c of CARO_CLAUSES) expect(c.wp && c.information).toBeTruthy();
  });
  it("Order not applicable → every clause not applicable with the reason", () => {
    const rows = caroChecklist({ status: "not-applicable", reasons: ["Small company"], missing: [] }, base, facts);
    expect(rows.every((r) => r.applicability === "Not applicable" && r.basis.includes("Small company"))).toBe(true);
  });
  it("public company: applicability per clause from TB facts and profile flags", () => {
    const prof = p({ companyClass: "public" });
    const rows = caroChecklist(determineCaro(prof, tbNone), prof, facts);
    const by = Object.fromEntries(rows.map((r) => [r.clause, r.applicability]));
    expect(by["3(i)"]).toBe("Applicable");
    expect(by["3(vi)"]).toBe("To determine");
    expect(by["3(xii)"]).toBe("Not applicable");
    expect(by["3(xiv)"]).toBe("Not applicable");
    expect(by["3(xx)"]).toBe("To determine");
    expect(by["3(xxi)"]).toBe("Not applicable");
    expect(rows.filter((r) => r.applicability === "Applicable")).toHaveLength(16);
  });
  it("facts and flags switch clauses; undetermined Order turns 'Applicable' into 'To determine'", () => {
    const prof = p({ companyClass: "public", costRecordsApplicable: true, csrApplicable: false, nidhi: true, consolidated: true, nbfc: true, hasInventory: false });
    const none = { ppePaise: 0, inventoryPaise: 0, investmentsPaise: 0, loansAdvancesPaise: 0, borrowingsPaise: 0 };
    const by = Object.fromEntries(caroChecklist({ status: "applicable", reasons: [], missing: [] }, prof, none).map((r) => [r.clause, [r.applicability, r.basis]]));
    expect(by["3(i)"][0]).toBe("To determine");
    expect(by["3(ii)"][0]).toBe("Not applicable");
    expect(by["3(iii)"][0]).toBe("To determine");
    expect(by["3(vi)"][0]).toBe("Applicable");
    expect(by["3(ix)"][0]).toBe("To determine");
    expect(by["3(xii)"][0]).toBe("Applicable");
    expect(by["3(xvi)"][1]).toMatch(/NBFC/);
    expect(by["3(xx)"][0]).toBe("Not applicable");
    expect(by["3(xxi)"][0]).toBe("Applicable");
    const und = caroChecklist({ status: "undetermined", reasons: [], missing: ["x"] }, prof, facts);
    expect(und.some((r) => r.applicability === "Applicable")).toBe(false);
    expect(caroChecklist({ status: "applicable", reasons: [], missing: [] }, p({ hasInventory: true }), none).find((r) => r.clause === "3(ii)")!.applicability).toBe("Applicable");
  });
  it.each([
    [{ internalAuditRequired: true }, "Applicable"],
    [{ internalAuditRequired: false }, "Not applicable"],
    [{ listed: true, companyClass: "public" as const }, "Applicable"],
    [{ companyClass: "public" as const, paidUpCapitalPaise: 50 * CR }, "Applicable"],
    [{ companyClass: "public" as const, paidUpCapitalPaise: null }, "To determine"],
    [{ turnoverPaise: 200 * CR }, "Applicable"],
    [{ maxBorrowingsPaise: 100 * CR }, "Applicable"],
    [{ maxBorrowingsPaise: null }, "To determine"],
  ])("internal audit 3(xiv): %j → %s", (over, want) => {
    const prof = p(over as Partial<EntityProfile>);
    expect(caroChecklist({ status: "applicable", reasons: [], missing: [] }, prof, facts).find((r) => r.clause === "3(xiv)")!.applicability).toBe(want);
  });
  it("a null profile leaves profile-driven clauses to determine", () => {
    const rows = caroChecklist({ status: "applicable", reasons: [], missing: [] }, null, facts);
    expect(rows.find((r) => r.clause === "3(xiv)")!.applicability).toBe("To determine");
    expect(rows.find((r) => r.clause === "3(vi)")!.applicability).toBe("To determine");
  });
});

describe("no opinion wording in the agent's own text (data)", () => {
  it("WP index, clause basis/information and the CARO thresholds note carry none; clause titles are exempt but also clean", () => {
    const own = [
      ...WP_INDEX.flatMap((w) => [w.section, w.description, w.sa]),
      ...CARO_CLAUSES.flatMap((c) => [c.information, ...[base, p({ companyClass: "public" })].flatMap((x) => c.decide(x, facts))]),
      CARO.verify,
    ];
    for (const t of own) expect(opinionHits(t), t).toEqual([]);
    for (const c of CARO_CLAUSES) expect(opinionHits(c.title)).toEqual([]);
    expect(OPINION_PHRASES).toContain("true and fair");
  });
});
