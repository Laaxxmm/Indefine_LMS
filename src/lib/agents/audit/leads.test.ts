import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/agents/books/table";
import { parseTb } from "@/lib/agents/books/tb";
import { LEAD_AREAS } from "./config";
import { areaOf, buildLeads, isMaterialVariance, varianceBps } from "./leads";
import { OpinionLanguageError, WITHHELD, assertNoOpinion, findOpinionInSheets, opinionHits, sanitizeSheets, sanitizeText } from "./opinion";

const tb = (csv: string) => parseTb("tb.csv", parseCsv(`Ledger,Group,Debit,Credit\n${csv}`)).tb!;

describe("grouping map", () => {
  it.each([
    ["Capital Account", "L-A"],
    ["Reserves & Surplus", "L-A"],
    ["Loans (Liability)", "L-B"],
    ["Secured Loans", "L-B"],
    ["Unsecured Loans", "L-B"],
    ["Sundry Creditors", "L-C"],
    ["Duties & Taxes", "L-D"],
    ["Provisions", "L-D"],
    ["Current Liabilities", "L-D"],
    ["Fixed Assets", "L-E"],
    ["Investments", "L-F"],
    ["Stock-in-Hand", "L-G"],
    ["Sundry Debtors", "L-H"],
    ["Bank Accounts", "L-I"],
    ["Cash-in-Hand", "L-I"],
    ["Loans & Advances (Asset)", "L-J"],
    ["Deposits (Asset)", "L-J"],
    ["Current Assets", "L-J"],
    ["Sales Accounts", "L-K"],
    ["Direct Incomes", "L-K"],
    ["Indirect Incomes", "L-L"],
    ["Purchase Accounts", "L-M"],
    ["Direct Expenses", "L-M"],
    ["Indirect Expenses", "L-N"],
  ])("%s → %s", (group, wp) => expect(areaOf({ group, ledger: "x" })?.wp).toBe(wp));
  it("suspense / blank groups stay unmapped; a ledger pattern can map", () => {
    expect(areaOf({ group: "Suspense A/c", ledger: "Suspense" })).toBeNull();
    expect(areaOf({ group: "", ledger: "x" })).toBeNull();
    expect(areaOf({ group: "", ledger: "Misc" }, [{ wp: "Z", name: "Z", side: "dr", groups: [], ledgers: ["^misc"] }])?.wp).toBe("Z");
    expect(new Set(LEAD_AREAS.map((a) => a.wp)).size).toBe(LEAD_AREAS.length);
  });
});

describe("buildLeads", () => {
  it("sums CY and PY per area and per ledger; the leads tie when every ledger maps", () => {
    const cy = tb("Capital,Capital Account,,100\nCash,Cash-in-Hand,60,\nBank,Bank Accounts,40,");
    const py = tb("Capital,Capital Account,,80\ncash,Cash-in-Hand,80,");
    const r = buildLeads(cy, py);
    expect(r.schedules.map((s) => [s.wp, s.cyPaise, s.pyPaise, s.variancePaise])).toEqual([
      ["L-A", -10000, -8000, -2000],
      ["L-I", 10000, 8000, 2000],
    ]);
    expect(r.schedules[1].lines.map((l) => [l.ledger, l.cyPaise, l.pyPaise, l.row])).toEqual([
      ["Cash", 6000, 8000, 3],
      ["Bank", 4000, 0, 4],
    ]);
    expect(r.unmapped).toEqual([]);
    expect(r.tie).toEqual({ cyLeadsPaise: 0, cyTbNetPaise: 0, pyLeadsPaise: 0, pyTbNetPaise: 0, cyLeadsDebitPaise: 10000, cyTbDebitPaise: 10000 });
  });
  it("an unmapped ledger breaks the tie and is reported with its year and row", () => {
    const r = buildLeads(tb("Capital,Capital Account,,100\nSuspense,Suspense A/c,100,"), tb("Odd,Mystery,,5"));
    expect(r.unmapped).toEqual([
      { ledger: "Suspense", group: "Suspense A/c", row: 3, year: "CY", netPaise: 10000 },
      { ledger: "Odd", group: "Mystery", row: 2, year: "PY", netPaise: -500 },
    ]);
    expect(r.tie.cyLeadsPaise).not.toBe(r.tie.cyTbNetPaise);
    expect(buildLeads(tb("Cash,Cash-in-Hand,1,"), null).tie.pyLeadsPaise).toBeNull();
  });
  it("a ledger only in the prior year gets no CY row number", () => {
    const r = buildLeads(tb("Cash,Cash-in-Hand,1,"), tb("Bank,Bank Accounts,2,"));
    expect(r.schedules[0].lines.find((l) => l.ledger === "Bank")!.row).toBeNull();
  });
});

