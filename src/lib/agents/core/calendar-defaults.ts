// Default statutory calendar (seed for SopPack.calendar). DATA ONLY: the engine is calendar.ts.
// Every rule's `source` says what a partner must re-check; due dates are changed by notification
// and extension circulars, so the active SopPack (versioned, partner-approved) is the authority,
// not this file. Dates here are the standing statutory dates without any one-off extension.
import { CalendarPackSchema, type CalendarPack } from "./calendar";

// GSTR-3B under QRMP: 22nd or 24th of the month after the quarter, by state of registration.
// Grouped as in the CBIC notification that introduced QRMP (Nov 2020). The list MUST be checked
// against the current CBIC notification before go-live and whenever CBIC amends it.
// Codes are GST state codes.
const QRMP_3B_22ND = [
  "22", // Chhattisgarh
  "23", // Madhya Pradesh
  "24", // Gujarat
  "25", // Daman and Diu (pre-merger code)
  "26", // Dadra and Nagar Haveli and Daman and Diu
  "27", // Maharashtra
  "29", // Karnataka
  "30", // Goa
  "31", // Lakshadweep
  "32", // Kerala
  "33", // Tamil Nadu
  "34", // Puducherry
  "35", // Andaman and Nicobar Islands
  "36", // Telangana
  "37", // Andhra Pradesh
];
const QRMP_3B_24TH = [
  "01", // Jammu and Kashmir
  "02", // Himachal Pradesh
  "03", // Punjab
  "04", // Chandigarh
  "05", // Uttarakhand
  "06", // Haryana
  "07", // Delhi
  "08", // Rajasthan
  "09", // Uttar Pradesh
  "10", // Bihar
  "11", // Sikkim
  "12", // Arunachal Pradesh
  "13", // Nagaland
  "14", // Manipur
  "15", // Mizoram
  "16", // Tripura
  "17", // Meghalaya
  "18", // Assam
  "19", // West Bengal
  "20", // Jharkhand
  "21", // Odisha
  "38", // Ladakh
];

