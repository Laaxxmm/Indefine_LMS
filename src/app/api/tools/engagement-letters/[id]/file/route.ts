import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { MAX_PDF_BYTES, fileName, uploadLetterPdf, type FileKind } from "@/lib/office-tools/engagement-letters";
import { WAITING, can, type Step } from "@/lib/office-tools/engagement-letter-flow";

export const maxDuration = 60;

const STEP: Record<FileKind, Step> = { draft: "uploadDraft", signed: "uploadSigned", client: "uploadClient" };
const ACTION: Record<FileKind, string> = { draft: "draft-upload", signed: "signed-upload", client: "client-signed-upload" };

// Upload one of the three PDFs to SharePoint: the unsigned draft (for approval), the
// Indefine-signed letter (only after approval) or the client's countersigned copy.
// Same name each time per kind, so SharePoint versions it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOfficeTools(session.user)) return NextResponse.json({ error: "You don't have access to this tool" }, { status: 403 });

  const { id } = await params;
  const letter = await prisma.engagementLetter.findUnique({ where: { id } });
  if (!letter) return NextResponse.json({ error: "Letter not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const kind = form?.get("kind") as FileKind | null;
  const file = form?.get("file");
  if (kind !== "draft" && kind !== "signed" && kind !== "client") return NextResponse.json({ error: "Unknown file kind" }, { status: 400 });
  if (!can(STEP[kind], letter.status)) return NextResponse.json({ error: WAITING[STEP[kind]] }, { status: 409 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF" }, { status: 400 });
  if (file.size > MAX_PDF_BYTES) {
    // A letter saved with Chrome/Edge "Save as PDF" is ~0.2 MB; a big file almost always means
    // "Microsoft Print to PDF" (every page saved as a picture) or a large signature photo.
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return NextResponse.json(
      { error: `PDF is ${mb} MB (limit 3 MB). Print again and choose Destination "Save as PDF", not "Microsoft Print to PDF"; it should be well under 1 MB.` },
      { status: 413 }
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") return NextResponse.json({ error: "That file is not a PDF" }, { status: 400 });

  let item;
  try {
    item = await uploadLetterPdf(letter.clientName, letter.fy, kind, bytes);
  } catch (e) {
    console.error("EL upload failed:", (e as Error).message);
    return NextResponse.json({ error: "Upload to SharePoint failed — try again, or tell the admin if it keeps failing" }, { status: 502 });
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
