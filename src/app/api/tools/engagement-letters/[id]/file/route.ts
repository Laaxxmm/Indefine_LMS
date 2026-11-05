import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { MAX_PDF_BYTES, fileName, uploadLetterPdf, type FileKind } from "@/lib/office-tools/engagement-letters";
import { WAITING, can, type Step } from "@/lib/office-tools/engagement-letter-flow";
import { PDF_TYPES, readMultipartUpload } from "@/lib/hardening/uploads";

export const maxDuration = 60;

const STEP: Record<FileKind, Step> = { draft: "uploadDraft", signed: "uploadSigned", client: "uploadClient" };
const ACTION: Record<FileKind, string> = { draft: "draft-upload", signed: "signed-upload", client: "client-signed-upload" };
// A letter saved with Chrome/Edge "Save as PDF" is ~0.2 MB; a big file almost always means
// "Microsoft Print to PDF" (every page saved as a picture) or a large signature photo.
const TOO_BIG = `The PDF is over the ${MAX_PDF_BYTES / 1024 / 1024} MB limit. Print again and choose Destination "Save as PDF", not "Microsoft Print to PDF"; it should be well under 1 MB.`;

// Upload one of the three PDFs to SharePoint: the unsigned draft (for approval), the
// Indefine-signed letter (only after approval) or the client's countersigned copy.
// Same name each time per kind, so SharePoint versions it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canUseOfficeTools(session.user)) return NextResponse.json({ error: "You don't have access to this tool. Ask an admin to give you access." }, { status: 403 });

  const { id } = await params;
  const letter = await prisma.engagementLetter.findUnique({ where: { id } });
  if (!letter) return NextResponse.json({ error: "That letter wasn't found. Go back to the letters list and open it again." }, { status: 404 });

  // Body capped before it is read, then the one PDF screened (type, content, size, scan hook).
  const read = await readMultipartUpload(req, { fields: ["file"], types: PDF_TYPES, maxBytes: MAX_PDF_BYTES, maxFiles: 1, source: "engagement-letter" });
  if (!read.ok) {
    if (read.res.status !== 413) return read.res;
    return NextResponse.json({ error: TOO_BIG }, { status: 413 });
  }
  const kind = read.form.get("kind") as FileKind | null;
  if (kind !== "draft" && kind !== "signed" && kind !== "client") return NextResponse.json({ error: "That file isn't a draft, a signed copy or a client copy. Reload the page and try again." }, { status: 400 });
  if (!can(STEP[kind], letter.status)) return NextResponse.json({ error: WAITING[STEP[kind]] }, { status: 409 });
  const bad = read.rejected[0];
  if (bad) return NextResponse.json({ error: bad.status === 413 ? TOO_BIG : bad.reason.startsWith("The content does not look like a .pdf file") ? "That file is not a PDF. Upload the letter as a PDF." : bad.reason }, { status: bad.status === 413 ? 413 : 400 });
  const file = read.files[0];
  if (!file) return NextResponse.json({ error: "Choose a PDF to upload." }, { status: 400 });
  const bytes = file.bytes;

  let item;
  try {
    item = await uploadLetterPdf(letter.clientName, letter.fy, kind, bytes);
  } catch (e) {
    console.error("EL upload failed:", (e as Error).message);
    return NextResponse.json({ error: "The upload to SharePoint failed. Try again; if it keeps failing, tell IT." }, { status: 502 });
  }

  const byName = session.user.name ?? "Unknown";
  const data: Prisma.EngagementLetterUpdateInput =
    kind === "draft"
      ? { draftItemId: item.id, draftWebUrl: item.webUrl, status: "DRAFT_UPLOADED" }
      : kind === "signed"
        ? { signedItemId: item.id, signedWebUrl: item.webUrl, status: "SIGNED" }
        : { clientSignedItemId: item.id, clientSignedWebUrl: item.webUrl, status: "CLIENT_SIGNED" };
  await prisma.engagementLetter.update({ where: { id }, data: { ...data, graphDriveId: item.driveId, updatedByName: byName } });
  await prisma.engagementLetterEvent.create({
    data: { letterId: id, action: ACTION[kind], detail: fileName(letter.clientName, letter.fy, kind), byId: session.user.id, byName },
  });
  return NextResponse.json({ ok: true, webUrl: item.webUrl });
}
