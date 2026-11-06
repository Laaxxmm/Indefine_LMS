// ROC deliverables: one workbook of data sheets (AOC-4, MGT-7/7A, shareholding, DIR-3 KYC,
// ADT-1 check, due dates + additional fee, checklist, verify notes) and one DOCX of draft board /
// AGM resolutions. Both carry the core header block and the "Draft — not for filing" label; staff
// key the figures into the MCA forms themselves. Values come from the analysis (code), never the model.
import type { ChecklistResultItem } from "@/lib/agents/core/checklist";
import { checklistSheet } from "@/lib/agents/core/checklist-sheet";
import { formatDayKey, formatInr } from "@/lib/agents/core/format";
import type { DeliverableDraft } from "@/lib/agents/core/runner";
import type { RowSpec, SheetSpec } from "@/lib/agents/core/templates";
import { analyseRoc, type RocAnalysis, type RocExtract } from "./analyse";
import { rocVerifyNotes } from "./data";
import { FIN_HEADS, HEAD_LABELS } from "./parse";

export const ROC_WORKBOOK_TITLE = "ROC data sheets";
export const ROC_RESOLUTIONS_TITLE = "Board and AGM resolutions";

const rupees = (paise: number) => paise / 100;
const day = (k: string | null) => (k ? formatDayKey(k) : "");
const yesNo = (b: boolean) => (b ? "Yes" : "No");

function aoc4Sheet(x: RocExtract, a: RocAnalysis): SheetSpec {
  const rows: RowSpec[] = FIN_HEADS.map((h) => ({ item: HEAD_LABELS[h], current: rupees(x.financials.current[h]), previous: rupees(x.financials.previous[h]) }));
  const tot = (label: string, c: number, p: number) => ({ item: label, current: rupees(c), previous: rupees(p) });
  rows.push(
    tot("Total equity and liabilities", a.current.equityAndLiabilities, a.previous.equityAndLiabilities),
    tot("Total assets", a.current.assets, a.previous.assets),
    tot("Profit before tax", a.current.profitBeforeTax, a.previous.profitBeforeTax),
    tot("Profit after tax", a.current.profitAfterTax, a.previous.profitAfterTax),
    tot("Net worth", a.current.netWorth, a.previous.netWorth),
  );
  return {
    name: "AOC-4",
    columns: [
      { key: "item", header: "Item", width: 44 },
      { key: "current", header: `FY ${x.fy}`, type: "inr" },
      { key: "previous", header: "Previous year", type: "inr" },
    ],
    rows,
  };
}

function mgt7Sheet(x: RocExtract, a: RocAnalysis): SheetSpec {
  const co = x.company;
  const rows: [string, string | number][] = [
    ["Company name", co.name],
    ["CIN", co.cin],
    ["Class", co.companyClass === "opc" ? "One Person Company" : co.companyClass === "public" ? "Public company" : "Private company"],
    ["Annual return form", a.annualReturnForm],
    ["Small company (s.2(85))", yesNo(a.small.isSmall)],
    ["Classification basis", a.small.reason],
    ["Authorised capital (₹)", formatInr(rupees(co.authorisedCapitalPaise))],
    ["Paid-up capital (₹)", formatInr(rupees(co.paidUpCapitalPaise))],
    ["Shares issued (total)", a.shareholding.totalShares],
    ["Number of shareholders", x.shareholding.length],
    ["Number of directors", x.directors.length],
    ["AGM date", co.agmDate ? day(co.agmDate) : a.agm.required ? "not held / not given" : "not required (OPC)"],
    ["CSR applicable", yesNo(a.csr.applicable)],
    ["CSR obligation (₹)", formatInr(rupees(a.csr.obligationPaise))],
    ["Statutory auditor", `${x.auditor.name}${x.auditor.frn ? ` (FRN ${x.auditor.frn})` : ""}`],
  ];
  return {
    name: "MGT-7",
    columns: [
      { key: "item", header: "Item", width: 34 },
      { key: "value", header: "Value", width: 60 },
    ],
    rows: rows.map(([item, value]) => ({ item, value: String(value) })),
  };
}

