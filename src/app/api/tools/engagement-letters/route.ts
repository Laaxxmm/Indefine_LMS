import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { fyLabel, fyOf } from "@/lib/office-tools/engagement-letters";
import { folderName } from "@/lib/clients/core";

// Save the generator form to the register. One letter per client per FY: saving again
// (with its id) updates it and appends a "saved" event carrying the form snapshot, so
// any earlier version can be reopened. Saving restarts the approval flow at DRAFT: the
// uploaded PDFs no longer match the form, so their links are cleared (the files stay in
// SharePoint with their version history).
const RESTART = {
  status: "DRAFT",
  draftItemId: null, draftWebUrl: null, draftSentAt: null, approvedAt: null,
  signedItemId: null, signedWebUrl: null, sentAt: null, sentTo: null,
  clientSignedItemId: null, clientSignedWebUrl: null,
} as const;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canUseOfficeTools(session.user)) return NextResponse.json({ error: "You don't have access to this tool. Ask an admin to give you access." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { id?: string; data?: Record<string, unknown>; overwrite?: boolean } | null;
  const data = body?.data;
  const clientName = typeof data?.client === "string" ? data.client.trim().replace(/\s+/g, " ") : "";
  const fy = fyOf(String(data?.start ?? ""));
  if (!data || !clientName || !fy) return NextResponse.json({ error: "Enter the client's name and the start date." }, { status: 400 });
  // The name becomes a SharePoint folder: "." or ".." would resolve outside the EL root.
  if (!/[A-Za-z0-9]/.test(folderName(clientName))) return NextResponse.json({ error: "The client name needs at least one letter or digit." }, { status: 400 });
  if (body?.id !== undefined && typeof body.id !== "string") return NextResponse.json({ error: "That letter link is not complete. Open the letter again from the list." }, { status: 400 });
  if (JSON.stringify(data).length > 200_000) return NextResponse.json({ error: "The form is too large to save. Shorten the longest entries and try again." }, { status: 413 });

  const user = session.user;
  const byName = user.name ?? "Unknown";
  const same = await prisma.engagementLetter.findUnique({ where: { clientName_fy: { clientName, fy } }, select: { id: true } });

  let id = body?.id;
  if (id) {
    const cur = await prisma.engagementLetter.findUnique({ where: { id }, select: { id: true } });
    if (!cur) return NextResponse.json({ error: "That letter wasn't found. Go back to the letters list and open it again." }, { status: 404 });
    if (same && same.id !== id) {
      return NextResponse.json({ error: `A letter for ${clientName} for FY ${fyLabel(fy)} already exists. Open that letter instead.`, existingId: same.id }, { status: 409 });
    }
  } else if (same) {
    if (!body?.overwrite) {
      return NextResponse.json({ error: `A letter for ${clientName} for FY ${fyLabel(fy)} already exists. Open that letter instead.`, existingId: same.id }, { status: 409 });
    }
    id = same.id;
  }

  const json = data as Prisma.InputJsonValue;
  const letter = id
    ? await prisma.engagementLetter.update({ where: { id }, data: { clientName, fy, data: json, updatedByName: byName, ...RESTART } })
    : await prisma.engagementLetter.create({
        data: { clientName, fy, data: json, createdById: user.id, createdByName: byName, updatedByName: byName },
      });
  await prisma.engagementLetterEvent.create({ data: { letterId: letter.id, action: "saved", data: json, byId: user.id, byName } });
  const versions = await prisma.engagementLetterEvent.count({ where: { letterId: letter.id, action: "saved" } });
  return NextResponse.json({ id: letter.id, version: versions, clientName, fy });
}
