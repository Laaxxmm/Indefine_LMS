import { describe, expect, it } from "vitest";
import { ChecklistPackSchema, loadRuleSet, type RuleDefinition } from "@/lib/agents/core/checklist";
import type { JobContext } from "@/lib/agents/core/runner";
import { closeMonth, expenseSpikes, normalizeExtract, type BooksExtract, type Suggestion } from "./analysis";
import { LEDGER_ALIASES, STATEMENT_ALIASES, parseBank } from "./bank";
import { BOOKS_CHECKLIST, booksRegistry, type BooksCheckInput } from "./rules";
import { parseGstSummary, parseSchedules, parseTdsChallans, parseTdsDeducted } from "./statutory";
import { parseCsv } from "./table";
import { parseTb } from "./tb";

const JOB: JobContext = { jobTaskId: "j", title: "Books close", service: "Books", fy: "2026-27", period: "2026-10", clientCode: "ACME01", clientName: "Acme", assigneeId: null, reviewerId: null };

type Csvs = Partial<Record<"tb" | "priorTb" | "statement" | "ledger" | "tdsDeducted" | "tdsChallans" | "gstLedger" | "gstReturn" | "schedules", string>>;

function extract(c: Csvs, extra: Partial<BooksExtract> = {}): BooksExtract {
  const kinds: [keyof Csvs, string][] = [
    ["tb", "tb"],
    ["priorTb", "tb-prior"],
    ["statement", "bank-statement"],
    ["ledger", "bank-ledger"],
    ["tdsDeducted", "tds-deducted"],
    ["tdsChallans", "tds-challans"],
    ["gstLedger", "gst-ledger"],
    ["gstReturn", "gst-return"],
    ["schedules", "schedules"],
  ];
  const files = kinds.filter(([k]) => c[k] !== undefined).map(([, kind]) => ({ name: `${kind}.csv`, kind: kind as BooksExtract["files"][number]["kind"] }));
  const rows = (s?: string) => parseCsv(s ?? "");
  return normalizeExtract({
    files,
    tb: c.tb ? parseTb("tb.csv", rows(c.tb)).tb : null,
    priorTb: c.priorTb ? parseTb("tb-prior.csv", rows(c.priorTb)).tb : null,
    statement: c.statement ? parseBank("S", "bank-statement.csv", rows(c.statement), STATEMENT_ALIASES).data : null,
    ledger: c.ledger ? parseBank("L", "bank-ledger.csv", rows(c.ledger), LEDGER_ALIASES).data : null,
    tdsDeducted: c.tdsDeducted ? parseTdsDeducted("tds-deducted.csv", rows(c.tdsDeducted)).data : null,
    tdsChallans: c.tdsChallans ? parseTdsChallans("tds-challans.csv", rows(c.tdsChallans)).data : null,
    gstLedger: c.gstLedger ? parseGstSummary("gst-ledger.csv", rows(c.gstLedger)).data : null,
    gstReturn: c.gstReturn ? parseGstSummary("gst-return.csv", rows(c.gstReturn)).data : null,
    schedules: c.schedules ? parseSchedules("schedules.csv", rows(c.schedules)).data : null,
    ...extra,
  });
}

const ruleOf = (id: string): RuleDefinition => BOOKS_CHECKLIST.rules.find((r) => r.id === id) ?? { id, title: id, severity: "warn", kind: "deterministic", check: id, evidence: "x" };
const run = (id: string, e: BooksExtract, over: Partial<RuleDefinition> = {}, job: JobContext = JOB) => booksRegistry.get(id)!({ input: { files: [] }, extracted: e, figures: {}, job } as BooksCheckInput, { ...ruleOf(id), ...over });

const TB_OK = "Ledger,Group,Debit,Credit\nCash,Cash-in-Hand,100.00,\nRent,Indirect Expenses,900.00,\nCapital,Capital Account,,1000.00";
const STMT = "Date,Narration,Ref,Withdrawal,Deposit,Balance\n01/10/2026,Opening Balance,,,,1000.00\n03/10/2026,NEFT IN,U1,,500.00,1500.00\n05/10/2026,CHQ 451,451,200.00,,1300.00";
const LEDGER = "Date,Particulars,Vch No,Debit,Credit\n01/10/2026,Opening Balance,,1000.00,\n03/10/2026,Receipt,U1,500.00,\n04/10/2026,Chq 451,451,,200.00";

