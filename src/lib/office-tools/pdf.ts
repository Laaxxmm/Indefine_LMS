import { PDFParse } from "pdf-parse";

// Extract raw text from a PDF (server-side, Node runtime). pdf-parse v2 wraps
// pdfjs-dist; we concatenate page text much like the source's PyPDF2 loop.
// `firstPages` stops after that many pages (the statutory digest only needs the opening).
export async function extractPdfText(buffer: Buffer | Uint8Array, firstPages?: number): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const res = await parser.getText(firstPages ? { first: firstPages } : undefined);
    return res.text;
  } finally {
    await parser.destroy();
  }
}
