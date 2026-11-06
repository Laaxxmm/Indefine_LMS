import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseCertificateTool } from "@/lib/certificates/access";
import { byId } from "@/lib/certificates/registry";
import { renderDocx } from "@/lib/certificates/render/toDocx";
import { DOCX_MIME, certificateFilename } from "@/lib/certificates/download";
import { isAdmin } from "@/lib/access";
import { failureSentence } from "@/lib/errors";

// Regenerate-on-demand (§8). Nothing is read from disk — the DOCX is rebuilt from the
// stored payload against the exact pinned template version that issued it.
export async function GET(_req: Request, { params }: { params: Promise<{ issueId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canUseCertificateTool(session.user)) return NextResponse.json({ error: "You don't have access to the certificate generator. Ask an admin to give you access." }, { status: 403 });

  const { issueId } = await params;
  const issue = await prisma.certificateIssue.findUnique({ where: { id: issueId } });
  if (!issue) return NextResponse.json({ error: "That certificate wasn't found. Reload the history and try again." }, { status: 404 });

  // Privacy — only the creator or an admin may download (§8).
  if (issue.createdById !== session.user.id && !isAdmin(session.user)) {
    return NextResponse.json({ error: "Only the person who issued this certificate, or an admin, can download it." }, { status: 403 });
  }

  const template = byId(issue.formatId);
  // Don't silently render a different version — refuse if the pinned version is gone.
  if (!template || template.version !== issue.templateVersion) {
    return NextResponse.json({ error: "This certificate's template has changed since it was issued, so it can't be downloaded again. Issue it again with the current template." }, { status: 409 });
  }

  let buffer: Buffer;
  try {
    buffer = await renderDocx(template, issue.payload as Record<string, unknown>);
  } catch (e) {
    return NextResponse.json({ error: failureSentence(e, "The certificate could not be prepared for download.", "Try again; if it keeps happening, tell IT.") }, { status: 400 });
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
