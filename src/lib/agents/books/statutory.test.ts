import { describe, expect, it } from "vitest";
import { gstHeadOf, gstTieOut, parseGstSummary, parseSchedules, parseTdsChallans, parseTdsDeducted, remindersFor, tdsCheck, tdsDueDate, type TdsChallan, type TdsDeduction } from "./statutory";
import { parseCsv } from "./table";

const ded = (section: string, month: string, amountPaise: number, row = 2): TdsDeduction => ({ row, section, party: "P", date: `${month}-10`, month, amountPaise });
const ch = (section: string, month: string, depositDate: string, amountPaise: number, row = 2): TdsChallan => ({ row, challan: `C${row}`, section, depositDate, month, amountPaise, monthInferred: false });

describe("tdsDueDate", () => {
  it("7th of next month; December rolls into January", () => {
    expect(tdsDueDate("2026-10")).toBe("2026-11-07");
    expect(tdsDueDate("2026-12")).toBe("2027-01-07");
  });
  it("March deductions are due 30 April", () => expect(tdsDueDate("2026-03")).toBe("2026-04-30"));
  it("takes the due-date data as a parameter", () => expect(tdsDueDate("2026-03", { dayOfNextMonth: 10, march: { month: 5, day: 31 } })).toBe("2026-05-31"));
});

describe("tdsCheck", () => {
  it("on the due date is on time; one day after is late (boundary)", () => {
    const onTime = tdsCheck([ded("194J", "2026-03", 1000)], [ch("194J", "2026-03", "2026-04-30", 1000)]);
    expect(onTime[0]).toMatchObject({ shortfallPaise: 0, late: [], dueDate: "2026-04-30", lastDepositDate: "2026-04-30" });
    const late = tdsCheck([ded("194J", "2026-03", 1000)], [ch("194J", "2026-03", "2026-05-01", 1000)]);
    expect(late[0].late).toEqual([{ challan: "C2", depositDate: "2026-05-01", daysLate: 1, amountPaise: 1000, row: 2 }]);
  });
  it("shortfall by section and month; excess challans are kept on their own line", () => {
    const lines = tdsCheck([ded("194C", "2026-10", 2500), ded("192", "2026-10", 14000)], [ch("192", "2026-10", "2026-11-06", 14000), ch("194H", "2026-09", "2026-10-05", 300)]);
    expect(lines.map((l) => [l.month, l.section, l.deductedPaise, l.depositedPaise, l.shortfallPaise])).toEqual([
      ["2026-09", "194H", 0, 300, 0],
      ["2026-10", "192", 14000, 14000, 0],
      ["2026-10", "194C", 2500, 0, 2500],
    ]);
  });
  it("a challan without a section fills the short sections of its month in section order", () => {
    const lines = tdsCheck([ded("194C", "2026-10", 100), ded("194J", "2026-10", 200)], [ch("", "2026-10", "2026-11-05", 250), ch("", "2026-08", "2026-09-05", 40)]);
    expect(lines.map((l) => [l.section, l.depositedPaise, l.shortfallPaise])).toEqual([
      ["(none)", 40, 0],
      ["194C", 100, 0],
      ["194J", 150, 50],
    ]);
    const over = tdsCheck([ded("194C", "2026-10", 100)], [ch("", "2026-10", "2026-11-05", 150)]);
    expect(over[0].depositedPaise).toBe(150);
  });
  it("parses ledgers and challans; infers the month when the challan has none", () => {
    const d = parseTdsDeducted("t.csv", parseCsv("Section,Deductee,Date,TDS Amount\nSec. 194 C,X,25/10/2026,\"2,500.00\"\nTotal,,,2500\n194J,Y,bad,10"));
    expect(d.data).toEqual([{ row: 2, section: "194C", party: "X", date: "2026-10-25", month: "2026-10", amountPaise: 250000 }]);
    expect(d.issues).toHaveLength(1);
    const c = parseTdsChallans("c.csv", parseCsv("Challan No,Section,Deposit Date,Amount\nCH1,194C,06/11/2026,2500\n,,,\nCH2,194C,nope,1"));
    expect(c.data![0]).toMatchObject({ month: "2026-10", monthInferred: true, amountPaise: 250000 });
    expect(c.issues).toHaveLength(1);
    expect(parseTdsDeducted("t.csv", parseCsv("a,b")).data).toBeNull();
    expect(parseTdsChallans("t.csv", parseCsv("a,b")).data).toBeNull();
    const withMonth = parseTdsDeducted("t.csv", parseCsv("Section,Month,TDS\n192,Oct-2026,10"));
    expect(withMonth.data![0]).toMatchObject({ month: "2026-10", date: "2026-10-01" });
  });
});

describe("GST tie-out", () => {
  it.each([
    ["Output CGST", "output-cgst"],
    ["3.1(a) Output SGST", "output-sgst"],
    ["IGST Payable", "output-igst"],
    ["4(A) ITC CGST", "itc-cgst"],
    ["Input IGST", "itc-igst"],
    ["Cess - input", "itc-cess"],
    ["UTGST output", "output-sgst"],
    ["Integrated tax liability", "output-igst"],
  ])("%s → %s", (label, head) => expect(gstHeadOf(label)).toBe(head));
  it("refuses ambiguous or non-tax labels", () => {
    expect(gstHeadOf("CGST")).toBeNull();
    expect(gstHeadOf("Rent")).toBeNull();
    expect(gstHeadOf("Output input CGST")).toBeNull();
  });
  it("compares magnitudes per head; heads on one side only are differences", () => {
    const books = parseGstSummary("l.csv", parseCsv("Ledger,Closing Balance\nOutput CGST,\"100.00 Cr\"\nInput IGST,50 Dr\nRent,10\nTotal,1")).data!;
    const filed = parseGstSummary("r.csv", parseCsv("Head,Amount\nOutput CGST,99.00\nOutput SGST,7")).data!;
    expect(gstTieOut(books, filed)).toEqual([
      { head: "output-cgst", booksPaise: 10000, returnPaise: 9900, differencePaise: 100, booksRow: 2, returnRow: 2 },
      { head: "output-sgst", booksPaise: null, returnPaise: 700, differencePaise: -700, booksRow: null, returnRow: 3 },
      { head: "itc-igst", booksPaise: 5000, returnPaise: null, differencePaise: 5000, booksRow: 3, returnRow: null },
    ]);
    expect(parseGstSummary("x.csv", parseCsv("Ledger,Closing Balance\nRent,10")).issues).toHaveLength(1);
    expect(parseGstSummary("x.csv", parseCsv("a,b")).data).toBeNull();
  });
});

describe("schedules", () => {
  it("parses types and gives the items to book in a month (inclusive range)", () => {
    const { data, issues } = parseSchedules(
      "s.csv",
      parseCsv("Type,Item,Ledger,Monthly Amount,From,To\nPrepaid,Ins,Insurance,3000,2026-04,2026-10\nAccrual,Audit,Audit Fees,100,,\nDepreciation,Laptop,Dep,50,2026-11,\nMystery,X,Y,1,,\n,,,,,"),
    );
    expect(issues).toHaveLength(1);
    expect(data!.map((d) => d.type)).toEqual(["prepaid", "accrual", "fixed-asset"]);
    expect(remindersFor(data!, "2026-10").map((d) => d.item)).toEqual(["Ins", "Audit"]);
    expect(remindersFor(data!, "2026-11").map((d) => d.item)).toEqual(["Audit", "Laptop"]);
    expect(parseSchedules("s.csv", parseCsv("a,b")).data).toBeNull();
  });
});
