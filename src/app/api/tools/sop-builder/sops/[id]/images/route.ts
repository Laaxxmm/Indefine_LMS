import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSop } from "@/lib/sop/access";
import { crossSiteRefusal, readUploadForm } from "@/lib/hardening/uploads";
import { imageSize, SCREEN_MAX_BYTES, SCREEN_MAX_HEIGHT, SCREEN_MAX_WIDTH, SCREENS_PER_SOP } from "@/lib/sop/screens";

export const runtime = "nodejs";

const SCREEN_TYPES = { png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"] };

// Upload one screenshot for a SOP. The editor has already shrunk it and burned in any hidden
// areas, so what arrives is what every reader sees. It goes under a step only when the author
// saves the screens as a new version.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const refused = crossSiteRefusal(req);
  if (refused) return refused;

  const { id } = await params;
  const sop = await prisma.sop.findUnique({ where: { id }, select: { department: true, _count: { select: { images: true } } } });
  if (!sop) return NextResponse.json({ error: "That SOP wasn't found. Go back to the SOP list and open it again." }, { status: 404 });
  if (!(await canEditSop(session.user, sop.department)))
    return NextResponse.json({ error: "You don't have permission to edit this department's SOPs. Ask an admin." }, { status: 403 });
  // ponytail: screens added and then removed or never saved still count here; sweep images no version uses if a SOP ever hits the cap.
  if (sop._count.images >= SCREENS_PER_SOP)
    return NextResponse.json({ error: `This SOP already has ${SCREENS_PER_SOP} screens, the most it can hold. Remove screens you no longer need.` }, { status: 413 });

  const read = await readUploadForm(req, { types: SCREEN_TYPES, maxBytes: SCREEN_MAX_BYTES, source: "sop-screen" });
  if (!read.ok) return read.res;
  const info = imageSize(read.file.bytes);
  if (!info) return NextResponse.json({ error: "That file is not a PNG or JPEG picture. Paste the screenshot again." }, { status: 415 });
  if (info.width > SCREEN_MAX_WIDTH || info.height > SCREEN_MAX_HEIGHT)
    return NextResponse.json({ error: `The screenshot is ${info.width}×${info.height} pixels; the limit is ${SCREEN_MAX_WIDTH}×${SCREEN_MAX_HEIGHT}. Add it from the screens page, which shrinks it.` }, { status: 413 });

  const image = await prisma.sopImage.create({
    data: { sopId: id, mime: info.mime, bytes: new Uint8Array(read.file.bytes), width: info.width, height: info.height, createdById: session.user.id },
    select: { id: true },
  });
  return NextResponse.json({ id: image.id, width: info.width, height: info.height }, { status: 201 });
}