describe("variance materiality", () => {
  it("needs |Δ| ≥ PM AND |Δ|×100 ≥ pct×|PY|; exact boundaries; PY nil", () => {
    expect(isMaterialVariance({ cyPaise: 120, pyPaise: 100 }, 20, 20)).toBe(true); // Δ20 = PM, 20% exactly
    expect(isMaterialVariance({ cyPaise: 119, pyPaise: 100 }, 19, 20)).toBe(false); // 19%
    expect(isMaterialVariance({ cyPaise: 130, pyPaise: 100 }, 31, 20)).toBe(false); // below PM
    expect(isMaterialVariance({ cyPaise: 50, pyPaise: 0 }, 50, 20)).toBe(true);
    expect(isMaterialVariance({ cyPaise: 5, pyPaise: 5 }, 0, 20)).toBe(false);
    expect(isMaterialVariance({ cyPaise: -120, pyPaise: -100 }, 20, 20)).toBe(true);
  });
  it("variance basis points truncate; nil PY → null", () => {
    expect(varianceBps({ cyPaise: 120, pyPaise: 100 })).toBe(2000);
    expect(varianceBps({ cyPaise: -120, pyPaise: -100 })).toBe(-2000);
    expect(varianceBps({ cyPaise: 1, pyPaise: 3 })).toBe(-6666);
    expect(varianceBps({ cyPaise: 1, pyPaise: 0 })).toBeNull();
  });
});

describe("opinion guard", () => {
  it("finds phrases case- and space-insensitively", () => {
    expect(opinionHits("In  OUR\nopinion the accounts give a TRUE and fair view")).toEqual(["true and fair", "in our opinion", "give a true"]);
    expect(opinionHits("Draft for engagement partner")).toEqual([]);
    expect(sanitizeText("we report that x")).toBe(WITHHELD);
    expect(sanitizeText("plain")).toBe("plain");
  });
  const sheets = [
    { name: "CARO 2020", columns: [{ key: "title", header: "Title" }, { key: "basis", header: "Basis" }], rows: [{ title: "statutory wording: true and fair", basis: "ok", n: 1 }] },
    { name: "Notes", columns: [{ key: "note", header: "Note" }], rows: [{ note: "In our opinion revenue grew" }, { note: "fine" }] },
  ];
  it("CARO titles are exempt; everything else is checked, including sheet names and headers", () => {
    const hits = findOpinionInSheets(sheets, { "CARO 2020": ["title"] });
    expect(hits).toEqual([{ sheet: "Notes", row: 1, column: "note", phrase: "in our opinion" }]);
    expect(findOpinionInSheets([{ name: "We certify", columns: [{ key: "a", header: "Presents fairly" }], rows: [] }]).map((h) => h.column)).toEqual(["(sheet name)", "a"]);
  });
  it("sanitise then assert: passes; unsanitised throws OpinionLanguageError; title is checked", () => {
    const clean = sanitizeSheets(sheets, { "CARO 2020": ["title"] });
    expect(clean[1].rows[0].note).toBe(WITHHELD);
    expect(clean[0].rows[0].title).toBe("statutory wording: true and fair");
    expect(() => assertNoOpinion(clean, { "CARO 2020": ["title"] }, "Audit working papers")).not.toThrow();
    expect(() => assertNoOpinion(sheets, { "CARO 2020": ["title"] })).toThrow(OpinionLanguageError);
    expect(() => assertNoOpinion([], {}, "Our report: true and fair")).toThrow(/true and fair/);
  });
});