describe("pack", () => {
  it("default pack is valid, version 1.0.0, every deterministic rule implemented, thresholds carry verify notes", () => {
    expect(ChecklistPackSchema.safeParse(BOOKS_CHECKLIST).success).toBe(true);
    expect(BOOKS_CHECKLIST).toMatchObject({ key: "books", version: "1.0.0" });
    expect(loadRuleSet(BOOKS_CHECKLIST, booksRegistry).ok).toBe(true);
    for (const r of BOOKS_CHECKLIST.rules) {
      const numeric = Object.entries(r.params ?? {}).filter(([k, v]) => typeof v === "number" && k !== "tolerancePaise");
      if (numeric.length) expect(typeof r.params?.verify, r.id).toBe("string");
    }
    expect(BOOKS_CHECKLIST.rules.filter((r) => r.severity === "block").map((r) => r.id)).toEqual(["books.tb-balanced", "books.bank-recon-difference", "books.tds-not-deposited"]);
    expect(BOOKS_CHECKLIST.rules.find((r) => r.id === "books.tds-due-soon")?.severity).toBe("warn");
    expect(String(BOOKS_CHECKLIST.rules.find((r) => r.id === "books.tds-not-deposited")?.params?.verify)).toMatch(/partner to confirm SOP/);
  });
});

describe("books.tb-balanced (block)", () => {
  it("passes when debits = credits", () => expect(run("books.tb-balanced", extract({ tb: TB_OK })).status).toBe("pass"));
  it("fails when off by one paisa (boundary)", () => {
    const r = run("books.tb-balanced", extract({ tb: TB_OK.replace("1000.00", "999.99") }));
    expect(r.status).toBe("fail");
    expect(r.message).toContain("₹0.01");
  });
  it("fails when the TB cannot be read", () => expect(run("books.tb-balanced", extract({}, { files: [{ name: "tb.csv", kind: "tb" }] })).status).toBe("fail"));
  it("fails without any TB file at all", () => expect(run("books.tb-balanced", extract({})).evidence?.location).toBe("trial balance"));
});

describe("books.prior-tb-balanced (warn)", () => {
  it("is a warning, not a block (owner-approved 2026-11-05)", () => expect(ruleOf("books.prior-tb-balanced")).toMatchObject({ severity: "warn", params: { tolerancePaise: 0 } }));
  it("passes when the prior-month TB balances; na when none is supplied", () => {
    expect(run("books.prior-tb-balanced", extract({ tb: TB_OK, priorTb: TB_OK })).status).toBe("pass");
    expect(run("books.prior-tb-balanced", extract({ tb: TB_OK })).status).toBe("na");
  });
  it("fails when the prior-month TB is off by ₹1, even though the current TB balances", () => {
    // Debits 100 + 901 = 1,001 vs credits 1,000.
    const e = extract({ tb: TB_OK, priorTb: TB_OK.replace("900.00", "901.00") });
    const r = run("books.prior-tb-balanced", e);
    expect(r).toMatchObject({ status: "fail", evidence: { quote: "Total debits 1001.00 / total credits 1000.00", location: "tb-prior.csv (3 ledgers)" } });
    expect(r.message).toContain("difference ₹1.00");
    expect(run("books.tb-balanced", e).status).toBe("pass");
  });
  it("boundary: one paisa off fails; the tolerance param is honoured", () => {
    const e = extract({ tb: TB_OK, priorTb: TB_OK.replace("1000.00", "999.99") });
    expect(run("books.prior-tb-balanced", e).status).toBe("fail");
    expect(run("books.prior-tb-balanced", e, { params: { tolerancePaise: 1 } }).status).toBe("pass");
  });
  it("fails when a prior-month TB was supplied but cannot be read", () => {
    const r = run("books.prior-tb-balanced", extract({ tb: TB_OK }, { files: [{ name: "tb.csv", kind: "tb" }, { name: "prior-tb.csv", kind: "tb-prior" }] }));
    expect(r).toMatchObject({ status: "fail", evidence: { location: "prior-tb.csv" } });
  });
});