function shareholdingSheet(x: RocExtract): SheetSpec {
  return {
    name: "Shareholding",
    columns: [
      { key: "folio", header: "Folio" },
      { key: "holder", header: "Holder", width: 32 },
      { key: "cls", header: "Class" },
      { key: "shares", header: "Shares", type: "integer" },
      { key: "face", header: "Paid up per share", type: "inr" },
      { key: "amount", header: "Paid-up amount", type: "inr" },
    ],
    rows: x.shareholding.map((h) => ({ folio: h.folio, holder: h.holder, cls: h.shareClass, shares: h.shares, face: rupees(h.paidUpPerSharePaise), amount: rupees(h.shares * h.paidUpPerSharePaise) })),
    totals: true,
  };
}

function kycSheet(a: RocAnalysis): SheetSpec {
  return {
    name: "DIR-3 KYC",
    columns: [
      { key: "din", header: "DIN" },
      { key: "name", header: "Director", width: 28 },
      { key: "designation", header: "Designation" },
      { key: "status", header: "DIN status" },
      { key: "kyc", header: "KYC completed on", type: "date" },
      { key: "result", header: "Action", width: 40 },
    ],
    rows: a.directors.map((d) => ({ din: d.din, name: d.name, designation: d.designation, status: d.dinStatus, kyc: d.kycCompletedOn, result: d.issue ?? "OK" })),
  };
}

function adt1Sheet(x: RocExtract, a: RocAnalysis): SheetSpec {
  const au = a.auditor;
  const rows: [string, string][] = [
    ["Auditor", `${x.auditor.name} (${x.auditor.type})`],
    ["Current term began", `FY ${x.auditor.termStartFy}`],
    ["Year of term for this FY", `${au.termYear} of ${x.auditor.termYears}`],
    ["Term ends at this AGM", yesNo(au.termEndsAtThisAgm)],
    ["Rotation class (s.139(2))", yesNo(au.rotationClass)],
    ["Consecutive years", `${au.consecutiveYears} (limit ${au.rotationClass ? au.rotationLimit : "n/a"})`],
    ["Appointment at this AGM", x.auditor.newAuditorAtThisAgm ? "new auditor" : x.auditor.reappointedAtThisAgm ? "reappointment" : x.auditor.casualVacancy ? "casual vacancy" : "none recorded"],
    ["ADT-1 required", yesNo(au.adt1Required)],
    ["Result", au.beyondTerm ? `Outside term: ${au.reason}` : au.rotationBreached ? "Rotation limit breached" : au.adt1Missing ? `Action: ${au.reason}` : "OK"],
  ];
  return {
    name: "ADT-1 check",
    columns: [
      { key: "check", header: "Check", width: 32 },
      { key: "result", header: "Result", width: 60 },
    ],
    rows: rows.map(([check, result]) => ({ check, result })),
  };
}

function dueSheet(a: RocAnalysis): SheetSpec {
  return {
    name: "Due dates and fees",
    columns: [
      { key: "form", header: "Form" },
      { key: "applicable", header: "Applicable" },
      { key: "basis", header: "Basis", width: 40 },
      { key: "due", header: "Statutory due", type: "date" },
      { key: "filing", header: "Planned filing", type: "date" },
      { key: "late", header: "Days late" },
      { key: "normal", header: "Normal fee", type: "inr" },
      { key: "additional", header: "Additional fee", type: "inr" },
      { key: "note", header: "Note", width: 36 },
    ],
    rows: a.forms.map((f) => ({
      form: f.form,
      applicable: yesNo(f.applicable),
      basis: f.basis,
      due: f.statutoryDue,
      filing: f.expectedFiling,
      late: String(f.delayDays),
      normal: rupees(f.normalFeePaise),
      additional: rupees(f.additionalFeePaise),
      note: f.note,
    })),
    totals: true,
  };
}

function verifySheet(): SheetSpec {
  return {
    name: "Verify",
    columns: [
      { key: "item", header: "Rate / threshold / date", width: 34 },
      { key: "verify", header: "Partner to verify", width: 90 },
    ],
    rows: rocVerifyNotes(),
  };
}

