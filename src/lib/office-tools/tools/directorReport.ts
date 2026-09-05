import { z } from "zod";
import {
  Document, Packer, Header, Paragraph, Table, BorderStyle,
  PageBorderDisplay, PageBorderOffsetFrom, type ISectionOptions,
} from "docx";
import { gridTable, paraML, boxedText, type Cell } from "../docx";
import { ddmmyyyy, MONTHS } from "../date";
import { numToWords } from "../numToWords";

// Director's Report (+ AOC-2 annexure) — faithful port of tools/director_report.py.
// Times New Roman 11pt, running company header, page border, no footer.

const memberZ = z.object({ name: z.string().default(""), desig: z.string().default(""), meetingsHeld: z.number().default(0), meetingsAttended: z.number().default(0) });
const committeeZ = z.object({ meetings: z.number().default(0), desc: z.string().default(""), members: z.array(memberZ).default([]) });

export const directorReportZ = z.object({
  // General
  companyName: z.string().min(1),
  companyAddress: z.string().default(""),
  companyCin: z.string().default(""),
  companyEmail: z.string().default(""),
  reportNumber: z.string().default("1st First"),
  financialYear: z.string().default("2024-2025"),
  previousFinancialYear: z.string().default("2023-2024"),
  fyEndDate: z.string().min(1), // ISO
  currentDate: z.string().min(1), // ISO
  place: z.string().default(""),

  // Financial
  includePrevYear: z.boolean().default(false),
  totalRevenue: z.number().default(0),
  profitBeforeDepTax: z.number().default(0),
  depreciation: z.number().default(0),
  profitBeforeTax: z.number().default(0),
  currentTax: z.number().default(0),
  deferredTax: z.number().default(0),
  profitForYear: z.number().default(0),
  prevTotalRevenue: z.number().default(0),
  prevProfitBeforeDepTax: z.number().default(0),
  prevDepreciation: z.number().default(0),
  prevProfitBeforeTax: z.number().default(0),
  prevCurrentTax: z.number().default(0),
  prevDeferredTax: z.number().default(0),
  prevProfitForYear: z.number().default(0),
  prevProfit: z.number().default(0), // previous year profit/loss for industry scenario

  // Directors & meetings
  directors: z.array(z.object({
    dinPan: z.string().default(""), name: z.string().default(""), beginDate: z.string().default(""), endDate: z.string().default("-"),
    category: z.string().default(""), meetingsHeld: z.number().default(0), meetingsAttended: z.number().default(0), agmAttendance: z.enum(["Present", "Absent"]).default("Present"),
  })).min(1),
  numBoardMeetings: z.number().default(0),
  boardMeetingDates: z.string().default(""),

  // Key business changes
  industryChange: z.enum(["Loss", "Profit"]).default("Loss"),
  changeNature: z.boolean().default(false),
  newBusinessDesc: z.string().default(""),
  changeImpact: z.string().default(""),
  changeRegOffice: z.boolean().default(false),
  oldAddress: z.string().default(""),
  newAddress: z.string().default(""),
  approvalDetails: z.string().default(""),
  regBenefits: z.string().default(""),
  dividend: z.boolean().default(false),
  interimAmount: z.number().default(0),
  interimDeclDate: z.string().default(""),
  interimPayDate: z.string().default(""),
  interimRationale: z.string().default(""),
  finalAmount: z.number().default(0),
  finalPayDate: z.string().default(""),
  changeCapital: z.boolean().default(false),
  authCapital: z.number().default(100000),
  authShares: z.number().default(10000),
  paidCapital: z.number().default(100000),
  paidShares: z.number().default(10000),
  oldAuth: z.string().default(""),
  newAuth: z.string().default(""),
  reasonAuth: z.string().default(""),
  oldPaid: z.string().default(""),
  newPaid: z.string().default(""),
  reasonPaid: z.string().default(""),
  approvalCap: z.string().default(""),
  hasHoldingSub: z.boolean().default(false),
  holdings: z.array(z.object({ shareholderName: z.string().default(""), address: z.string().default(""), numShares: z.number().default(0), percentHolding: z.number().default(0) })).default([]),
  transferReserves: z.boolean().default(false),
  reserveAmount: z.number().default(0),
  reserveReason: z.string().default(""),
  reservePurpose: z.string().default(""),

  // Compliance & policies
  hasCommittees: z.boolean().default(false),
  audit: committeeZ.default({}),
  nomination: committeeZ.default({}),
  stakeholders: committeeZ.default({}),
  additionalCommittees: z.string().default(""),
  hasMemberMeetings: z.boolean().default(false),
  memberMeetings: z.array(z.object({ meetingType: z.string().default("AGM"), meetingNumber: z.string().default(""), meetingDate: z.string().default(""), membersPresent: z.number().default(0) })).default([]),
  hasLoans: z.boolean().default(false),
  loans: z.array(z.object({ transType: z.string().default("Loan"), particulars: z.string().default(""), amount: z.number().default(0), purpose: z.string().default(""), approvalDate: z.string().default("") })).default([]),
  hasMaterialChanges: z.boolean().default(false),
  material: z.array(z.object({ changeCommit: z.string().default(""), impact: z.string().default(""), dateOcc: z.string().default("") })).default([]),
  hasSigOrders: z.boolean().default(false),
  orders: z.array(z.object({ byWhom: z.string().default(""), orderDate: z.string().default(""), details: z.string().default(""), impact: z.string().default("") })).default([]),
  hasRelatedParties: z.boolean().default(false),
  related: z.array(z.object({ name: z.string().default(""), relationship: z.string().default(""), nature: z.string().default(""), duration: z.string().default("NA"), terms: z.string().default("NA"), approvalDate: z.string().default("NA"), advance: z.number().default(0) })).default([]),
  hasHighRem: z.boolean().default(false),
  rem: z.array(z.object({ name: z.string().default(""), desig: z.string().default(""), rem: z.number().default(0) })).default([]),
  hasSubChanges: z.boolean().default(false),
  subs: z.array(z.object({ name: z.string().default(""), typeSub: z.string().default("Subsidiary"), changeNature: z.string().default("Became"), changeDate: z.string().default("") })).default([]),
  hasDeposits: z.boolean().default(false),
  deposits: z.array(z.object({ depType: z.string().default(""), amountAcc: z.number().default(0), outstanding: z.number().default(0), defaultDetails: z.string().default("") })).default([]),
  hasAudQual: z.boolean().default(false),
  audQuals: z.array(z.object({ desc: z.string().default(""), response: z.string().default(""), impact: z.string().default("") })).default([]),
  hasFrauds: z.boolean().default(false),
  frauds: z.array(z.object({ nature: z.string().default(""), amount: z.number().default(0), action: z.string().default(""), impact: z.string().default("") })).default([]),
  hasCostAud: z.boolean().default(false),
  costAud: z.object({ name: z.string().default(""), firm: z.string().default(""), regNo: z.string().default(""), period: z.string().default(""), rem: z.number().default(0) }).default({}),
  hasCostRecords: z.boolean().default(false),
  costRec: z.object({ forProduct: z.string().default(""), compliance: z.string().default("Compliant"), typeRec: z.string().default("") }).default({}),
  hasIntAud: z.boolean().default(false),
  intAud: z.object({ name: z.string().default(""), firm: z.string().default(""), regNo: z.string().default(""), period: z.string().default(""), rem: z.number().default(0) }).default({}),
  hasPosh: z.boolean().default(false),
  posh: z.object({ complaintsRec: z.number().default(0), disposed: z.number().default(0), pending: z.number().default(0) }).default({}),
  hasPoshPolicy: z.boolean().default(false),
  poshComplaints: z.array(z.object({ received: z.number().default(0), disposedOff: z.number().default(0), pending: z.number().default(0) })).default([]),
  hasMaternity: z.boolean().default(false),
  maternityReason: z.enum(["Fewer than 10 employees", "No female employees"]).default("Fewer than 10 employees"),
  hasInsolvency: z.boolean().default(false),
  insol: z.array(z.object({ nature: z.string().default(""), date: z.string().default(""), status: z.string().default("Pending"), court: z.string().default(""), amount: z.number().default(0) })).default([]),
  hasOts: z.boolean().default(false),
  ots: z.array(z.object({ bank: z.string().default(""), loanAmt: z.number().default(0), valLoan: z.number().default(0), valOts: z.number().default(0), reasonDiff: z.string().default("") })).default([]),
  hasVigil: z.boolean().default(false),
  vigil: z.array(z.object({ nature: z.string().default(""), rec: z.number().default(0), res: z.number().default(0), pend: z.number().default(0) })).default([]),
  hasCsr: z.boolean().default(false),
  hasRiskPolicy: z.boolean().default(false),
  riskMeetings: z.number().default(0),
  riskKeyAreas: z.string().default(""),
  hasIsin: z.boolean().default(false),
  foreignEarnings: z.number().default(0),
  foreignOutgo: z.number().default(0),
  conservationDetails: z.string().default(""),
  technologyEfforts: z.string().default("N.A."),
  technologyBenefits: z.string().default("N.A."),
  technologyExpenditure: z.string().default("N.A."),
  technologyImported: z.string().default("N.A."),
  technologyYear: z.string().default("N.A."),
  technologyAbsorbed: z.string().default("N.A."),
  technologyNotAbsorbed: z.string().default("N.A."),
});
export type DirectorReportInput = z.infer<typeof directorReportZ>;