describe("books.parse-issues (warn)", () => {
  it("pass / fail", () => {
    expect(run("books.parse-issues", extract({ tb: TB_OK })).status).toBe("pass");
    expect(run("books.parse-issues", extract({ tb: TB_OK }, { issues: [{ file: "s.csv", row: 4, message: "bad" }] })).evidence?.location).toBe("s.csv row 4");
    expect(run("books.parse-issues", extract({ tb: TB_OK }, { issues: [{ file: "s.csv", row: 0, message: "bad" }] })).evidence?.location).toBe("s.csv");
  });
});

describe("bank rules", () => {
  it("na without both bank files", () => {
    for (const id of ["books.bank-recon-difference", "books.bank-stale-items", "books.bank-amount-only", "books.bank-duplicates"]) expect(run(id, extract({ statement: STMT })).status).toBe("na");
  });
  it("recon difference: pass when openings agree, fail when they differ, na without openings", () => {
    expect(run("books.bank-recon-difference", extract({ statement: STMT, ledger: LEDGER })).status).toBe("pass");
    const off = run("books.bank-recon-difference", extract({ statement: STMT, ledger: LEDGER.replace("Opening Balance,,1000.00", "Opening Balance,,999.99") }));
    expect(off.status).toBe("fail");
    expect(off.message).toContain("₹0.01");
    const noOpen = extract({ statement: STMT.replace(/,1000\.00\n|,1500\.00|,1300\.00/g, ","), ledger: LEDGER });
    noOpen.statement!.openingPaise = null;
    expect(run("books.bank-recon-difference", noOpen).status).toBe("na");
  });
  it("stale items: 30 days is not stale, 31 is (boundary at 31 Oct)", () => {
    const at30 = LEDGER + "\n01/10/2026,Chq 460,460,,10.00";
    const at31 = LEDGER + "\n30/09/2026,Chq 459,459,,10.00";
    expect(run("books.bank-stale-items", extract({ statement: STMT, ledger: at30 })).status).toBe("pass");
    const f = run("books.bank-stale-items", extract({ statement: STMT, ledger: at31 }));
    expect(f.status).toBe("fail");
    expect(f.evidence?.location).toBe("bank-ledger.csv row 5");
    expect(run("books.bank-stale-items", extract({ statement: STMT, ledger: at31 }), { params: { staleDays: 31 } }).status).toBe("pass");
    const stmtStale = run("books.bank-stale-items", extract({ statement: STMT + "\n15/09/2026,FEE,,5.00,,", ledger: LEDGER }));
    expect(stmtStale.evidence?.location).toBe("bank-statement.csv row 5");
  });
  it("amount-only candidates are flagged (same month and different month wording)", () => {
    expect(run("books.bank-amount-only", extract({ statement: STMT, ledger: LEDGER })).status).toBe("pass");
    const same = run("books.bank-amount-only", extract({ statement: STMT + "\n02/10/2026,CHQ X,,400.00,,", ledger: LEDGER + "\n30/10/2026,Chq Y,,,400.00" }));
    expect(same.status).toBe("fail");
    expect(same.message).toContain("outside the matching window");
    const cross = run("books.bank-amount-only", extract({ statement: STMT + "\n02/10/2026,CHQ X,,400.00,,", ledger: LEDGER + "\n20/09/2026,Chq Y,,,400.00" }));
    expect(cross.message).toContain("different months");
  });
  it("duplicates on the statement and on the ledger", () => {
    expect(run("books.bank-duplicates", extract({ statement: STMT, ledger: LEDGER })).status).toBe("pass");
    const s = run("books.bank-duplicates", extract({ statement: STMT + "\n05/10/2026,CHQ 451,451,200.00,,", ledger: LEDGER }));
    expect(s.evidence?.location).toBe("bank-statement.csv rows 4, 5");
    const l = run("books.bank-duplicates", extract({ statement: STMT, ledger: LEDGER + "\n03/10/2026,Receipt,U1,500.00," }));
    expect(l.message).toContain("ledger");
  });
});

