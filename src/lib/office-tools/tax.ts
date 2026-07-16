import { extractPdfText } from "./pdf";
import { buildGstr3bWorkbook } from "./tools/gstr3b";
import { buildTdsWorkbook } from "./tools/tdsChallan";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type PdfFile = { name: string; buffer: Buffer };
type TaxProcessor = { build: (files: PdfFile[]) => Promise<{ bytes: Buffer; count: number }>; filename: string };

// PDF-upload tax tools. Each takes N PDFs and returns a styled Excel workbook.
export const TAX_PROCESSORS: Record<string, TaxProcessor> = {
  gstr3b: { build: (files) => buildGstr3bWorkbook(files, extractPdfText), filename: "gstr3b" },
  "tds-challan": { build: (files) => buildTdsWorkbook(files, extractPdfText), filename: "challans" },
};
