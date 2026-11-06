import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { TAX_PROCESSORS, XLSX_MIME, type PdfFile } from "@/lib/office-tools/tax";
import { recordToolRun } from "@/lib/office-tools/audit";
import { PDF_TYPES, readMultipartUpload } from "@/lib/hardening/uploads";
import { failureSentence } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

// Return PDFs are ~100 KB each; these only stop a crafted upload from tying up the parser.
const MAX_FILES = 200;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** 200 returns at ~100 KB are ~20 MB; the whole request is capped well above that, far below 200 × 10 MB. */
const MAX_REQUEST_BYTES = 100 * 1024 * 1024;

// Process uploaded return PDFs into an Excel workbook. No file is stored — the .xlsx
// streams straight back; the run is logged for audit (tool + file count).
export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canUseOfficeTools(session.user)) return NextResponse.json({ error: "You don't have access to this tool. Ask an admin to give you access." }, { status: 403 });

  const { tool } = await params;
  const proc = TAX_PROCESSORS[tool];
  if (!proc) return NextResponse.json({ error: "That tool doesn't exist. Go back to Office tools and pick one from the list." }, { status: 404 });

  // The body is capped before it is read, and every file is screened: PDF only (content checked),
  // 10 MB each, at most MAX_FILES (src/lib/hardening/uploads.ts).
  const read = await readMultipartUpload(req, { fields: ["files"], types: PDF_TYPES, maxBytes: MAX_FILE_BYTES, maxFiles: MAX_FILES, maxTotalBytes: MAX_REQUEST_BYTES, source: "tax-tool" });
  if (!read.ok) return read.res;
  const bad = read.rejected[0];
  if (bad) return NextResponse.json({ error: `${bad.name}: ${bad.reason.replace(/\.$/, "")}. Upload the return PDFs only.` }, { status: bad.status });
  if (read.files.length === 0) return NextResponse.json({ error: "Upload at least one PDF." }, { status: 400 });

  const files: PdfFile[] = read.files.map((f) => ({ name: f.name, buffer: Buffer.from(f.bytes) }));

  let result: { bytes: Buffer; count: number };
  try {
    result = await proc.build(files);
  } catch (e) {
    return NextResponse.json({ error: failureSentence(e, "The return PDFs could not be read.", "Check that you uploaded the right return PDFs and try again.") }, { status: 422 });
  }

  await recordToolRun(session.user, tool, `${result.count} file${result.count === 1 ? "" : "s"} processed`);

  return new NextResponse(new Uint8Array(result.bytes), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${proc.filename}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
