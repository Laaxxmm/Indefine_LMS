import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { DOC_GENERATORS, slug } from "@/lib/office-tools/generate";
import { recordToolRun } from "@/lib/office-tools/audit";
import { DOCX_MIME } from "@/lib/certificates/download";

export const maxDuration = 60;

// Generate a legal/financial .docx from a posted form. No file is stored — the bytes
// stream straight back as a download; a one-line audit row records who/when.
export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOfficeTools(session.user)) return NextResponse.json({ error: "You don't have access to this tool" }, { status: 403 });

  const { tool } = await params;
  const gen = DOC_GENERATORS[tool];
  if (!gen) return NextResponse.json({ error: "Unknown tool" }, { status: 404 });

  const parsed = gen.schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  let buf: Buffer;
  try {
    buf = await gen.render(parsed.data);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  await recordToolRun(session.user, tool, gen.summary(parsed.data));

  const filename = `${slug(gen.filename(parsed.data))}.docx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
