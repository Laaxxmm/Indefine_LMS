import { PDFParse } from "pdf-parse";

// Extract raw text from a PDF (server-side, Node runtime). pdf-parse v2 wraps
// pdfjs-dist; we concatenate page text much like the source's PyPDF2 loop.
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const res = await parser.getText();
    return res.text;
  } finally {
    await parser.destroy();
  }
}