describe("TB-based warn rules", () => {
  it("suspense: nil passes, a balance fails, a custom pattern list is honoured, na without TB", () => {
    expect(run("books.suspense-nonzero", extract({ tb: TB_OK + "\nSuspense A/c,Suspense,0,0" })).status).toBe("pass");
    expect(run("books.suspense-nonzero", extract({ tb: TB_OK + "\nSuspense A/c,Suspense,0.01," })).status).toBe("fail");
    expect(run("books.suspense-nonzero", extract({ tb: TB_OK + "\nParking,Misc,5," }), { params: { patterns: ["parking"] } }).status).toBe("fail");
    expect(run("books.suspense-nonzero", extract({})).status).toBe("na");
  });
  it("negative cash: zero passes, a credit balance fails", () => {
    expect(run("books.negative-cash", extract({ tb: "Ledger,Group,Debit,Credit\nCash,Cash-in-Hand,0,0" })).status).toBe("pass");
    expect(run("books.negative-cash", extract({ tb: "Ledger,Group,Debit,Credit\nPetty Cash,Misc,,0.01" })).status).toBe("fail");
    expect(run("books.negative-cash", extract({})).status).toBe("na");
  });
  it("expense spike: needs both +50% and +₹50,000; exact boundaries", () => {
    const tb = (amt: string) => `Ledger,Group,Debit,Credit\nRepairs,Indirect Expenses,${amt},`;
    const prior = "Ledger,Group,Debit,Credit\nRepairs,Indirect Expenses,100000.00,";
    expect(run("books.expense-spike", extract({ tb: tb("150000.00"), priorTb: prior })).status).toBe("pass"); // +50% exactly: not above
    expect(run("books.expense-spike", extract({ tb: tb("150000.01"), priorTb: prior })).status).toBe("fail");
    expect(run("books.expense-spike", extract({ tb: tb("49999.99"), priorTb: "Ledger,Group,Debit,Credit\nX,Sales,,1" })).status).toBe("pass"); // new ledger, below ₹50,000
    expect(run("books.expense-spike", extract({ tb: tb("50000.00"), priorTb: "Ledger,Group,Debit,Credit\nX,Sales,,1" })).status).toBe("fail"); // new ledger at ₹50,000
    expect(run("books.expense-spike", extract({ tb: tb("150000.01") })).status).toBe("na");
    expect(run("books.expense-spike", extract({ tb: tb("150000.01"), priorTb: prior }), { params: { percent: 60, minIncreasePaise: 1 } }).status).toBe("pass");
  });
  it("expenseSpikes is integer arithmetic", () => {
    const cur = parseTb("a", parseCsv("Ledger,Group,Debit\nX,Direct Expenses,3")).tb!;
    const pri = parseTb("b", parseCsv("Ledger,Group,Debit\nx,Direct Expenses,2")).tb!;
    expect(expenseSpikes(cur, pri, 49, 1)).toHaveLength(1);
    expect(expenseSpikes(cur, pri, 50, 1)).toHaveLength(0);
  });
});

