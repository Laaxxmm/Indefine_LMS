import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { fyLabel, fyOf } from "@/lib/office-tools/engagement-letters";

// Save the generator form to the register. One letter per client per FY: saving again
// (with its id) updates it and appends a "saved" event carrying the form snapshot, so
// any earlier version can be reopened. Editing after a signed PDF was uploaded puts the
// letter back to DRAFT until the new signed PDF is uploaded.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseOfficeTools(session.user)) return NextResponse.json({ error: "You don't have access to this tool" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { id?: string; data?: Record<string, unknown>; overwrite?: boolean } | null;
  const data = body?.data;
  const clientName = typeof data?.client === "string" ? data.client.trim().replace(/\s+/g, " ") : "";
  const fy = fyOf(String(data?.start ?? ""));
  if (!data || !clientName || !fy) return NextResponse.json({ error: "Client name and start date are required" }, { status: 400 });
  if (JSON.stringify(data).length > 200_000) return NextResponse.json({ error: "Form is too large" }, { status: 413 });

  const user = session.user;
  const byName = user.name ?? "Unknown";
  const same = await prisma.engagementLetter.findUnique({ where: { clientName_fy: { clientName, fy } }, select: { id: true } });

  let id = body?.id;
  if (id) {
    const cur = await prisma.engagementLetter.findUnique({ where: { id }, select: { id: true } });
    if (!cur) return NextResponse.json({ error: "Letter not found" }, { status: 404 });
    if (same && same.id !== id) {
      return NextResponse.json({ error: `A letter for ${clientName} FY ${fyLabel(fy)} already exists`, existingId: same.id }, { status: 409 });
    }
  } else if (same) {
    if (!body?.overwrite) {
      return NextResponse.json({ error: `A letter for ${clientName} FY ${fyLabel(fy)} already exists`, existingId: same.id }, { status: 409 });
    }
    id = same.id;
  }

  const json = data as Prisma.InputJsonValue;
  const letter = id
    ? await prisma.engagementLetter.update({ where: { id }, data: { clientName, fy, data: json, status: "DRAFT", updatedByName: byName } })
    : await prisma.engagementLetter.create({
        data: { clientName, fy, data: json, createdById: user.id, createdByName: byName, updatedByName: byName },
      });
  await prisma.engagementLetterEvent.create({ data: { letterId: letter.id, action: "saved", data: json, byId: user.id, byName } });
  const versions = await prisma.engagementLetterEvent.count({ where: { letterId: letter.id, action: "saved" } });
  return NextResponse.json({ id: letter.id, version: versions, clientName, fy });
}
