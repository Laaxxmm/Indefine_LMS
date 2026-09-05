import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseCertificateTool } from "@/lib/certificates/access";
import { byId } from "@/lib/certificates/registry";
import { renderDocx } from "@/lib/certificates/render/toDocx";
import { DOCX_MIME, certificateFilename } from "@/lib/certificates/download";
import { isAdmin } from "@/lib/access";

// Regenerate-on-demand (§8). Nothing is read from disk — the DOCX is rebuilt from the
// stored payload against the exact pinned template version that issued it.
export async function GET(_req: Request, { params }: { params: Promise<{ issueId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseCertificateTool(session.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { issueId } = await params;
  const issue = await prisma.certificateIssue.findUnique({ where: { id: issueId } });
  if (!issue) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Privacy — only the creator or an admin may download (§8).
  if (issue.createdById !== session.user.id && !isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const template = byId(issue.formatId);
  // Don't silently render a different version — refuse if the pinned version is gone.
  if (!template || template.version !== issue.templateVersion) {
    return NextResponse.json({ error: `Template ${issue.formatId} v${issue.templateVersion} is no longer available` }, { status: 409 });
  }

  let buffer: Buffer;
  try {
    buffer = await renderDocx(template, issue.payload as Record<string, unknown>);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const filename = certificateFilename(issue.formatId, issue.clientName, issue.createdAt.toISOString());
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
