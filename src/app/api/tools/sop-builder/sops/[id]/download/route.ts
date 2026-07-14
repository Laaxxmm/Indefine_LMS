import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewSop } from "@/lib/sop/access";
import { renderSopDocx } from "@/lib/sop/render";
import type { SopContent } from "@/lib/sop/types";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "SOP";

// Regenerate the .docx from the stored structured content (nothing read from disk).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewSop(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const vid = new URL(req.url).searchParams.get("v");
  const sop = await prisma.sop.findUnique({ where: { id }, select: { title: true, currentVersionId: true } });
  if (!sop) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const version = await prisma.sopVersion.findFirst({
    where: { sopId: id, id: vid ?? sop.currentVersionId ?? undefined },
    select: { content: true, versionNumber: true },
  });
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });

  const buffer = await renderSopDocx(version.content as unknown as SopContent);
  const filename = `${slug(sop.title)}_v${version.versionNumber}.docx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: { "Content-Type": DOCX_MIME, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}
