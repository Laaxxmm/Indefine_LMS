import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canRemoveSopScreen } from "@/lib/sop/access";
import { removeScreen } from "@/lib/sop/service";
import { crossSiteRefusal } from "@/lib/hardening/uploads";

export const maxDuration = 60;

// "Remove this screen" (SOP review H1): admins and partners blank a screenshot in every version of
// the SOP and re-file the versions' Word files in OneDrive. Audited (sop.screen-remove, and one
// sop.onedrive-file per re-filed version). Nothing is deleted.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; imageId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const refused = crossSiteRefusal(req);
  if (refused) return refused;
  if (!canRemoveSopScreen(session.user)) return NextResponse.json({ error: "Only admins and partners can remove a screen. Ask one of them." }, { status: 403 });

  const { id, imageId } = await params;
  if (!(await prisma.sop.findUnique({ where: { id }, select: { id: true } })))
    return NextResponse.json({ error: "That SOP wasn't found. Go back to the SOP list and open it again." }, { status: 404 });
  const r = await removeScreen(id, imageId, session.user.id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ message: r.message, refiled: r.refiled, flagged: r.flagged });
}