const POSH_CATEGORIES = ["Sexual Harassment", "Workplace Discrimination", "Child Labour", "Forced Labour", "Wages and Salary", "Other HR Issues"];
const grp = (n: number) => n.toLocaleString("en-US");
const amt2 = (n: number) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numStr = (n: number | string) => (typeof n === "number" ? String(n) : n);

export async function renderDirectorReportDocx(d: DirectorReportInput): Promise<Buffer> {
  const c: (Paragraph | Table)[] = [];
  const fy = d.financialYear;
  const heading = (t: string) => c.push(paraML(t, { bold: true, spaceBeforePt: 12, spaceAfterPt: 6 }));
  const body = (t: string) => c.push(paraML(t));
  const boxed = (t: string) => c.push(...boxedText(t));
  const table = (headers: string[], rows: (string | number)[][], opts?: { fontSize?: number; boldHeaders?: boolean }) =>
    c.push(gridTable([
      headers.map((h) => ({ text: h, bold: opts?.boldHeaders !== false })),
      ...rows.map((r) => r.map((cell) => ({ text: numStr(cell) } as Cell))),
    ], { align: "left", fontSize: opts?.fontSize }));

  const [ey, em, ed] = d.fyEndDate.split("-").map(Number);
  const fyEndLong = `${ed}st ${MONTHS[(em || 1) - 1]}, ${ey}`; // matches source "{day}st {Month}, {year}"
  const fyEndDot = `${String(ed).padStart(2, "0")}.${String(em).padStart(2, "0")}.${ey}`;

  const industryProfitStr = d.industryChange === "Profit"
    ? `Profit of Rs. ${amt2(d.profitForYear)}/- (Rupees ${numToWords(Math.abs(d.profitForYear))} Only)`
    : `Loss of Rs. ${amt2(d.profitForYear)} /- (Rupees ${numToWords(Math.abs(d.profitForYear))} Only)`;
  const prevLossStr = `Loss of Rs. ${amt2(d.prevProfit)}/- (Rupees ${numToWords(Math.abs(d.prevProfit))} Only)`;

  // Title & intro
  c.push(paraML("DIRECTOR’S REPORT", { bold: true, align: "center", sizePt: 14, spaceBeforePt: 12 }));
  body("To,");
  body("The Members,");
  body(`Your directors are pleased in presenting their ${d.reportNumber} Directors Report on the business and operations of your Company together with the Audited Financial Statements and the Auditors’ Report of your Company for the financial year ended, ${fyEndLong}.`);
  body(`The summarized financial results for the year ended ${fyEndLong} are as under:-`);
  c.push(paraML("FINANCIAL SUMMARY (STANDALONE)", { bold: true, align: "center", spaceBeforePt: 12 }));
  c.push(paraML("(Amount in Rs.)", { align: "center" }));

  if (d.includePrevYear) {
    table(["Particulars", d.previousFinancialYear, fy], [
      ["Total Revenue", d.prevTotalRevenue, d.totalRevenue],
      ["Profit / Loss before depreciation and Tax", d.prevProfitBeforeDepTax, d.profitBeforeDepTax],
      ["Less:- Depreciation", d.prevDepreciation, d.depreciation],
      ["Profit/Loss before Tax", d.prevProfitBeforeTax, d.profitBeforeTax],
      ["Less-Current year tax", d.prevCurrentTax, d.currentTax],
      ["Deferred Tax", d.prevDeferredTax, d.deferredTax],
      ["Profit/ Loss for the year", d.prevProfitForYear, d.profitForYear],
    ]);
  } else {
    table(["Particulars", fy], [
      ["Total Revenue", d.totalRevenue],
      ["Profit / Loss before depreciation and Tax", d.profitBeforeDepTax],
      ["Less:- Depreciation", d.depreciation],
      ["Profit/Loss before Tax", d.profitBeforeTax],
      ["Less-Current year tax", d.currentTax],
      ["Deferred Tax", d.deferredTax],
      ["Profit/ Loss for the year", d.profitForYear],
    ]);
  }

  heading("INDUSTRY SCENARIO AND STATE OF COMPANY’S AFFAIRS");
  boxed(`The Performance of your Company during F.Y ${fy} is given above. \nThe Company has closed its books of accounts with a ${industryProfitStr} for the financial year ended ${fyEndDot} as compared to the ${prevLossStr} for the financial year ended 31.03.2024.`);

  heading("CHANGE IN THE NATURE OF BUSINESS");
  boxed(!d.changeNature
    ? "There is no change in the nature of the business of the Company during the year."
    : `During the financial year, there was a change in the nature of the Company. The Company expanded/altered its business activities by ${d.newBusinessDesc}. This change in the scope of business activities was approved/initiated in accordance with relevant regulatory approvals, shareholders' resolutions, or legal provisions, allowing the Company to ${d.changeImpact}.`);

  heading("CHANGE IN THE REGISTERED OFFICE OF THE COMPANY");
  boxed(!d.changeRegOffice
    ? `There was no change in the registered office of the company during the financial year ${fy}.`
    : `During the financial year ${fy}, the registered office of the Company was moved/relocated from ${d.oldAddress} to ${d.newAddress}. This change was made in accordance with ${d.approvalDetails}, and was approved by shareholders, board of directors, or relevant authority.\nThe new registered office is located in city, state, or region, which is expected to ${d.regBenefits}.`);

  heading("DIVIDEND");
  boxed(!d.dividend
    ? "As the Company has not made adequate profits during the year, the Directors of your Company do not recommend any dividend for the financial year ended March 31, 2025."
    : `During the financial year ended March 31, 2025, the Directors of the Company have recommended both an Interim and a Final dividend.\n\n1. Interim Dividend:\nAn interim dividend of ${d.interimAmount} was declared on ${ddmmyyyy(d.interimDeclDate)} and paid on ${ddmmyyyy(d.interimPayDate)}. The interim dividend was declared based on the ${d.interimRationale}.\n\n2. Final Dividend:\nThe Board of Directors has also recommended a final dividend of ${d.finalAmount} for the year ended March 31, 2025. The final dividend, subject to approval by the shareholders at the Annual General Meeting (AGM), will be payable on ${ddmmyyyy(d.finalPayDate)}.\n\nThe total dividend for the year, including both interim and final, amounts to ${d.interimAmount + d.finalAmount}.`);

  heading("CAPITAL STRUCTURE");
  const authWords = numToWords(d.authCapital), authSharesWords = numToWords(d.authShares), paidWords = numToWords(d.paidCapital), paidSharesWords = numToWords(d.paidShares);
  boxed(!d.changeCapital
    ? `During the year under consideration, the Company has not changed its capital structure and the authorized and paid-up share capital as on 31st March 2025 stands as follow:\nThe Authorized Share Capital of the Company is Rs. ${grp(d.authCapital)}/- (${authWords} Only) divided into ${grp(d.authShares)} (${authSharesWords}) Equity Shares of Rs. 10/- each.\nDuring the F.Y. ${fy}, the Paid-up Share capital of the Company stands as Rs. ${grp(d.paidCapital)} (${paidWords} Only) divided into ${grp(d.paidShares)} (${paidSharesWords}) Equity Shares of Rs. 10/- each.`
    : `During the financial year ${fy}, the Company has made changes to its capital structure. The details of the Authorized and Paid-up share capital as on March 31, 2025, are as follows:\n\n1. Authorized Share Capital:\nThe Authorized Share Capital of the Company as on 31st March 2025 stands at Rs. ${grp(d.authCapital)} (${authWords}) divided into ${grp(d.authShares)} (${authSharesWords}) Equity Shares of Rs. 10/- each.\n\n2. Paid-up Share Capital:\nThe Paid-up Share Capital of the Company as on 31st March 2025 stands at Rs. ${grp(d.paidCapital)} (${paidWords}) divided into ${grp(d.paidShares)} (${paidSharesWords}) Equity Shares of Rs. 10/- each.\n\nDetails of the Change:\n· The Authorized Share Capital was increased/decreased from Rs. ${d.oldAuth} to Rs. ${d.newAuth} due to ${d.reasonAuth}.\n· The Paid-up Share Capital was adjusted from Rs. ${d.oldPaid} to Rs. ${d.newPaid} as a result of ${d.reasonPaid}.\nThe changes in the capital structure were approved by ${d.approvalCap}.`);

  heading("HOLDING/SUBSIDIARY/ASSOCIATE COMPANIES");
  boxed(!d.hasHoldingSub ? `The Company does not have any Holding, Subsidiary, or Associate companies during the financial year ${fy}.` : "The details of holding company of the Company are given below:");
  if (d.hasHoldingSub) table(["S.N.", "Shareholder’s Name", "Address", "Number of Shares of Rs. 10 each", "% of holding"], d.holdings.map((h, i) => [i + 1, h.shareholderName, h.address, h.numShares, h.percentHolding]));

  heading("AMOUNT TRANSFERED TO RESERVES");
  boxed(!d.transferReserves
    ? "Your directors do not propose to carry any reserve during the financial year ended March 31, 2025."
    : `During the financial year ended March 31, 2025, the Directors of the Company have proposed to transfer an amount of Rs. ${grp(d.reserveAmount)} (${numToWords(d.reserveAmount)}) to the reserves. The transfer to reserves was made in accordance with ${d.reserveReason}.\nThe transfer to reserves will strengthen the financial position of the Company and be used for ${d.reservePurpose}, in alignment with the long-term objectives of the Company.`);

  heading("DIRECTORS");
  body("Your Company’s Board comprises of the following directors: -");
  table(["DIN/PAN", "Name", "Begin date", "End date"], d.directors.map((dir) => [dir.dinPan, dir.name, dir.beginDate ? ddmmyyyy(dir.beginDate) : "", dir.endDate]));

  heading("MEETINGS OF THE BOARD OF DIRECTORS");
  body(`The Board of Directors of the Company met ${d.numBoardMeetings} times during the year under review on ${d.boardMeetingDates}, in respect of which proper notices were given and the proceedings were properly recorded, signed and maintained in the minute’s book kept by the Company for the purpose. The intervening period between the Board Meetings were well within the maximum time between the two meetings prescribed under section 173 of the Companies Act, 2013.`);
  body("The annual calendar of meetings is broadly determined at the beginning of each year. The details of the meetings held during the year are as under:");
  table(["S. No.", "Name of the Directors", "Category", "No. of meetings held", "No. of meetings attended", "Last AGM attendance"], d.directors.map((dir, i) => [i + 1, dir.name, dir.category, dir.meetingsHeld, dir.meetingsAttended, dir.agmAttendance]));

  heading("COMMITTEES OF THE BOARD OF DIRECTORS OF THE COMPANY");
  if (!d.hasCommittees) {
    boxed("There is no committee constituted in the company as the same is not applicable.");
  } else {
    body(`The Company has constituted the following committees of the Board of Directors during the financial year ${fy}, in accordance with the applicable regulations:`);
    const memberHeaders = ["Name of Member", "Designation", "Meetings Held", "Meetings Attended"];
    body("1. Audit Committee");
    body("The Audit Committee oversees the financial reporting process, internal control systems, and the appointment/review of the external auditors. Below is the composition of the Audit Committee:");
    table(memberHeaders, d.audit.members.map((m) => [m.name, m.desig, m.meetingsHeld, m.meetingsAttended]));
    body(`Meetings Held:\nThe Audit Committee met ${d.audit.meetings} during the financial year ${fy}. The key discussions included ${d.audit.desc}.`);
    body("2. Nomination and Remuneration Committee");
    body("The Nomination and Remuneration Committee is responsible for recommending appointments and remuneration policies. The committee composition is as follows:");
    table(memberHeaders, d.nomination.members.map((m) => [m.name, m.desig, m.meetingsHeld, m.meetingsAttended]));
    body(`Meetings Held:\nThe Nomination and Remuneration Committee met ${d.nomination.meetings} during the financial year ${fy}, focusing on ${d.nomination.desc}.`);
    body("3. Stakeholders' Relationship Committee");
    body("The Stakeholders' Relationship Committee ensures effective redressal of shareholder grievances and compliance with regulatory requirements. The committee details are as follows:");
    table(memberHeaders, d.stakeholders.members.map((m) => [m.name, m.desig, m.meetingsHeld, m.meetingsAttended]));
    body(`Meetings Held:\nThe Stakeholders' Relationship Committee met ${d.stakeholders.meetings} during the year, discussing matters such as ${d.stakeholders.desc}.`);
    body("Additional Committees:");
    body(d.additionalCommittees);
  }

  heading("MEETINGS OF THE MEMBERS:");
  if (!d.hasMemberMeetings) {
    boxed(`During the financial year ${fy}, there were no meetings of the members of the Company.`);
  } else {
    boxed("The details of meetings of members held during the year are as follows:");
    table(["Meeting Type", "Meeting Number", "Date", "Members Present"], d.memberMeetings.map((m) => [m.meetingType, m.meetingNumber, m.meetingDate ? ddmmyyyy(m.meetingDate) : "", m.membersPresent]));
  }

  heading("PARTICULARS OF LOANS, GUARANTEES OR INVESTMENTS MADE UNDER SECTION 186 OF THE COMPANIES ACT, 2013");
  boxed(!d.hasLoans ? "During the year under review, there are no particulars of loans, guarantees or investments made under section 186 of the Companies Act, 2013." : `During the financial year ${fy}, the Company has made the following loans, guarantees, or investments under Section 186 of the Companies Act, 2013:`);
  if (d.hasLoans) {
    table(["Type of Transaction", "Particulars", "Amount (Rs.)", "Purpose", "Date of Approval"], d.loans.map((l) => [l.transType, l.particulars, l.amount, l.purpose, l.approvalDate ? ddmmyyyy(l.approvalDate) : ""]));
    body("The loans, guarantees, and investments were made in accordance with the provisions of Section 186 of the Companies Act, 2013, and were duly approved by the Board of Directors and/or shareholders as required.");
  }

  heading("MATERIAL CHANGES AND COMMITMENTS AFFECTING THE FINANCIAL POSITION OF THE COMPANY WHICH HAVE OCCURRED BETWEEN THE END OF THE FINANCIAL YEAR OF THE COMPANY TO WHICH THE FINANCIAL STATEMENTS RELATE AND THE DATE OF THE REPORT");
  boxed(!d.hasMaterialChanges ? "There have been no material changes and commitments affecting the financial position of the Company between the end of the financial year and the date of this report." : `There have been material changes and commitments affecting the financial position of the Company between the end of the financial year ${fy} and the date of this report. The details are as follows:`);
  if (d.hasMaterialChanges) {
    table(["Change/Commitment", "Impact on Financial Position", "Date of Occurrence"], d.material.map((m) => [m.changeCommit, m.impact, m.dateOcc ? ddmmyyyy(m.dateOcc) : ""]));
    body("These changes and commitments have been disclosed in accordance with the relevant provisions of the Companies Act, 2013.");
  }

  heading("DETAILS OF SIGNIFICANT AND MATERIAL ORDERS PASSED BY THE REGULATORS OR COURTS OR TRIBUNALS IMPACTING THE GOING CONCERN STATUS AND COMPANY’S OPERATION IN FUTURE");
  boxed(!d.hasSigOrders ? "No significant and material orders were passed by the regulators or courts or tribunals which affect the going concern status and future operation of the Company." : `During the financial year ${fy}, the following significant and material orders were passed by regulators, courts, or tribunals that may impact the going concern status or future operations of the Company:`);
  if (d.hasSigOrders) {
    table(["Order Passed By", "Date of Order", "Details of Order", "Impact on the Company’s Future Operations"], d.orders.map((o) => [o.byWhom, o.orderDate ? ddmmyyyy(o.orderDate) : "", o.details, o.impact]));
    body("The Company is taking necessary actions/appealing against the order, and will continue to monitor the situation.");
  }

  heading("PARTICULARS OF CONTRACTS OR ARRANGMENTS MADE WITH THE RELATED PARTIES");
  const relatedData = d.hasRelatedParties
    ? d.related.map((r, i) => [i + 1, r.name, r.relationship, r.nature, r.duration, r.terms, r.approvalDate, r.advance])
    : [[1, "", "", "", "NA", "NA", "NA", 0], [2, "", "", "", "", "", "", 0]];
  const rpHeaders = ["Sl. No.", "Name(s) of the related party", "nature of relationship", "Nature of contracts/arrangements/ transactions", "Duration of the contracts/ arrangements/transactions", "terms of the contracts/arrangements/ transactions including the value, if any", "Date(s) of approval by the Board, if any", "Amount paid as advances, if any"];
  boxed(!d.hasRelatedParties ? "During the financial year under review, the provision of section 188 is not applicable to the Company. The Company has entered into contracts/arrangements with its related parties, details of such contracts are given below." : "During the financial year under review, the Company entered into contracts/arrangements with its related parties. The details of such contracts and arrangements are as follows:");
  table(rpHeaders, relatedData, { fontSize: 9, boldHeaders: false });
  body("The details of related party transactions as required under provisions of Section 134(3) of the Companies Act, 2013 are provided in Form AOC-2, which is annexed to this Directors’ Report as ‘Annexure I’.\nThe details of transactions with related parties during the financial year 2024-2025 are also provided in the notes to the financial statements.");

  heading("DISCLOSURE OF REMUNERATION OF EMPLOYEES COVERED UNDER RULE 5(2) OF THE COMPANIES (APPOINTMENT AND REMUNERATION OF MANAGERIAL PERSONNEL) RULES, 2014");
  if (!d.hasHighRem) {
    boxed("None of the employee of your Company, who was employed throughout the financial year, was in receipt of remuneration in aggregate of Rupees One Crore and Two Lakhs or more or if employed for the part of the financial year was in receipt of remuneration of Rupees Eight Lakh & Fifty Thousand or more per month.");
  } else {
    boxed("The following employees of the Company were in receipt of remuneration in aggregate of Rupees One Crore and Two Lakhs or more during the financial year, or if employed for part of the financial year, received remuneration of Rupees Eight Lakh and Fifty Thousand or more per month:");
    table(["Sl. No.", "Name of Employee", "Designation", "Remuneration (Rs.)"], d.rem.map((e, i) => [i + 1, e.name, e.desig, e.rem]));
  }

  heading("NAMES OF THE COMPANIES WHICH HAVE BECOME OR CEASED TO BE SUBSIDIARIES, JOINT VENTURES OR ASSOCIATE COMPANIES");
  if (!d.hasSubChanges) {
    boxed("During the year under review, there is no Subsidiary, Joint Venture or Associate Company.");
  } else {
    boxed(`During the financial year ${fy}, the following companies have either become or ceased to be subsidiaries, joint ventures, or associate companies of the Company:`);
    table(["Sl. No.", "Company Name", "Type (Subsidiary/Joint Venture/Associate)", "Nature of Change", "Date of Change"], d.subs.map((s, i) => [i + 1, s.name, s.typeSub, s.changeNature, s.changeDate ? ddmmyyyy(s.changeDate) : ""]));
  }

  heading("DEPOSITS");
  if (!d.hasDeposits) {
    boxed("The Company has not accepted any deposits under the applicable provisions of the Companies Act, 2013 and the rules framed there under.");
  } else {
    boxed(`During the financial year ${fy}, the Company has accepted deposits under the provisions of the Companies Act, 2013. The details of such deposits are as follows:`);
    table(["Sl. No.", "Type of Deposit", "Amount Accepted (Rs.)", "Total Deposits Outstanding as of 31st March 2025 (Rs.)", "Details of any Default"], d.deposits.map((dp, i) => [i + 1, dp.depType, dp.amountAcc, dp.outstanding, dp.defaultDetails]));
    body("The Company confirms that all deposits accepted were in compliance with the provisions of the Companies Act, 2013 and the rules made thereunder.");
  }

  heading("AUDITORS");
  boxed("The Company in its 2ND Annual General Meeting (AGM) held on 30/09/2024 appointed M/s. XXXXXXXXXX & Associates, Chartered Accountants, (FRN No.-000000X) as Statutory Auditors of the Company pursuant to Section 139 of the Companies Act, 2013 and the rules framed there under, for a term of 5 consecutive years commencing from the conclusion of the 2ND Annual General Meeting held on 30/09/2024 until the conclusion of 7th Annual General Meeting of the Company to be held in 2029 for the Financial year 2028-2029.");

  heading("AUDITORS’ REPORT");
  if (!d.hasAudQual) {
    boxed("There is no qualification, reservation or adverse remarks or disclaimer made by the auditors in their report.");
  } else {
    boxed(`The auditors have made the following qualifications, reservations, adverse remarks, or disclaimers in their report for the financial year ${fy}:`);
    table(["Sl. No.", "Qualification/Reservation/Adverse Remark/Disclaimer", "Management’s Response", "Impact on Financial Statements (if any)"], d.audQuals.map((q, i) => [i + 1, q.desc, q.response, q.impact]));
    body("The Company has taken steps to address the issues raised in the auditors’ report and will ensure compliance with the necessary regulations.");
  }

  heading("FRAUD’S REPORTED BY AUDITORS OTHER THAN THOSE WHICH ARE REPORTABLE TO THE CENTRAL GOVERNMENT U/S 143(12)");
  if (!d.hasFrauds) {
    boxed(`There were no frauds reported by the auditors under section 143(12) of Companies Act, 2013 during their course of audit for the financial year ${fy}.`);
  } else {
    boxed(`The auditors have reported the following frauds, which are not reportable to the Central Government under Section 143(12) of the Companies Act, 2013, during the course of their audit for the financial year ${fy}:`);
    table(["Sl. No.", "Nature of Fraud", "Amount Involved (Rs.)", "Action Taken", "Impact on Financial Statements"], d.frauds.map((f, i) => [i + 1, f.nature, f.amount, f.action, f.impact]));
    body("The Company is taking all necessary steps to address these issues and has implemented corrective measures to prevent the recurrence of such incidents in the future.");
  }

  heading("COST AUDITOR");
  if (!d.hasCostAud) {
    boxed("The Company does not fall within the purview of section 148 of the Companies Act, 2013 and hence, it is not required to appoint a cost auditor for the financial year 2024-2025.");
  } else {
    boxed(`The Company has appointed a Cost Auditor for the financial year ${fy} as per the provisions of Section 148 of the Companies Act, 2013. The details of the cost auditor are as follows:`);
    table(["Sl. No.", "Name of the Cost Auditor", "Firm Name", "Registration No.", "Period of Appointment", "Remuneration"], [[1, d.costAud.name, d.costAud.firm, d.costAud.regNo, d.costAud.period, d.costAud.rem]]);
    body("The Board of Directors has approved the appointment of the Cost Auditor, and the remuneration for the cost audit has been fixed accordingly.");
  }

  heading("DISCLOSURES AS MAINTENANCE OF COST RECORDS UNDER SUB-SECTION (1) OF SECTION 148 OF THE COMPANIES ACT, 2013");
  if (!d.hasCostRecords) {
    boxed("The Company does not fall under the preview of section 148 of the Companies Act, 2013, and hence it is not required to maintain any cost records and accordingly such accounts and records are not made and maintained by the company.");
  } else {
    boxed("The Company falls under the purview of Section 148 of the Companies Act, 2013, and has duly maintained the cost records as required under this section for the financial year 2024-2025. The cost records have been updated and are being maintained in accordance with the applicable rules and regulations.");
    table(["Particulars", "Details"], [["Cost Records Maintained For", d.costRec.forProduct], ["Compliance", d.costRec.compliance], ["Type of Records Maintained", d.costRec.typeRec]]);
    body("The cost records are being reviewed regularly to ensure compliance with the statutory requirements.");
  }

  heading("INTERNAL AUDITOR");
  if (!d.hasIntAud) {
    boxed("The Company is not required to appoint Internal Auditor as it does not fall within purview of section 138(1) of Companies Act, 2013 and Rule 13 of Companies (Accounts) Rules, 2014 and it is not applicable to your Company.");
  } else {
    boxed(`The Company has appointed an Internal Auditor for the financial year ${fy} as per the provisions of Section 138(1) of the Companies Act, 2013 and Rule 13 of the Companies (Accounts) Rules, 2014. The details of the internal auditor are as follows:`);
    table(["Sl. No.", "Name of Internal Auditor", "Firm Name", "Registration No.", "Period of Appointment", "Remuneration"], [[1, d.intAud.name, d.intAud.firm, d.intAud.regNo, d.intAud.period, d.intAud.rem]]);
    body("The Internal Auditor is responsible for reviewing and improving the internal control systems and the financial reporting process of the Company.");
  }

  heading("DISCLOSURES UNDER SEXUAL HARASSMENT OF WOMEN AT WORKPLACE (PREVENTION, PROHIBITION & REDRESSAL) ACT, 2013");
  if (!d.hasPosh) {
    boxed("There are no employees in the Company thus it is not required to constitute Internal Complaints Committee (ICC) pursuant to the legislation 'Prevention, Prohibition and Redressal of Sexual Harassment of Women at Workplace Act 2013' as the same is not applicable on the Company.");
  } else {
    boxed("The Company has constituted an Internal Complaints Committee (ICC) in accordance with the provisions of the Sexual Harassment of Women at Workplace (Prevention, Prohibition & Redressal) Act, 2013. The details are as follows:");
    table(["Sl. No.", "Number of Complaints Received", "Number of Complaints Disposed of", "Number of Complaints Pending"], [[1, d.posh.complaintsRec, d.posh.disposed, d.posh.pending]]);
    body("The Company ensures a safe and conducive work environment for all employees and takes immediate action for resolving any complaints in accordance with the relevant laws.");
  }

  heading("PREVENTION OF SEXUAL HARASSMENT (NOT APPLICABLE ON SMALL COMPANIES AND OPCS)");
  boxed(!d.hasPoshPolicy
    ? "As the Company employs fewer than 10 employees, the provisions of the Sexual Harassment of Women at Workplace (Prevention, Prohibition & Redressal) Act, 2013 are not applicable. Hence, the Company is not required to constitute an Internal Complaints Committee (ICC) or establish a formal policy for the prevention of sexual harassment at the workplace.\nHowever, the Company is committed to maintaining a safe and respectful work environment and takes any complaints of misconduct seriously, following internal policies and applicable laws."
    : "The Company’s goal has always been to create an open and safe workplace for every employee to feel empowered, irrespective of gender, sexual preferences and other factors, and contribute to the best of their abilities. In line to make the workplace a safe environment, the Company has set up a policy on prevention of sexual harassment in line with the requirements of the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013 (“PoSH Act”). Further, the Company has complied with the provisions under the PoSH Act relating to the framing of an anti-sexual harassment policy and the constitution of an Internal Committee. \nThe Company has not received any complaints of work place complaints, including complaints on sexual harassment during the year under review. OR The following is a summary of complaints received and resolved during the reporting period:");
  if (d.hasPoshPolicy) {
    const poshRows = POSH_CATEGORIES.map((cat, i) => {
      const row = d.poshComplaints[i] ?? { received: 0, disposedOff: 0, pending: 0 };
      return [i + 1, cat, row.received, row.disposedOff, row.pending];
    });
    table(["Sl. No.", "Nature of Complaints", "Received", "Disposed-Off", "Pending"], poshRows);
  }

  heading("MATERNITY BENEFIT PROVIDED BY THE COMPANY UNDER MATERNITY BENEFIT ACT 1961 (not applicable on small companies and OPCs - check for female KMP, MD, WTD If female employees exist)");
  const matCompliant = "The Company declares that it has duly complied with the provisions of the Maternity Benefit Act, 1961. All eligible women employees have been extended the statutory benefits prescribed under the Act, including paid maternity leave, continuity of salary and service during the leave period, and post-maternity support such as nursing breaks and flexible return-to-work options, as applicable. The Company remains committed to fostering an inclusive and supportive work environment that upholds the rights and welfare of its women employees in accordance with applicable laws.";
  boxed(!d.hasMaternity
    ? (d.maternityReason === "Fewer than 10 employees"
      ? "The Company confirms that it is fully aware of and remains committed to complying with the provisions of the Maternity Benefit Act, 1961. While there are currently no women employees on its rolls, the Company has appropriate systems and policies in place to ensure that all statutory benefits under the Act, including paid maternity leave, continuity of salary and service during the leave period, nursing breaks, and flexible return-to-work arrangements will be extended to eligible women employees as and when applicable. The Company remains committed to fostering an inclusive and legally compliant work environment."
      : matCompliant)
    : matCompliant);

  heading("DETAILS OF APPLICATION MADE OR PROCEEDING PENDING UNDER INSOLVENCY AND BANKRUPTACY CODE 2016");
  if (!d.hasInsolvency) {
    boxed("During the financial year under review, there were NO application/s made or proceeding were pending in the name of the company under the Insolvency and Bankruptcy Code, 2016.");
  } else {
    boxed(`The following applications or proceedings were made or are currently pending in the name of the Company under the Insolvency and Bankruptcy Code, 2016 during the financial year ${fy}:`);
    table(["Sl. No.", "Nature of Proceedings", "Date of Application/Proceeding", "Status", "Court/Tribunal", "Amount Involved"], d.insol.map((x, i) => [i + 1, x.nature, x.date ? ddmmyyyy(x.date) : "", x.status, x.court, x.amount]));
    body("The Company is actively cooperating with the authorities and will take necessary actions in compliance with the relevant provisions of the Insolvency and Bankruptcy Code.");
  }

  heading("DETAILS OF DIFFERENCE BETWEEN VALUATION AMOUNT ON ONE TIME SETTLEMENT AND VALUATION WHILE AVAILING LOAN FROM BANKS AND FINANCIAL INSTITUTIONS");
  if (!d.hasOts) {
    boxed("During the Financial year under review, there were NO one time settlement of Loans taken from Banks and Financial institutions.");
  } else {
    boxed(`The following is a summary of the difference between the valuation amount during one-time settlement and the valuation while availing loans from banks and financial institutions during the financial year ${fy}:`);
    table(["Sl. No.", "Bank/Financial Institution", "Loan Amount Availed (Rs.)", "Valuation During Loan Availment (Rs.)", "Valuation During One-Time Settlement (Rs.)", "Difference (Rs.)"], d.ots.map((o, i) => [i + 1, o.bank, o.loanAmt, o.valLoan, o.valOts, o.valLoan - o.valOts]));
    body(`The difference in valuation arises due to ${d.ots[d.ots.length - 1]?.reasonDiff ?? ""}. The one-time settlement was agreed upon after discussions with the concerned financial institutions.`);
  }

  heading("SECRETARIAL STANDARDS");
  boxed("Your Company has complied with Secretarial Standard-1 (Board Meeting) and Secretarial Standards-2 (General Meetings) (together referred to as the Secretarial Standards) w.e.f. 1st October, 2017 as approved by the Central Government and issued by the Institute of Company Secretaries of India (ICSI) under the provisions of Section 118(10) of the Companies Act, 2013.");

  heading("INTERNAL CONTROL SYSTEMS");
  boxed("The Company’s internal control systems are adequate and commensurate with the nature and size of the Company and it ensures:\n· Timely and accurate financial reporting in accordance with applicable accounting standards.\n· Optimum utilization, efficient monitoring, timely maintenance and safety of its assets. \n· Compliance with applicable laws, regulations and management policies.");

  heading("CONSERVATION OF ENERGY, TECHNOLOGY ABSORPTION AND FOREIGN EXCHANGE EARNINGS AND OUTGO");
  boxed("CONSERVATION OF ENERGY, TECHNOLOGY ABSORPTION\nAs the business and activities of the Company does not involve any manufacturing activity right now, the information required to be provided under the provisions of Section 134(3)(m) of the Companies Act, 2013 in respect of Conservation of energy and technology absorption have not been furnished considering the nature of activities undertaken by the Company during the financial year under review.");
  body("FOREIGN EXCHANGE EARNINGS AND OUTGO");
  table(["Particulars", "Amount"], [["Earnings", d.foreignEarnings ? d.foreignEarnings : "NA"], ["Outgo", d.foreignOutgo ? d.foreignOutgo : "NA"]]);
  body("a) Conservation of Energy:");
  table(["Particulars", "Details"], [["Conservation of Energy", d.conservationDetails || "NA"]]);
  body("b) Technology Absorption:");
  table(["Particulars", "Details"], [
    ["Efforts made for technology absorption", d.technologyEfforts || "NA"],
    ["Benefits derived", d.technologyBenefits || "NA"],
    ["Expenditure on Research &Development, if any", d.technologyExpenditure || "NA"],
    ["Details of technology imported, if any", d.technologyImported || "NA"],
    ["Year of import", d.technologyYear || "NA"],
    ["Whether imported technology fully absorbed", d.technologyAbsorbed || "NA"],
    ["Areas where absorption of imported technology has not taken place, if any", d.technologyNotAbsorbed || "NA"],
  ]);

  heading("LIQUIDITY");
  boxed("Your Company maintains sufficient cash to meet our strategic objectives. We clearly understand that the liquidity in the Balance Sheet is to ensure balance between earning adequate returns and the need to cover financial and business risks. Liquidity also enables your Company to position itself for quick responses to market dynamics.");

  heading("VIGIL MECHANISM");
  if (!d.hasVigil) {
    boxed("The provisions regarding vigil mechanism as provided in Section 177(9) of the Companies Act, 2013 read with rules framed thereunder are not applicable on the Company.");
  } else {
    boxed("The Company has established a Vigil Mechanism as required under Section 177(9) of the Companies Act, 2013 and has adopted a Whistleblower Policy to report concerns about unethical behavior, actual or suspected fraud, or violation of the Company’s code of conduct or ethics.\nThe mechanism is intended to ensure that employees and directors can raise concerns about issues such as:\n· Fraud or financial irregularities\n· Misappropriation of company assets\n· Violation of laws, rules, or regulations\n· Unethical conduct\nThe Company ensures that there is no victimization of any individual who uses this mechanism in good faith. The details of the vigil mechanism are also available to employees and stakeholders.");
    table(["Sl. No.", "Nature of Concern", "Number of Complaints Received", "Number of Complaints Resolved", "Pending Complaints"], d.vigil.map((v, i) => [i + 1, v.nature, v.rec, v.res, v.pend]));
    body("The Company has ensured that appropriate steps are taken to address the concerns raised and follows a structured process for investigation and resolution.");
  }

  heading("CORPORATE SOCIAL RESPONSIBILITY");
  boxed(!d.hasCsr
    ? "As per the provisions of Section 135 of the Companies Act, 2013, read with rules framed there under, every company including its holding or subsidiary and a foreign company, which fulfills the criteria specified in sub-section (1) of section 135 of the Act shall comply with the provisions of Section 135 of the Act and its rules.\nSince the Company is not falling under any criteria specified in sub-section (1) of section 135 of the Act, your Company is not required to constitute a Corporate Social Responsibility (“CSR”) Committee."
    : "The Company has constituted a Corporate Social Responsibility (CSR) Committee as per the provisions of Section 135 of the Companies Act, 2013. The CSR Committee is responsible for formulating and recommending to the Board a CSR Policy, recommending the amount of expenditure to be incurred on CSR activities, and monitoring the implementation of the policy.\nThe details of the CSR activities undertaken by the Company, along with the CSR initiatives and the amount spent, are disclosed in the CSR Report, which is annexed to this report as Annexure II.");

  heading("STATEMENT SHOWING DEVELOPMENT AND IMPLEMENTATION OF RISK MANAGEMENT POLICY OF THE COMPANY");
  boxed(!d.hasRiskPolicy
    ? "During the year, the risk assessment parameters were reviewed. In the opinion of the Board, there are no major elements of risk that have the potential of threatening the existence of the Company.\nTherefore, during the year under review, the Company has not developed and implemented a Risk Management Policy."
    : `The Company has developed and implemented a Risk Management Policy as part of its ongoing commitment to identifying and managing risks effectively. The policy outlines the key risk areas and risk mitigation strategies, including ${d.riskKeyAreas}.\nDuring the year under review, the Risk Management Committee met ${d.riskMeetings} times to assess and monitor the implementation of the policy and to review any emerging risks. The key risk factors and management strategies were discussed, and necessary actions were taken to mitigate potential risks.\nThe Risk Management Policy is in line with the Company’s objectives and strategic goals, ensuring that any potential risks to the Company’s business are promptly identified, assessed, and mitigated.`);

  heading("DIRECTORS’ RESPONSIBILITY STATEMENT");
  boxed("Pursuant to the requirements of Section 134(5) of the Companies Act, 2013, it is hereby confirmed:\n\na) That in the preparation of the annual accounts for the period ended 31.03.2025, the applicable accounting standards have been followed along with proper explanation relating to material departures;\n\nb) That the Directors have selected such accounting policies and applied them consistently and made judgments and estimates that are reasonable and prudent so as to give a true and fair view of the state of affairs of the Company at the end of the financial year and the loss of the Company for the period ended 31.03.2025;\n\nc) That the Directors had taken proper and sufficient care for the maintenance of adequate accounting records in accordance with the provisions of the Companies Act,2013, for safeguarding the assets of the company and for preventing and detecting fraud and other irregularities; \n\nd) That the Directors had prepared the annual accounts on a going concern basis and \n\ne) That the Directors had devised proper systems to ensure compliance with the provisions of all applicable laws and that such systems were adequate and operating effectively.");

  heading("AUDIT TRAIL APPLICABILITY (AUDIT AND AUDITORS) RULES 2014 - RULE 11 OF THE COMPANIES ACT 2013.");
  boxed("The Company has used accounting software for maintaining its books of account for the financial year ended March 31, 2025 which has a feature of recording audit trail (edit log) facility and the same has operated throughout the year for all relevant transactions recorded in the softwares. \nAs proviso to Rule 3(1) of the Companies (Accounts) Rules, 2014 is applicable from April 1, 2023, reporting under Rule 11(g) of the Companies (Audit and Auditors) Rules, 2014 on preservation of audit trail as per the statutory requirements for record retention is not applicable for the financial year ended March 31, 2024.");

  heading("APPOINTMENT OF DESIGNATED PERSON (MANAGEMENT AND ADMINISTRATION) RULES 2014 - RULE 9 OF THE COMPANIES ACT 2013.");
  boxed("In accordance with Rule 9 of the Appointment of Designated Person (Management and Administration) Rules 2014, it is essential for the company to designate a responsible individual for ensuring compliance with statutory obligations.\nThe company has proposed and appointed a Designated person in a Board meeting and the same has been reported in Annual Return of the company.");

  heading("OBTAINING ISIN BY NON-SMALL COMPANIES - COMPANIES (PROSPECTUS AND ALLOTMENT OF SECURITIES) SECOND AMENDMENT RULES, 2023 OF THE COMPANIES ACT 2013.");
  boxed(!d.hasIsin
    ? "The provisions regarding obtaining an International Securities Identification Number (ISIN) under the Companies (Prospectus and Allotment of Securities) Second Amendment Rules, 2023 are not applicable to the Company, as it does not meet the criteria specified for non-small companies as per the said rules."
    : "Recent amendments under the Companies (Prospectus and Allotment of Securities) Second Amendment Rules, 2023, stipulate that non-small companies must obtain an International Securities Identification Number (ISIN) for their securities to facilitate smoother trading and enhance marketability.\nThe company has appointed an RTA and submitted all required documents to the RTA to obtain the ISIN in month of August 2024 to comply with this rule.");

  heading("ACKNOWLEDGEMENT");
  boxed("Your Board takes this opportunity to place on record their appreciation for the dedication and commitment of employees shown at all levels. Your Board also wishes to place on record its appreciation for the services rendered by its auditor, consultants business partners, Bankers, Service Providers as well as regulatory and government authorities for extending support and placing their faith and trust on the Board.");
  c.push(paraML(`For and on behalf of the Board of Directors\n${d.companyName.toUpperCase()}`, { align: "center" }));

  // Signature table (2 cols, bordered)
  const dir0 = d.directors[0];
  const dir1 = d.directors[1];
  const curDate = ddmmyyyy(d.currentDate);
  c.push(gridTable([[
    { text: `${(dir0?.name ?? "").toUpperCase()}\nDIN: ${dir0?.dinPan ?? ""} \nDATE: ${curDate} ` },
    { text: dir1 ? `${dir1.name.toUpperCase()}\nDIN: ${dir1.dinPan}\nDATE: ${curDate} ` : "" },
  ]], { align: "left" }));
  c.push(paraML(` PLACE: ${d.place}`, { align: "center" }));

  // ---- Build the Document (running header, page border, no footer, TNR 11pt) ----
  const border = { style: BorderStyle.SINGLE, size: 4, color: "000000", space: 24 };
  const pageBorders = {
    pageBorders: { display: PageBorderDisplay.ALL_PAGES, offsetFrom: PageBorderOffsetFrom.PAGE },
    pageBorderTop: border, pageBorderBottom: border, pageBorderLeft: border, pageBorderRight: border,
  };
  const header = new Header({
    children: [
      paraML(d.companyName, { align: "center" }),
      paraML(d.companyAddress, { align: "center" }),
      paraML(`CIN: ${d.companyCin} Email: ${d.companyEmail}`, { bold: true, sizePt: 12, align: "center" }),
    ],
  });

  const sections: ISectionOptions[] = [
    { properties: { page: { borders: pageBorders } }, headers: { default: header }, children: c },
  ];

  // AOC-2 annexure (only when related parties = Yes) — its own section, border, no header.
  if (d.hasRelatedParties) {
    const aoc: (Paragraph | Table)[] = [];
    aoc.push(paraML("ANNEXURE-I", { bold: true, align: "right" }));
    aoc.push(paraML("FORM NO. AOC -2", { bold: true, align: "center" }));
    aoc.push(paraML("(Pursuant to clause (h) of sub-section (3) of section 134 of the Act and Rule 8(2) of the Companies (Accounts) Rules, 2014.", { bold: true, align: "center" }));
    aoc.push(paraML("Form for Disclosure of particulars of contracts/arrangements entered into by the company with related parties referred to in sub section (1) of section 188 of the Companies Act, 2013 including certain arm’s length transaction under third proviso thereto."));
    aoc.push(paraML("1. Details of contracts or arrangements or transactions not at Arm’s length basis: NIL"));
    aoc.push(paraML("2. Details of contracts or arrangements or transactions at Arm’s length basis:"));

    const particulars = [
      "a) Name (s) of the related party & nature of relationship",
      "b) Nature of contracts/arrangements/transaction",
      "c) Duration of the contracts/arrangements/transaction",
      "d) Salient terms of the contracts or arrangements or transaction including the value, if any",
      "e) Date of approval by the Board",
      "f) Amount paid as advances, if any",
    ];
    const parties = d.related;
    const lastSl = parties.length ? String(parties.length) : "1";
    const aocRows: Cell[][] = [
      [{ text: "Sl. No.", bold: true }, { text: "Particulars", bold: true }, ...parties.map((_, j) => ({ text: `Related Party ${j + 1}`, bold: true }))],
      [{ text: lastSl }, { text: particulars[0] }, ...parties.map((p) => ({ text: `${p.name} (${p.relationship})` }))],
      [{ text: "" }, { text: particulars[1] }, ...parties.map((p) => ({ text: p.nature }))],
      [{ text: "" }, { text: particulars[2] }, ...parties.map((p) => ({ text: p.duration }))],
      [{ text: "" }, { text: particulars[3] }, ...parties.map((p) => ({ text: p.terms }))],
      [{ text: "" }, { text: particulars[4] }, ...parties.map((p) => ({ text: p.approvalDate }))],
      [{ text: "" }, { text: particulars[5] }, ...parties.map((p) => ({ text: p.advance !== 0 ? String(p.advance) : "NIL" }))],
    ];
    aoc.push(gridTable(aocRows, { align: "left" }));
    sections.push({ properties: { page: { borders: pageBorders } }, children: aoc });
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Times New Roman", size: 22 } } } },
    sections,
  });
  return Packer.toBuffer(doc);
}
