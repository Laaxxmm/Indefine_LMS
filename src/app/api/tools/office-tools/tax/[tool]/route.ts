import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { TAX_PROCESSORS, XLSX_MIME, type PdfFile } from "@/lib/office-tools/tax";
import { recordToolRun } from "@/lib/office-tools/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

// Process uploaded return PDFs into an Excel workbook. No file is stored — the .xlsx
// streams straight back; the run is logged for audit (tool + file count).
export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOfficeTools(session.user)) return NextResponse.json({ error: "You don't have access to this tool" }, { status: 403 });

  const { tool } = await params;
  const proc = TAX_PROCESSORS[tool];
  if (!proc) return NextResponse.json({ error: "Unknown tool" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  const uploaded = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (uploaded.length === 0) return NextResponse.json({ error: "Upload at least one PDF." }, { status: 400 });

  const files: PdfFile[] = [];
  for (const f of uploaded) files.push({ name: f.name, buffer: Buffer.from(await f.arrayBuffer()) });

  let result: { bytes: Buffer; count: number };
  try {
    result = await proc.build(files);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
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
