import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit/log";
import { canEditSop } from "@/lib/sop/access";
import { crossSiteRefusal, readUploadForm } from "@/lib/hardening/uploads";
import { imageSize, NO_CLIENT_DETAILS_FIELD, SCREEN_MAX_BYTES, SCREEN_MAX_HEIGHT, SCREEN_MAX_WIDTH, SCREENS_PER_SOP, SCREENS_UNSAVED_PER_DAY, screenIdsOf } from "@/lib/sop/screens";
import type { SopContent } from "@/lib/sop/types";

export const runtime = "nodejs";

const SCREEN_TYPES = { png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"] };
const DAY_MS = 24 * 60 * 60 * 1000;

// Upload one screenshot for a SOP. The editor has already shrunk it and burned in any hidden
// areas, so what arrives is what every reader sees. It goes under a step only when the author
// saves the screens as a new version. The author must confirm, with every screen, that no client
// detail is visible (SOP review M1): the hiding is done in the browser, so the server cannot check
// the picture, but it refuses a screen sent without the confirmation.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const refused = crossSiteRefusal(req);
  if (refused) return refused;

  const { id } = await params;
  const sop = await prisma.sop.findUnique({ where: { id }, select: { department: true } });
  if (!sop) return NextResponse.json({ error: "That SOP wasn't found. Go back to the SOP list and open it again." }, { status: 404 });
  if (!(await canEditSop(session.user, sop.department)))
    return NextResponse.json({ error: "You don't have permission to edit this department's SOPs. Ask an admin." }, { status: 403 });

  // The cap counts the screens the SOP's versions show (removed ones excluded). Screens added on the
  // screens page but never saved are capped separately, per day, so they cannot pile up unseen.
  const [versions, images] = await Promise.all([
    prisma.sopVersion.findMany({ where: { sopId: id }, select: { content: true } }),
    prisma.sopImage.findMany({ where: { sopId: id, removedAt: null }, select: { id: true, createdAt: true } }),
  ]);
  const shown = screenIdsOf(versions.map((v) => v.content as unknown as SopContent));
  if (images.filter((i) => shown.has(i.id)).length >= SCREENS_PER_SOP)
    return NextResponse.json({ error: `This SOP's versions already show ${SCREENS_PER_SOP} screens, the most one SOP can hold. An admin or partner can remove screens it no longer needs.` }, { status: 413 });
  const since = Date.now() - DAY_MS;
  if (images.filter((i) => !shown.has(i.id) && i.createdAt.getTime() > since).length >= SCREENS_UNSAVED_PER_DAY)
    return NextResponse.json({ error: `${SCREENS_UNSAVED_PER_DAY} screens were added to this SOP today without being saved in a version. Save the screens page as a new version, or add more tomorrow.` }, { status: 429 });

  const read = await readUploadForm(req, { types: SCREEN_TYPES, maxBytes: SCREEN_MAX_BYTES, source: "sop-screen" });
  if (!read.ok) return read.res;
  if (read.form.get(NO_CLIENT_DETAILS_FIELD) !== "yes")
    return NextResponse.json({ error: "Confirm that no client details are visible in this screenshot (hide any first), then add it again." }, { status: 400 });
  const info = imageSize(read.file.bytes);
  if (!info) return NextResponse.json({ error: "That file is not a PNG or JPEG picture. Paste the screenshot again." }, { status: 415 });
  if (info.width > SCREEN_MAX_WIDTH || info.height > SCREEN_MAX_HEIGHT)
    return NextResponse.json({ error: `The screenshot is ${info.width}×${info.height} pixels; the limit is ${SCREEN_MAX_WIDTH}×${SCREEN_MAX_HEIGHT}. Add it from the screens page, which shrinks it.` }, { status: 413 });

  const image = await prisma.$transaction(async (tx) => {
    const made = await tx.sopImage.create({
      data: { sopId: id, mime: info.mime, bytes: new Uint8Array(read.file.bytes), width: info.width, height: info.height, createdById: session.user.id },
      select: { id: true },
    });
    await logAudit(tx, { actorId: session.user.id, action: "sop.screen-upload", entity: "SopImage", entityId: made.id, meta: { sopId: id, bytes: read.file.bytes.length, width: info.width, height: info.height, noClientDetailsConfirmed: true } });
    return made;
  });
  return NextResponse.json({ id: image.id, width: info.width, height: info.height }, { status: 201 });
}
