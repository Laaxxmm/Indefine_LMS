import ExcelJS from "exceljs";
import { addSheet, workbookBytes, type Row } from "../xlsx";

// TDS challan PDF → extraction + pivot summary. Faithful port of tools/tds_challan.py.

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const toInt = (s: string) => parseInt(s.replace(/,/g, ""), 10) || 0;

function req(text: string, re: RegExp, fileName: string): string {
  const m = text.match(re);
  if (!m) throw new Error(`Could not parse ${fileName}. Ensure it matches the expected format.`);
  return m[1].trim();
}

export function parseChallan(text: string, fileName: string): Row {
  return {
    "File Name": fileName,
    "ITNS No": req(text, /ITNS No\. :\s*(\d+)/, fileName),
    TAN: req(text, /TAN\s*:\s*(\w+)/s, fileName),
    Name: req(text, /Name\s*:\s*(.+?)(?=\s*Assessment Year|$)/s, fileName),
    "Assessment Year": req(text, /Assessment Year\s*:\s*(\d{4}-\d{2})/, fileName),
    "Financial Year": req(text, /Financial Year\s*:\s*(\d{4}-\d{2})/, fileName),
    "Major Head": req(text, /Major Head\s*:\s*(.+?)(?=\s*Minor Head|$)/s, fileName),
    "Minor Head": req(text, /Minor Head\s*:\s*(.+?)(?=\s*Nature of Payment|$)/s, fileName),
    "Nature of Payment": req(text, /Nature of Payment\s*:\s*(\w+)/, fileName),
    "Total Amount (₹)": toInt(req(text, /Amount \(in Rs\.\)\s*:\s*₹ ([\d,]+)/, fileName)),
    CIN: req(text, /CIN\s*:\s*(\w+)/, fileName),
    "Mode of Payment": req(text, /Mode of Payment\s*:\s*(.+?)(?=\s*Bank Name|$)/s, fileName),
    "Bank Name": req(text, /Bank Name\s*:\s*(.+?)(?=\s*Bank Reference Number|$)/s, fileName),
    "Bank Reference No": req(text, /Bank Reference Number\s*:\s*(\d+)/, fileName),
    "Date of Deposit": req(text, /Date of Deposit\s*:\s*(.+?)(?=\s*BSR code|$)/s, fileName),
    "BSR Code": req(text, /BSR code\s*:\s*(\d+)/, fileName),
    "Challan No": req(text, /Challan No\s*:\s*(\d+)/, fileName),
    "Tender Date": req(text, /Tender Date\s*:\s*(.+?)(?=\s*Tax Breakup Details|$)/s, fileName),
    "Tax (₹)": toInt(req(text, /Tax\s*₹ ([\d,]+)/, fileName)),
    "Surcharge (₹)": toInt(req(text, /Surcharge\s*₹ ([\d,]+)/, fileName)),
    "Cess (₹)": toInt(req(text, /Cess\s*₹ ([\d,]+)/, fileName)),
    "Interest (₹)": toInt(req(text, /Interest\s*₹ ([\d,]+)/, fileName)),
    "Penalty (₹)": toInt(req(text, /Penalty\s*₹ ([\d,]+)/, fileName)),
    "Fee 234E (₹)": toInt(req(text, /Fee under section 234E\s*₹ ([\d,]+)/, fileName)),
  };
}

// dd-MMM-yyyy, or "Unknown" if the string doesn't parse (matches the source's pivot).
function fmtDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return `${String(d.getDate()).padStart(2, "0")}-${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
}

const DATA_COLS = [
  "Sr. No", "File Name", "ITNS No", "TAN", "Name", "Assessment Year", "Financial Year", "Major Head", "Minor Head",
  "Nature of Payment", "Total Amount (₹)", "CIN", "Mode of Payment", "Bank Name", "Bank Reference No", "Date of Deposit",
  "BSR Code", "Challan No", "Tender Date", "Tax (₹)", "Surcharge (₹)", "Cess (₹)", "Interest (₹)", "Penalty (₹)", "Fee 234E (₹)",
];

export async function buildTdsWorkbook(files: { name: string; buffer: Buffer }[], extract: (b: Buffer) => Promise<string>): Promise<{ bytes: Buffer; count: number }> {
  const rows: Row[] = [];
  let sr = 0;
  for (const f of files) {
    sr += 1;
    const text = await extract(f.buffer);
    rows.push({ "Sr. No": sr, ...parseChallan(text, f.name) });
  }

  // Pivot: sum Tax + Total Amount grouped by (Nature of Payment, Date of Deposit),
  // with a subtotal per Nature and a grand total.
  const byNature = new Map<string, Map<string, { tax: number; total: number }>>();
  for (const r of rows) {
    const nature = String(r["Nature of Payment"]);
    const date = fmtDate(String(r["Date of Deposit"]));
    const tax = Number(r["Tax (₹)"]) || 0;
    const total = Number(r["Total Amount (₹)"]) || 0;
    if (!byNature.has(nature)) byNature.set(nature, new Map());
    const dm = byNature.get(nature)!;
    const cur = dm.get(date) ?? { tax: 0, total: 0 };
    dm.set(date, { tax: cur.tax + tax, total: cur.total + total });
  }

  const pivot: Row[] = [];
  let grandTax = 0;
  let grandTotal = 0;
  for (const nature of [...byNature.keys()].sort()) {
    const dm = byNature.get(nature)!;
    let subTax = 0;
    let subTotal = 0;
    for (const date of [...dm.keys()].sort()) {
      const { tax, total } = dm.get(date)!;
      pivot.push({ "Nature of Payment": nature, "Date of Deposit": date, "Tax (₹)": tax, "Total Amount (₹)": total });
      subTax += tax;
      subTotal += total;
    }
    pivot.push({ "Nature of Payment": nature, "Date of Deposit": "Subtotal", "Tax (₹)": subTax, "Total Amount (₹)": subTotal });
    grandTax += subTax;
    grandTotal += subTotal;
  }
  pivot.push({ "Nature of Payment": "Grand Total", "Date of Deposit": "", "Tax (₹)": grandTax, "Total Amount (₹)": grandTotal });

  const wb = new ExcelJS.Workbook();
  addSheet(wb, "Data", DATA_COLS, rows);
  addSheet(wb, "Pivot Summary", ["Nature of Payment", "Date of Deposit", "Tax (₹)", "Total Amount (₹)"], pivot, (r) => r["Date of Deposit"] === "Subtotal" || r["Nature of Payment"] === "Grand Total");
  return { bytes: await workbookBytes(wb), count: files.length };
}
