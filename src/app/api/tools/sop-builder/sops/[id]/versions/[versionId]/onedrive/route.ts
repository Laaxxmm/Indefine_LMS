import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditSop } from "@/lib/sop/access";
import { fileToOneDrive } from "@/lib/sop/service";
import { crossSiteRefusal } from "@/lib/hardening/uploads";

export const maxDuration = 60;

// Put a version's Word file in the SOP's OneDrive folder again, for a save that never got there.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  const refused = crossSiteRefusal(req);
  if (refused) return refused;

  const { id, versionId } = await params;
  const sop = await prisma.sop.findUnique({ where: { id }, select: { department: true } });
  if (!sop) return NextResponse.json({ error: "That SOP wasn't found. Go back to the SOP list and open it again." }, { status: 404 });
  if (!(await canEditSop(session.user, sop.department)))
    return NextResponse.json({ error: "You don't have permission to edit this department's SOPs. Ask an admin." }, { status: 403 });
  if (!(await prisma.sopVersion.findFirst({ where: { id: versionId, sopId: id }, select: { id: true } })))
    return NextResponse.json({ error: "That version of the SOP wasn't found. Reload the page and try again." }, { status: 404 });

  const webUrl = await fileToOneDrive(id, versionId, session.user.id);
  if (!webUrl) return NextResponse.json({ error: "OneDrive did not take the file. Try again in a minute; if it keeps failing, tell an admin." }, { status: 502 });
  return NextResponse.json({ webUrl });
}