describe("TDS rules", () => {
  const DED = "Section,Deductee,Date,TDS Amount\n194I,L,07/10/2026,6000.00";
  // Preparation clock: IST days. 06:30 UTC = 12:00 IST; 20:00 UTC on 6 Nov = 01:30 IST on 7 Nov.
  const at = (iso: string) => new Date(iso);
  const runAt = (id: string, e: BooksExtract, preparedAt: Date | undefined) => booksRegistry.get(id)!({ input: { files: [] }, extracted: e, figures: {}, job: JOB, preparedAt } as BooksCheckInput, ruleOf(id));
  const NONE = extract({ tdsDeducted: DED, tdsChallans: "Challan No,Section,Deposit Date,For Month,Amount" });
  const SHORT = extract({ tdsDeducted: DED, tdsChallans: "Challan No,Section,Deposit Date,For Month,Amount\nC1,194I,07/11/2026,Oct-2026,5999.99" });
  it("not deposited: full deposit passes, ₹0.01 short fails (boundary), na without files; no clock → treated as overdue", () => {
    expect(run("books.tds-not-deposited", extract({ tdsDeducted: DED, tdsChallans: "Challan No,Section,Deposit Date,For Month,Amount\nC1,194I,07/11/2026,Oct-2026,6000.00" })).status).toBe("pass");
    const r = run("books.tds-not-deposited", SHORT);
    expect(r.status).toBe("fail");
    expect(r.message).toContain("due 07 Nov 2026; preparation date unknown — treated as overdue");
    expect(run("books.tds-not-deposited", extract({ tdsDeducted: DED })).status).toBe("na");
    expect(run("books.tds-due-soon", SHORT).status).toBe("na");
  });
  it("prepared before the due date (5 Nov, due 7 Nov): warn reminder with the due date, no block", () => {
    const soon = runAt("books.tds-due-soon", NONE, at("2026-11-05T06:30:00Z"));
    expect(soon.status).toBe("fail");
    expect(soon.message).toBe("Reminder — TDS deducted, not yet deposited, due date not reached (prepared 05 Nov 2026): 1 section/month line(s), ₹6,000.00 in all; first: section 194I for 2026-10, ₹6,000.00 to deposit by 07 Nov 2026 (2 day(s) left).");
    expect(soon.evidence).toEqual({ quote: "194I 2026-10 deducted 6000.00 deposited 0.00", location: "tds-deducted.csv row 2" });
    expect(runAt("books.tds-not-deposited", NONE, at("2026-11-05T06:30:00Z")).status).toBe("pass");
    // 01:30 IST on 7 Nov is the due date in India even though it is still 6 Nov in UTC.
    expect(runAt("books.tds-due-soon", NONE, at("2026-11-06T20:00:00Z")).status).toBe("pass");
    expect(runAt("books.tds-not-deposited", NONE, at("2026-11-06T20:00:00Z")).status).toBe("fail");
  });
  it("prepared on the due date blocks; after it blocks with the days overdue", () => {
    const onDue = runAt("books.tds-not-deposited", SHORT, at("2026-11-07T06:30:00Z"));
    expect(onDue.status).toBe("fail");
    expect(onDue.message).toContain("short by ₹0.01 (due 07 Nov 2026; prepared 07 Nov 2026, the due date itself)");
    expect(runAt("books.tds-due-soon", SHORT, at("2026-11-07T06:30:00Z")).status).toBe("pass");
    const late = runAt("books.tds-not-deposited", NONE, at("2026-11-20T06:30:00Z"));
    expect(late.message).toContain("prepared 20 Nov 2026, 13 day(s) after the due date");
  });
  it("mixed months: the overdue month blocks, the month not yet due warns", () => {
    const two = extract({ tdsDeducted: "Section,Deductee,Date,TDS Amount\n194C,A,20/09/2026,1000.00\n194C,B,20/10/2026,2500.00", tdsChallans: "Challan No,Section,Deposit Date,For Month,Amount" });
    const block = runAt("books.tds-not-deposited", two, at("2026-11-05T06:30:00Z"));
    expect(block.message).toMatch(/^TDS deducted but not deposited by the due date: 1 section\/month line\(s\), ₹1,000\.00 in all; first: section 194C for 2026-09/);
    const warn = runAt("books.tds-due-soon", two, at("2026-11-05T06:30:00Z"));
    expect(warn.message).toContain("1 section/month line(s), ₹2,500.00 in all; first: section 194C for 2026-10");
    // March deductions: due 30 April.
    const mar = extract({ tdsDeducted: "Section,Deductee,Date,TDS Amount\n194J,K,15/03/2027,10000", tdsChallans: "Challan No,Section,Deposit Date,For Month,Amount" });
    expect(runAt("books.tds-due-soon", mar, at("2027-04-29T06:30:00Z")).message).toContain("to deposit by 30 Apr 2027 (1 day(s) left)");
    expect(runAt("books.tds-not-deposited", mar, at("2027-04-30T06:30:00Z")).status).toBe("fail");
  });
  it("late: 7th is on time, 8th is late; March due 30 April", () => {
    expect(run("books.tds-late", extract({ tdsDeducted: DED, tdsChallans: "Challan No,Section,Deposit Date,For Month,Amount\nC1,194I,07/11/2026,Oct-2026,6000" })).status).toBe("pass");
    expect(run("books.tds-late", extract({ tdsDeducted: DED, tdsChallans: "Challan No,Section,Deposit Date,For Month,Amount\nC1,194I,08/11/2026,Oct-2026,6000" })).status).toBe("fail");
    const mar = "Section,Deductee,Date,TDS Amount\n194J,K,15/03/2026,10000";
    expect(run("books.tds-late", extract({ tdsDeducted: mar, tdsChallans: "Challan No,Section,Deposit Date,For Month,Amount\nC,194J,30/04/2026,Mar-2026,10000" })).status).toBe("pass");
    const late = run("books.tds-late", extract({ tdsDeducted: mar, tdsChallans: "Challan No,Section,Deposit Date,For Month,Amount\nC,194J,01/05/2026,Mar-2026,10000" }));
    expect(late.message).toContain("due 30 Apr 2026 (1 days late");
    expect(run("books.tds-late", extract({})).status).toBe("na");
  });
});

