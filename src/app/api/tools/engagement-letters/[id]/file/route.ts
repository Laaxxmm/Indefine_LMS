import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { MAX_PDF_BYTES, fileName, uploadLetterPdf, type FileKind } from "@/lib/office-tools/engagement-letters";

export const maxDuration = 60;

// Upload the Indefine-signed PDF (kind=signed, usually DSC-signed in Acrobat) or the
// client's countersigned copy (kind=client) to SharePoint. Same name each time, so
// SharePoint versions it.
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
  if (kind !== "signed" && kind !== "client") return NextResponse.json({ error: "Unknown file kind" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF" }, { status: 400 });
  if (file.size > MAX_PDF_BYTES) return NextResponse.json({ error: "PDF is over 3 MB — too large to email" }, { status: 413 });
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
  await prisma.engagementLetter.update({
    where: { id },
    data:
      kind === "signed"
        ? { graphDriveId: item.driveId, signedItemId: item.id, signedWebUrl: item.webUrl, status: "SIGNED", updatedByName: byName }
        : { graphDriveId: item.driveId, clientSignedItemId: item.id, clientSignedWebUrl: item.webUrl, status: "CLIENT_SIGNED", updatedByName: byName },
  });
  await prisma.engagementLetterEvent.create({
    data: {
      letterId: id,
      action: kind === "signed" ? "signed-upload" : "client-signed-upload",
      detail: fileName(letter.clientName, letter.fy, kind),
      byId: session.user.id,
      byName,
    },
  });
  return NextResponse.json({ ok: true, webUrl: item.webUrl });
}
