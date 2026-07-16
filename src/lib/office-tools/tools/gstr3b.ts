import ExcelJS from "exceljs";
import { MONTHS } from "../date";
import { addSheet, unionColumns, workbookBytes, type Row } from "../xlsx";

// GSTR-3B return PDF → flat extraction. Faithful port of tools/gstr3b.py.

const num = (s?: string | null): number => {
  if (!s || s === "-" || s === "") return 0;
  const v = parseFloat(s.replace(/,/g, ""));
  return Number.isNaN(v) ? 0 : v;
};

function req(text: string, re: RegExp, fileName: string): string {
  const m = text.match(re);
  if (!m) throw new Error(`Could not parse ${fileName}. Expected field not found.`);
  return m[1].trim();
}

export function parseGstr3b(text: string, fileName: string): Row[] {
  const rows: Row[] = [];

  const year = req(text, /Year\s*(\d{4}-\d{2})/s, fileName);
  const period = req(text, /Period\s*(\w+)/s, fileName);
  const gstin = req(text, /GSTIN of the supplier\s*(\w+)/s, fileName);
  const legalName = req(text, /2\(a\)\. Legal name of the registered person\s*(.+?)\s*2\(b\)/s, fileName);
  const tradeName = req(text, /2\(b\)\. Trade name, if any\s*(.+?)\s*2\(c\)/s, fileName);
  const arn = req(text, /2\(c\)\. ARN\s*(\w+)/s, fileName);
  const arnDate = req(text, /2\(d\)\. Date of ARN\s*(\d{2}\/\d{2}\/\d{4})/s, fileName);
  const verDate = req(text, /Date:\s*(\d{2}\/\d{2}\/\d{4})/s, fileName);
  const signName = req(text, /Name of Authorized Signatory\s*(.+?)\s*Designation/s, fileName);
  const designation = req(text, /Designation \/Status\s*(.+?)\s*FILED/s, fileName);

  const monthNum = MONTHS.indexOf(period) + 1; // 1..12; 0 if not a month name
  const [firstYear, secondYear] = year.split("-").map(Number);
  const periodYear = monthNum <= 3 && monthNum > 0 ? secondYear : firstYear;
  const periodDate = `${periodYear}-${String(monthNum).padStart(2, "0")}-01`;

  const common: Row = {
    "File Name": fileName,
    GSTIN: gstin,
    "Legal Name": legalName,
    "Trade Name": tradeName,
    ARN: arn,
    "ARN Date": arnDate,
    Year: year,
    Period: period,
    "Period Date": periodDate,
    "Verification Date": verDate,
    "Signatory Name": signName,
    Designation: designation,
  };
  const push = (extra: Row) => rows.push({ ...common, ...extra });
  const S31 = "3.1 Details of Outward supplies and inward supplies liable to reverse charge";
  const S32 = "3.2 Out of supplies made in 3.1 (a) above, details of inter-state supplies made";
  const S4 = "4. Eligible ITC";
  const S5 = "5. Values of exempt, nil-rated and non-GST inward supplies";
  const S51 = "5.1 Interest and Late fee for previous tax period";
  const S61 = "6.1 Payment of tax";
  let m: RegExpMatchArray | null;

  // 3.1
  m = text.match(/\(a\) Outward taxable supplies \(other than zero rated, nil rated and \s*exempted\)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) push({ Section: S31, "Nature of Supplies": "(a) Outward taxable supplies (other than zero rated, nil rated and exempted)", "Total taxable value": num(m[1]), "Integrated tax": num(m[2]), "Central tax": num(m[3]), "State/UT tax": num(m[4]), Cess: num(m[5]) });

  m = text.match(/\(b\) Outward taxable supplies \(zero rated\)\s*([\d.,]+)\s*([\d.,]+)\s*-\s*-\s*([\d.,]+)/s);
  if (m) push({ Section: S31, "Nature of Supplies": "(b) Outward taxable supplies (zero rated)", "Total taxable value": num(m[1]), "Integrated tax": num(m[2]), "Central tax": 0, "State/UT tax": 0, Cess: num(m[3]) });

  m = text.match(/\(c \) Other outward supplies \(nil rated, exempted\)\s*([\d.,]+)\s*-\s*-\s*-\s*-/s);
  if (m) push({ Section: S31, "Nature of Supplies": "(c ) Other outward supplies (nil rated, exempted)", "Total taxable value": num(m[1]), "Integrated tax": 0, "Central tax": 0, "State/UT tax": 0, Cess: 0 });

  m = text.match(/\(d\) Inward supplies \(liable to reverse charge\)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) push({ Section: S31, "Nature of Supplies": "(d) Inward supplies (liable to reverse charge)", "Total taxable value": num(m[1]), "Integrated tax": num(m[2]), "Central tax": num(m[3]), "State/UT tax": num(m[4]), Cess: num(m[5]) });

  m = text.match(/\(e\) Non-GST outward supplies\s*([\d.,]+)\s*-\s*-\s*-\s*-/s);
  if (m) push({ Section: S31, "Nature of Supplies": "(e) Non-GST outward supplies", "Total taxable value": num(m[1]), "Integrated tax": 0, "Central tax": 0, "State/UT tax": 0, Cess: 0 });

  // 3.2
  m = text.match(/Supplies made to Unregistered Persons\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) push({ Section: S32, "Nature of Supplies": "Supplies made to Unregistered Persons", "Total taxable value": num(m[1]), "Integrated tax": num(m[2]) });
  m = text.match(/Supplies made to Composition Taxable \s*Persons\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) push({ Section: S32, "Nature of Supplies": "Supplies made to Composition Taxable Persons", "Total taxable value": num(m[1]), "Integrated tax": num(m[2]) });
  m = text.match(/Supplies made to UIN holders\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) push({ Section: S32, "Nature of Supplies": "Supplies made to UIN holders", "Total taxable value": num(m[1]), "Integrated tax": num(m[2]) });

  // 4. Eligible ITC — A. ITC Available
  const itcA = "A. ITC Available (whether in full or part)";
  const itc4 = (re: RegExp, detail: string, sub: string) => {
    const g = text.match(re);
    if (g) push({ Section: S4, Subsection: sub, Detail: detail, "Integrated tax": num(g[1]), "Central tax": num(g[2]), "State/UT tax": num(g[3]), Cess: num(g[4]) });
  };
  itc4(/\(1\) Import of goods\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "(1) Import of goods", itcA);
  itc4(/\(2\) Import of services\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "(2) Import of services", itcA);
  itc4(/\(3\) Inward supplies liable to reverse charge \(other than 1 & 2 above\)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "(3) Inward supplies liable to reverse charge (other than 1 & 2 above)", itcA);
  itc4(/\(4\) Inward supplies from ISD\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "(4) Inward supplies from ISD", itcA);
  itc4(/\(5\) All other ITC\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "(5) All other ITC", itcA);
  itc4(/\(1\) As per rules 38,42 & 43 of CGST Rules and section 17\(5\)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "(1) As per rules 38,42 & 43 of CGST Rules and section 17(5)", "B. ITC Reversed");
  itc4(/\(2\) Others\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "(2) Others", "B. ITC Reversed");
  itc4(/C. Net ITC available \(A-B\)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "", "C. Net ITC available (A-B)");
  itc4(/\(D\) Other Details\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "", "D. Other Details");
  itc4(/\(1\) ITC reclaimed which was reversed under Table 4\(B\)\(2\) in earlier tax \s*period\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "(1) ITC reclaimed which was reversed under Table 4(B)(2) in earlier tax period", "D. Other Details");
  itc4(/\(2\) Ineligible ITC under section 16\(4\) & ITC restricted due to PoS rules\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s, "(2) Ineligible ITC under section 16(4) & ITC restricted due to PoS rules", "D. Other Details");

  // 5.
  m = text.match(/From a supplier under composition scheme, Exempt, Nil rated supply\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) push({ Section: S5, "Nature of Supplies": "From a supplier under composition scheme, Exempt, Nil rated supply", "Inter- State supplies": num(m[1]), "Intra- State supplies": num(m[2]) });
  m = text.match(/Non GST supply\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) push({ Section: S5, "Nature of Supplies": "Non GST supply", "Inter- State supplies": num(m[1]), "Intra- State supplies": num(m[2]) });

  // 5.1
  m = text.match(/System computed \s*Interest\s*-\s*-\s*-\s*-/s);
  if (m) push({ Section: S51, Detail: "System computed Interest", "Integrated tax": 0, "Central tax": 0, "State/UT tax": 0, Cess: 0 });
  m = text.match(/Interest Paid\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) push({ Section: S51, Detail: "Interest Paid", "Integrated tax": num(m[1]), "Central tax": num(m[2]), "State/UT tax": num(m[3]), Cess: num(m[4]) });
  m = text.match(/Late fee\s*-\s*([\d.,]+)\s*([\d.,]+)\s*-/s);
  if (m) push({ Section: S51, Detail: "Late fee", "Integrated tax": 0, "Central tax": num(m[1]), "State/UT tax": num(m[2]), Cess: 0 });

  // 6.1 Payment of tax
  const payRow = (type: string, taxType: string, map: Record<string, number>): void => {
    push({ Section: S61, Type: type, "Tax Type": taxType, ...map });
  };
  m = text.match(/\(A\) Other than reverse charge\s*Integrated tax\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*-\s*([\d.,]+)\s*([\d.,]+)\s*-/s);
  if (m) payRow("(A) Other than reverse charge", "Integrated tax", { "Tax payable": num(m[1]), "Adjustment of negative liability of previous tax period": num(m[2]), "Net Tax Payable": num(m[3]), "Tax paid through ITC Integrated tax": num(m[4]), "Tax paid through ITC Central tax": num(m[5]), "Tax paid through ITC State/UT tax": num(m[6]), "Tax paid through ITC Cess": 0, "Tax paid in cash": num(m[7]), "Interest paid in cash": num(m[8]), "Late fee paid in cash": 0 });
  m = text.match(/Central tax\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*-\s*-\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) payRow("(A) Other than reverse charge", "Central tax", { "Tax payable": num(m[1]), "Adjustment of negative liability of previous tax period": num(m[2]), "Net Tax Payable": num(m[3]), "Tax paid through ITC Integrated tax": num(m[4]), "Tax paid through ITC Central tax": num(m[5]), "Tax paid through ITC State/UT tax": 0, "Tax paid through ITC Cess": 0, "Tax paid in cash": num(m[6]), "Interest paid in cash": num(m[7]), "Late fee paid in cash": num(m[8]) });
  m = text.match(/State\/UT tax\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*-\s*([\d.,]+)\s*-\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) payRow("(A) Other than reverse charge", "State/UT tax", { "Tax payable": num(m[1]), "Adjustment of negative liability of previous tax period": num(m[2]), "Net Tax Payable": num(m[3]), "Tax paid through ITC Integrated tax": num(m[4]), "Tax paid through ITC Central tax": 0, "Tax paid through ITC State/UT tax": num(m[5]), "Tax paid through ITC Cess": 0, "Tax paid in cash": num(m[6]), "Interest paid in cash": num(m[7]), "Late fee paid in cash": num(m[8]) });
  m = text.match(/Cess\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*-\s*-\s*-\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*-/s);
  if (m) payRow("(A) Other than reverse charge", "Cess", { "Tax payable": num(m[1]), "Adjustment of negative liability of previous tax period": num(m[2]), "Net Tax Payable": num(m[3]), "Tax paid through ITC Integrated tax": 0, "Tax paid through ITC Central tax": 0, "Tax paid through ITC State/UT tax": 0, "Tax paid through ITC Cess": num(m[4]), "Tax paid in cash": num(m[5]), "Interest paid in cash": num(m[6]), "Late fee paid in cash": 0 });

  const B = "(B) Reverse charge and supplies made u/s 9(5)";
  m = text.match(/\(B\) Reverse charge and supplies made u\/s 9\(5\)\s*Integrated tax\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*-\s*-\s*-\s*-\s*([\d.,]+)\s*-\s*-/s);
  if (m) payRow(B, "Integrated tax", { "Tax payable": num(m[1]), "Adjustment of negative liability of previous tax period": num(m[2]), "Net Tax Payable": num(m[3]), "Tax paid through ITC Integrated tax": 0, "Tax paid through ITC Central tax": 0, "Tax paid through ITC State/UT tax": 0, "Tax paid through ITC Cess": 0, "Tax paid in cash": num(m[4]), "Interest paid in cash": 0, "Late fee paid in cash": 0 });
  m = text.match(/Central tax\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*-\s*-\s*-\s*-\s*([\d.,]+)\s*-\s*-/s);
  if (m) payRow(B, "Central tax", { "Tax payable": num(m[1]), "Adjustment of negative liability of previous tax period": num(m[2]), "Net Tax Payable": num(m[3]), "Tax paid through ITC Integrated tax": 0, "Tax paid through ITC Central tax": 0, "Tax paid through ITC State/UT tax": 0, "Tax paid through ITC Cess": 0, "Tax paid in cash": num(m[4]), "Interest paid in cash": 0, "Late fee paid in cash": 0 });
  m = text.match(/State\/UT tax\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*-\s*-\s*-\s*-\s*([\d.,]+)\s*-\s*-/s);
  if (m) payRow(B, "State/UT tax", { "Tax payable": num(m[1]), "Adjustment of negative liability of previous tax period": num(m[2]), "Net Tax Payable": num(m[3]), "Tax paid through ITC Integrated tax": 0, "Tax paid through ITC Central tax": 0, "Tax paid through ITC State/UT tax": 0, "Tax paid through ITC Cess": 0, "Tax paid in cash": num(m[4]), "Interest paid in cash": 0, "Late fee paid in cash": 0 });
  m = text.match(/Cess\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*-\s*-\s*-\s*-\s*([\d.,]+)\s*-\s*-/s);
  if (m) payRow(B, "Cess", { "Tax payable": num(m[1]), "Adjustment of negative liability of previous tax period": num(m[2]), "Net Tax Payable": num(m[3]), "Tax paid through ITC Integrated tax": 0, "Tax paid through ITC Central tax": 0, "Tax paid through ITC State/UT tax": 0, "Tax paid through ITC Cess": 0, "Tax paid in cash": num(m[4]), "Interest paid in cash": 0, "Late fee paid in cash": 0 });

  m = text.match(/Breakup of tax liability declared \(for interest computation\)\s*Period\s*Integrated tax\s*Central tax\s*State\/UT tax\s*Cess\s*March 2025\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)\s*([\d.,]+)/s);
  if (m) push({ Section: "Breakup of tax liability declared (for interest computation)", Period: "March 2025", "Integrated tax": num(m[1]), "Central tax": num(m[2]), "State/UT tax": num(m[3]), Cess: num(m[4]) });

  return rows;
}

const hasStr = (v: string | number | undefined, needle: string) => typeof v === "string" && v.includes(needle);

// Build the consolidated GSTR-3B workbook (single "Data" sheet, key rows highlighted).
export async function buildGstr3bWorkbook(files: { name: string; buffer: Buffer }[], extract: (b: Buffer) => Promise<string>): Promise<{ bytes: Buffer; count: number }> {
  const allRows: Row[] = [];
  let sr = 0;
  for (const f of files) {
    sr += 1;
    const text = await extract(f.buffer);
    const fileRows = parseGstr3b(text, f.name);
    for (const r of fileRows) allRows.push({ ...r, "Sr. No": sr });
  }
  const columns = unionColumns(allRows);
  const wb = new ExcelJS.Workbook();
  addSheet(wb, "Data", columns, allRows, (r) => hasStr(r.Subsection, "Net") || hasStr(r.Detail, "Total") || hasStr(r.Section, "Grand") || hasStr(r.Detail, "Net"));
  return { bytes: await workbookBytes(wb), count: files.length };
}