describe("books.gst-mismatch (warn)", () => {
  const L = "Ledger,Closing Balance\nOutput CGST,100.00 Cr";
  it("₹1.00 difference is within tolerance; ₹1.01 is not; missing head fails; na without files", () => {
    expect(run("books.gst-mismatch", extract({ gstLedger: L, gstReturn: "Head,Amount\nOutput CGST,99.00" })).status).toBe("pass");
    expect(run("books.gst-mismatch", extract({ gstLedger: L, gstReturn: "Head,Amount\nOutput CGST,98.99" })).status).toBe("fail");
    const miss = run("books.gst-mismatch", extract({ gstLedger: L, gstReturn: "Head,Amount\nOutput CGST,100\nITC IGST,5" }));
    expect(miss.evidence?.location).toBe("gst-return.csv row 3");
    expect(run("books.gst-mismatch", extract({ gstLedger: L, gstReturn: "Head,Amount\nOutput CGST,98.99" }), { params: { tolerancePaise: 101 } }).status).toBe("pass");
    expect(run("books.gst-mismatch", extract({ gstLedger: L })).status).toBe("na");
  });
});

describe("info rules", () => {
  it("inputs missing lists what is absent", () => {
    const all = extract({ tb: TB_OK, priorTb: TB_OK, statement: STMT, ledger: LEDGER, tdsDeducted: "Section,Date,TDS\n192,01/10/2026,1", tdsChallans: "Deposit Date,Amount\n01/11/2026,1", gstLedger: "Ledger,Amount\nOutput CGST,1", gstReturn: "Head,Amount\nOutput CGST,1", schedules: "Type,Item,Amount\nAccrual,X,1" });
    expect(run("books.inputs-missing", all).status).toBe("pass");
    expect(run("books.inputs-missing", extract({ tb: TB_OK })).message).toContain("Bank statement");
  });
  it("schedule reminders: in range fails (info), out of range passes, na without schedules", () => {
    const s = (from: string, to: string) => `Type,Item,Ledger,Monthly Amount,From,To\nPrepaid,Ins,Insurance,3000,${from},${to}`;
    expect(run("books.schedule-reminders", extract({ schedules: s("2026-10", "2026-10") })).status).toBe("fail");
    expect(run("books.schedule-reminders", extract({ schedules: s("2026-11", "2027-03") })).status).toBe("pass");
    expect(run("books.schedule-reminders", extract({})).status).toBe("na");
  });
  const sg = (confidence: number, status: Suggestion["status"] = "suggested", evidence: Suggestion["evidence"] = { quote: "RENT", location: "S1" }): Suggestion => ({ lineId: "S1", ledger: "Rent", confidence, reason: "r", status, evidence });
  it("low-confidence suggestions: 0.75 passes, 0.74 fails; abstentions are not 'low confidence'", () => {
    expect(run("books.suggestions-low-confidence", extract({}, { suggestions: [sg(0.75)] })).status).toBe("pass");
    const f = run("books.suggestions-low-confidence", extract({}, { suggestions: [sg(0.74)] }));
    expect(f.status).toBe("fail");
    expect(f.evidence).toEqual({ quote: "RENT", location: "S1" });
    expect(run("books.suggestions-low-confidence", extract({}, { suggestions: [sg(0.74, "suggested", null)] })).evidence?.location).toBe("Expense suggestions S1");
    expect(run("books.suggestions-low-confidence", extract({}, { suggestions: [sg(0.1, "insufficient_evidence")] })).status).toBe("pass");
  });
  it("classification questions: insufficient_evidence and ungrounded answers become reviewer questions", () => {
    expect(run("books.classification-questions", extract({}, { suggestions: [sg(0.9)] })).status).toBe("pass");
    const withLine = extract({ statement: "Date,Narration,Withdrawal,Deposit\n02/10/2026,TRF 88231,500.00," }, { suggestions: [sg(0, "insufficient_evidence", null)] });
    const q = run("books.classification-questions", withLine);
    expect(q.status).toBe("fail");
    expect(q.evidence).toEqual({ quote: "TRF 88231", location: "bank-statement.csv row 2" });
    expect(run("books.classification-questions", extract({}, { suggestions: [sg(0, "ungrounded", null)] })).evidence?.location).toBe("Expense suggestions S1");
  });
});

