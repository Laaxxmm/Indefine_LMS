// Indian tax compliance deadlines for a financial year (Apr 1 – Mar 31).
// Faithful port of Neo Centra's seed/compliance_dates.ts — deadlines are computed
// from FY rules, so only completion status is stored (NeoComplianceStatus).

export type ComplianceType = "gstr3b" | "gstr1" | "tds_payment" | "advance_tax" | "itr" | "tds_return";

export type Deadline = {
  key: string; // stable id: "<type>:<period>"
  type: ComplianceType;
  title: string;
  description: string;
  dueDate: string; // ISO yyyy-mm-dd
  period: string;
};

export const TYPE_LABEL: Record<ComplianceType, string> = {
  gstr3b: "GSTR-3B",
  gstr1: "GSTR-1",
  tds_payment: "TDS Payment",
  advance_tax: "Advance Tax",
  itr: "ITR",
  tds_return: "TDS Return",
};

// The 12 FY months in order, with the calendar year they fall in.
const MONTHS = [
  { month: 4, name: "April" }, { month: 5, name: "May" }, { month: 6, name: "June" },
  { month: 7, name: "July" }, { month: 8, name: "August" }, { month: 9, name: "September" },
  { month: 10, name: "October" }, { month: 11, name: "November" }, { month: 12, name: "December" },
  { month: 1, name: "January" }, { month: 2, name: "February" }, { month: 3, name: "March" },
];

const fyLabel = (start: number) => `FY${start}-${String(start + 1).slice(2)}`;

// FY start year for a given ISO "today" (Apr–Mar). April (month index 3) onward => this year.
export function fyStartYearFor(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return m >= 4 ? y : y - 1;
}

// "due on the Nth of the month following the return month", handling the FY/cal-year roll.
function monthlyDeadlines(fyStart: number, day: string, type: ComplianceType, label: string, note: string): Deadline[] {
  return MONTHS.map(({ month, name }) => {
    const calYear = month >= 4 ? fyStart : fyStart + 1;
    const dueYear = month === 12 ? calYear + 1 : month >= 1 && month <= 3 ? fyStart + 1 : calYear;
    const dueMonth = month === 12 ? 1 : month + 1;
    const period = `${name} ${calYear}`;
    return {
      key: `${type}:${period}`,
      type,
      title: `${label} — ${period}`,
      description: note.replace("{period}", period),
      dueDate: `${dueYear}-${String(dueMonth).padStart(2, "0")}-${day}`,
      period,
    };
  });
}

export function generateDeadlines(fyStart: number): Deadline[] {
  const fy = fyLabel(fyStart);
  const out: Deadline[] = [];

  out.push(...monthlyDeadlines(fyStart, "20", "gstr3b", "GSTR-3B Filing", "Monthly GST return (GSTR-3B) for {period}. Due by 20th of following month."));
  out.push(...monthlyDeadlines(fyStart, "11", "gstr1", "GSTR-1 Filing", "Outward supply return (GSTR-1) for {period}. Due by 11th of following month."));
  out.push(...monthlyDeadlines(fyStart, "07", "tds_payment", "TDS Payment", "Monthly TDS/TCS deposit for {period}. Due by 7th of following month."));

  const advanceTax = [
    { dueDate: `${fyStart}-06-15`, period: "Q1 (Apr–Jun)", pct: "15%" },
    { dueDate: `${fyStart}-09-15`, period: "Q2 (Apr–Sep)", pct: "45%" },
    { dueDate: `${fyStart}-12-15`, period: "Q3 (Apr–Dec)", pct: "75%" },
    { dueDate: `${fyStart + 1}-03-15`, period: "Q4 (Apr–Mar)", pct: "100%" },
  ];
  for (const at of advanceTax) {
    out.push({ key: `advance_tax:${at.period}`, type: "advance_tax", title: `Advance Tax — ${at.period} ${fy}`, description: `Advance tax instalment ${at.pct} of annual liability due by ${at.dueDate}.`, dueDate: at.dueDate, period: at.period });
  }

  out.push({ key: `itr:${fy}`, type: "itr", title: `ITR Filing — ${fy}`, description: `Income Tax Return filing for Financial Year ${fyStart}-${fyStart + 1}.`, dueDate: `${fyStart + 1}-07-31`, period: fy });

  const tdsReturns = [
    { dueDate: `${fyStart}-07-31`, period: "Q1 (Apr–Jun)" },
    { dueDate: `${fyStart}-10-31`, period: "Q2 (Jul–Sep)" },
    { dueDate: `${fyStart + 1}-01-31`, period: "Q3 (Oct–Dec)" },
    { dueDate: `${fyStart + 1}-05-31`, period: "Q4 (Jan–Mar)" },
  ];
  for (const tr of tdsReturns) {
    out.push({ key: `tds_return:${tr.period}`, type: "tds_return", title: `TDS Return (26Q) — ${tr.period} ${fy}`, description: `Quarterly TDS return (Form 26Q) for ${tr.period}.`, dueDate: tr.dueDate, period: tr.period });
  }

  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