function resolutions(x: RocExtract, a: RocAnalysis): DeliverableDraft {
  const co = x.company;
  const au = a.auditor;
  const agm = co.agmDate ? formatDayKey(co.agmDate) : "[date of AGM]";
  const blocks: Extract<DeliverableDraft, { type: "docx" }>["blocks"] = [
    { type: "paragraph", text: `DRAFT for review by the engagement partner and the company secretary. Fill every [bracket] before use; nothing here has been filed or sent.` },
    { type: "heading", text: `Board resolution — approval of financial statements for FY ${x.fy}` },
    {
      type: "paragraph",
      text: `RESOLVED THAT the audited financial statements of ${co.name} (CIN ${co.cin}) for the financial year ended ${formatDayKey(a.fyEnd)}, comprising the balance sheet, the statement of profit and loss${co.companyClass === "opc" || a.small.isSmall ? "" : ", the cash flow statement"} and the notes, be and are hereby approved, and that [director name] (DIN [DIN]) and [director name] (DIN [DIN]) be authorised to sign them on behalf of the Board.`,
    },
    { type: "paragraph", text: `RESOLVED FURTHER THAT the Board's report for the year be approved and signed by [Chairperson / two directors].` },
  ];
  if (a.agm.required) {
    blocks.push(
      { type: "heading", text: "Board resolution — notice of the annual general meeting" },
      { type: "paragraph", text: `RESOLVED THAT the annual general meeting of the members be held on ${agm} at [time] at [venue / through VC], and that the notice placed before the Board be approved and sent to members, directors and the auditor at least 21 clear days before the meeting.` },
      { type: "heading", text: "AGM — ordinary resolution: adoption of financial statements" },
      { type: "paragraph", text: `RESOLVED THAT the audited financial statements for the financial year ended ${formatDayKey(a.fyEnd)}, together with the reports of the Board and the auditors thereon, be and are hereby received, considered and adopted.` },
    );
  }
  if (au.adt1Required || au.adt1Missing) {
    blocks.push(
      { type: "heading", text: "AGM — ordinary resolution: appointment of statutory auditor (s.139)" },
      {
        type: "paragraph",
        text: `RESOLVED THAT pursuant to section 139 of the Companies Act, 2013, ${x.auditor.newAuditorAtThisAgm ? "[new auditor name], Chartered Accountants (FRN [FRN])" : `${x.auditor.name}${x.auditor.frn ? ` (FRN ${x.auditor.frn})` : ""}`} be ${x.auditor.newAuditorAtThisAgm ? "appointed" : "reappointed"} as statutory auditor for a term of five consecutive years from the conclusion of this AGM until the conclusion of the sixth AGM thereafter, at a remuneration to be fixed by the Board. [Confirm eligibility certificate and consent under s.139(1) and rotation limits under s.139(2).]`,
      },
      { type: "paragraph", text: "Form ADT-1 to be filed by the company within 15 days of the meeting (see the due-date sheet of the workbook)." },
    );
  }
  if (a.csr.applicable) {
    blocks.push(
      { type: "heading", text: "Board resolution — CSR" },
      { type: "paragraph", text: `RESOLVED THAT the CSR policy and the annual action plan be approved, with a CSR obligation of ₹${formatInr(rupees(a.csr.obligationPaise))} (2% of the average net profit of the preceding ${a.csr.yearsAveraged} year(s)), and that a CSR committee be constituted where the obligation exceeds the s.135(9) limit. [Verify the computation of net profit under s.198.]` },
    );
  }
  blocks.push({
    type: "bullets",
    items: [
      `Annual return: ${a.annualReturnForm} (${a.small.reason}).`,
      `AOC-4 due ${day(a.forms.find((f) => f.id === "aoc-4")?.statutoryDue ?? null)}; ${a.annualReturnForm} due ${day(a.forms.find((f) => f.id === "mgt-7")?.statutoryDue ?? null)}.`,
      "Humans file every form on the MCA portal with the director's DSC; Firm OS prepares drafts only.",
    ],
  });
  return { type: "docx", title: ROC_RESOLUTIONS_TITLE, blocks };
}

export function rocDeliverables(x: RocExtract, results: ChecklistResultItem[]): DeliverableDraft[] {
  const a = analyseRoc(x);
  return [
    {
      type: "xlsx",
      title: ROC_WORKBOOK_TITLE,
      sheets: [aoc4Sheet(x, a), mgt7Sheet(x, a), shareholdingSheet(x), kycSheet(a), adt1Sheet(x, a), dueSheet(a), checklistSheet(results), verifySheet()],
    },
    resolutions(x, a),
  ];
}