const raw = {
  schemaVersion: 1,
  bufferDays: 3,
  stateGroups: { "qrmp-3b-22": QRMP_3B_22ND, "qrmp-3b-24": QRMP_3B_24TH },
  rules: [
    // ---------------------------------------------------------------- GST
    {
      id: "gstr-1",
      form: "GSTR-1",
      title: "Outward supplies return",
      service: "GST",
      periodKinds: ["monthly", "quarterly"],
      due: { anchor: "period-end", addMonths: 1, day: 11 },
      variants: [
        { id: "qrmp-quarterly", when: { qrmp: true, periodKind: "quarterly" }, due: { anchor: "period-end", addMonths: 1, day: 13 } },
        { id: "iff", when: { qrmp: true, periodKind: "monthly", monthOfQuarter: [1, 2] }, due: { anchor: "period-end", addMonths: 1, day: 13 } },
        { id: "qrmp-third-month", when: { qrmp: true, periodKind: "monthly", monthOfQuarter: [3] }, notApplicable: "no IFF for the third month of a quarter; file the quarterly GSTR-1" },
        { id: "monthly-only", when: { qrmp: false, periodKind: "quarterly" }, notApplicable: "monthly filers file GSTR-1 every month, not quarterly" },
      ],
      source: "CGST Act s.37 / rule 59: 11th of next month; QRMP quarterly and IFF 13th. Check CBIC extensions.",
    },
    {
      id: "gstr-3b",
      form: "GSTR-3B",
      title: "Summary return and tax payment",
      service: "GST",
      periodKinds: ["monthly", "quarterly"],
      due: { anchor: "period-end", addMonths: 1, day: 20 },
      variants: [
        { id: "qrmp-22", when: { qrmp: true, periodKind: "quarterly", stateGroup: "qrmp-3b-22" }, due: { anchor: "period-end", addMonths: 1, day: 22 } },
        { id: "qrmp-24", when: { qrmp: true, periodKind: "quarterly", stateGroup: "qrmp-3b-24" }, due: { anchor: "period-end", addMonths: 1, day: 24 } },
        { id: "qrmp-monthly", when: { qrmp: true, periodKind: "monthly" }, notApplicable: "QRMP filers pay monthly through PMT-06 (25th) and file GSTR-3B quarterly" },
        { id: "monthly-only", when: { qrmp: false, periodKind: "quarterly" }, notApplicable: "monthly filers file GSTR-3B every month, not quarterly" },
      ],
      source: "Rule 61: 20th of next month; QRMP 22nd/24th by state group (verify the state list against the current CBIC notification).",
    },
    {
      id: "gstr-9",
      form: "GSTR-9",
      title: "GST annual return",
      service: "GST",
      periodKinds: ["annual"],
      due: { anchor: "period-end", addMonths: 9, day: 31 },
      source: "CGST Act s.44: 31 December after the FY. Check turnover exemption notifications for the year.",
    },
    {
      id: "gstr-9c",
      form: "GSTR-9C",
      title: "GST reconciliation statement",
      service: "GST",
      periodKinds: ["annual"],
      due: { anchor: "period-end", addMonths: 9, day: 31 },
      source: "Rule 80(3): with GSTR-9, 31 December after the FY, where aggregate turnover exceeds the notified limit.",
    },
    // ---------------------------------------------------------------- TDS
    {
      id: "tds-24q",
      form: "24Q",
      title: "TDS return — salaries",
      service: "TDS",
      periodKinds: ["quarterly"],
      due: { anchor: "period-end", addMonths: 1, day: "last" },
      periodOverrides: { Q4: { anchor: "period-end", addMonths: 2, day: 31 } },
      source: "Rule 31A: 31 Jul / 31 Oct / 31 Jan / 31 May. Re-check form numbers and dates under the Income-tax Act, 2025 rules.",
    },
    {
      id: "tds-26q",
      form: "26Q",
      title: "TDS return — non-salary residents",
      service: "TDS",
      periodKinds: ["quarterly"],
      due: { anchor: "period-end", addMonths: 1, day: "last" },
      periodOverrides: { Q4: { anchor: "period-end", addMonths: 2, day: 31 } },
      source: "Rule 31A: 31 Jul / 31 Oct / 31 Jan / 31 May. Re-check form numbers and dates under the Income-tax Act, 2025 rules.",
    },
    // ---------------------------------------------------------------- Income tax
    {
      id: "advance-tax",
      form: "Advance tax",
      title: "Advance tax instalment",
      service: "IncomeTax",
      periodKinds: ["quarterly"],
      due: { anchor: "period-end", addMonths: 0, day: 15 },
      categories: ["regular", "presumptive"],
      variants: [
        { id: "presumptive", when: { category: "presumptive", period: ["Q4"] }, due: { anchor: "period-end", addMonths: 0, day: 15 } },
        { id: "presumptive-none", when: { category: "presumptive" }, notApplicable: "presumptive (44AD/44ADA) assessees pay one instalment by 15 March" },
      ],
      source: "s.211 (1961 Act): 15 Jun / 15 Sep / 15 Dec / 15 Mar; presumptive single instalment 15 Mar. Re-check under the 2025 Act.",
    },
    {
      id: "itr",
      form: "ITR",
      title: "Income-tax return",
      service: "IncomeTax",
      periodKinds: ["annual"],
      due: { anchor: "period-end", addMonths: 4, day: 31 },
      categories: ["non-audit", "audit", "transfer-pricing"],
      variants: [
        { id: "audit", when: { category: "audit" }, due: { anchor: "period-end", addMonths: 7, day: 31 } },
        { id: "transfer-pricing", when: { category: "transfer-pricing" }, due: { anchor: "period-end", addMonths: 8, day: 30 } },
      ],
      source:
        "s.139(1) (1961 Act): 31 Jul non-audit / 31 Oct audit / 30 Nov transfer pricing. PARTNER TO VERIFY for tax year 2026-27 onwards (Income-tax Act, 2025 and Finance Act 2026 may move non-audit business cases).",
    },
    // ---------------------------------------------------------------- ROC
    {
      id: "aoc-4",
      form: "AOC-4",
      title: "Financial statements filing",
      service: "ROC",
      periodKinds: ["annual"],
      due: { anchor: "agm", days: 30, countAgmDay: true },
      source: "Companies Act s.137: within 30 days of the AGM (AGM day counted, as MCA due-date tables show: AGM 30 Sep → 29 Oct).",
    },
    {
      id: "mgt-7",
      form: "MGT-7 / MGT-7A",
      title: "Annual return",
      service: "ROC",
      periodKinds: ["annual"],
      due: { anchor: "agm", days: 60, countAgmDay: true },
      source: "Companies Act s.92(4): within 60 days of the AGM (AGM 30 Sep → 28 Nov). MGT-7A for small companies and OPCs.",
    },
    {
      id: "adt-1",
      form: "ADT-1",
      title: "Auditor appointment intimation",
      service: "ROC",
      periodKinds: ["annual"],
      due: { anchor: "agm", days: 15, countAgmDay: true },
      source: "Companies Act s.139(1) / rule 4(2): within 15 days of the AGM at which the auditor is appointed (AGM 30 Sep → 14 Oct).",
    },
    {
      id: "dir-3-kyc",
      form: "DIR-3 KYC",
      title: "Director KYC",
      service: "ROC",
      periodKinds: ["annual"],
      due: { anchor: "period-end", addMonths: 6, day: 30 },
      source: "Rule 12A: 30 September after the FY. PARTNER TO VERIFY the current KYC frequency (MCA has amended it).",
    },
    {
      id: "msme-1",
      form: "MSME-1",
      title: "Outstanding dues to micro and small enterprises",
      service: "ROC",
      periodKinds: ["half-yearly"],
      due: { anchor: "period-end", addMonths: 1, day: "last" },
      source: "MSME-1 order: Apr–Sep half-year by 31 Oct; Oct–Mar half-year by 30 Apr.",
    },
  ],
};

/** The default pack, validated at load (a typo here fails every import, not a filing). */
export const DEFAULT_CALENDAR: CalendarPack = CalendarPackSchema.parse(raw);

/** Raw JSON form, ready to store in SopPack.calendar. */
export function defaultCalendarJson(): unknown {
  return JSON.parse(JSON.stringify(DEFAULT_CALENDAR));
}