describe("parameterised checks used by promoted mistakes", () => {
  it("ledger-over-limit", () => {
    const e = extract({ tb: "Ledger,Group,Debit,Credit\nCash in Hand,Cash-in-Hand,200000.01," });
    expect(run("books.ledger-over-limit", e, { params: { ledgerPatterns: ["^cash"], limitPaise: 20000000 } }).status).toBe("fail");
    expect(run("books.ledger-over-limit", e, { params: { ledgerPatterns: ["^cash"], limitPaise: 20000001 } }).status).toBe("pass");
    expect(run("books.ledger-over-limit", e, { params: { groupPatterns: ["cash-in-hand"], limitPaise: 1 } }).status).toBe("fail");
    expect(run("books.ledger-over-limit", e, { params: { ledgerPatterns: "bad" } }).status).toBe("pass");
    expect(run("books.ledger-over-limit", extract({})).status).toBe("na");
  });
  it("round-withdrawals", () => {
    const e = extract({ statement: "Date,Narration,Withdrawal,Deposit\n02/10/2026,X,200000.00,\n03/10/2026,Y,,500000.00" });
    expect(run("books.round-withdrawals", e, { params: { minPaise: 20000000, multiplePaise: 5000000 } }).status).toBe("fail");
    expect(run("books.round-withdrawals", e, { params: { minPaise: 20000001, multiplePaise: 5000000 } }).status).toBe("pass");
    expect(run("books.round-withdrawals", e).status).toBe("fail"); // defaults ₹1,00,000 / ₹10,000
    expect(run("books.round-withdrawals", extract({})).status).toBe("na");
  });
  it("narration-watch", () => {
    const e = extract({ statement: "Date,Narration,Withdrawal,Deposit\n02/10/2026,ATM WDL MG ROAD,2000.00," });
    expect(run("books.narration-watch", e, { params: { words: ["atm wdl"] } }).status).toBe("fail");
    expect(run("books.narration-watch", e, { params: { words: ["self chq"] } }).status).toBe("pass");
    expect(run("books.narration-watch", e).status).toBe("pass");
    expect(run("books.narration-watch", extract({})).status).toBe("na");
  });
  it("a partial extract (replayed example) is normalised before the body runs", () => {
    const partial = { statement: { file: "s.csv", openingPaise: 0, lines: [{ id: "S1", row: 2, date: "2026-10-12", narration: "ATM WDL", ref: "", amountPaise: -2000000 }] } };
    const r = booksRegistry.get("books.narration-watch")!({ input: undefined, extracted: partial, figures: {}, job: JOB } as unknown as BooksCheckInput, { ...ruleOf("books.narration-watch"), params: { words: ["atm wdl"] } });
    expect(r.status).toBe("fail");
    expect(booksRegistry.get("books.inputs-missing")!({ input: undefined, extracted: partial, figures: {}, job: JOB } as unknown as BooksCheckInput, ruleOf("books.inputs-missing")).status).toBe("fail");
  });
});

describe("closeMonth", () => {
  it("uses YYYY-MM periods, else the FY's March", () => {
    expect(closeMonth({ period: "2026-10", fy: "2026-27" })).toBe("2026-10");
    expect(closeMonth({ period: "Annual", fy: "2026-27" })).toBe("2027-03");
    expect(closeMonth({ period: "Q1", fy: "bad" })).toBe("2027-03");
  });
});
