import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { WAITING, can } from "@/lib/office-tools/engagement-letter-flow";

// Record that the client approved the draft (they reply by email; staff mark it here).
// Unlocks signing. The note says who approved and how, for the history.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOfficeTools(session.user)) return NextResponse.json({ error: "You don't have access to this tool" }, { status: 403 });

  const { id } = await params;
  const letter = await prisma.engagementLetter.findUnique({ where: { id }, select: { status: true } });
  if (!letter) return NextResponse.json({ error: "Letter not found" }, { status: 404 });
  if (!can("approve", letter.status)) return NextResponse.json({ error: WAITING.approve }, { status: 409 });

  const body = (await req.json().catch(() => null)) as { note?: string } | null;
  const note = String(body?.note ?? "").trim().slice(0, 300);
  if (!note) return NextResponse.json({ error: "Say who approved it and how (e.g. Ravi Kumar, by email on 30 Sep)" }, { status: 400 });

  const byName = session.user.name ?? "Unknown";
  await prisma.engagementLetter.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date(), updatedByName: byName } });
  await prisma.engagementLetterEvent.create({ data: { letterId: id, action: "approved", detail: note, byId: session.user.id, byName } });
  return NextResponse.json({ ok: true });
}
