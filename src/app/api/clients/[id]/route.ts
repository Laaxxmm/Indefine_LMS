import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageClients, clientBodyZ, folderName, turnoverBand } from "@/lib/clients/core";
import { renameClientFolder } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";
import { CLIENT_PII, auditEdit, maskedChanges } from "@/lib/clients/audit";
import { validationMessage } from "@/lib/errors";
import { readJsonCapped } from "@/lib/hardening/json-body";

export const maxDuration = 60;

const patchZ = clientBodyZ.partial().extend({ active: z.boolean().optional() });

// Edit client details. Admins and partners only (canManageClients); every edit is an AuditEvent
// with masked before / after (src/lib/clients/audit.ts).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canManageClients(session.user)) return NextResponse.json({ error: "Only admins and partners can do this. Ask one of them." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "That client wasn't found. Go back to the client list and open it again." }, { status: 404 });

  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const parsed = patchZ.safeParse(jsonBody.value);
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
  const body = parsed.data;

  if (body.primaryHandlerId) {
    const handler = await prisma.user.findUnique({ where: { id: body.primaryHandlerId }, select: { active: true } });
    if (!handler?.active) return NextResponse.json({ error: "That handler isn't an active user. Pick someone from the list." }, { status: 400 });
  }

  const data: Prisma.ClientUncheckedUpdateInput = { ...body };
  if (body.turnover !== undefined) data.turnoverBand = turnoverBand(body.turnover);

  if (body.name && body.name !== existing.name) {
    const fname = folderName(body.name);
    if (!/[A-Za-z0-9]/.test(fname)) return NextResponse.json({ error: "The client name needs at least one letter or digit." }, { status: 400 });
    if (fname.toLowerCase() === "_database") return NextResponse.json({ error: "That name can't be used for a client. Pick another name." }, { status: 400 });
    const dup = await prisma.client.findFirst({
      where: { id: { not: id }, OR: [{ name: { equals: body.name, mode: "insensitive" } }, { folderName: { equals: fname, mode: "insensitive" } }] },
      select: { name: true },
    });
    if (dup) return NextResponse.json({ error: `Another client is already called ${dup.name}. Pick a different name.` }, { status: 409 });
    if (fname !== existing.folderName) {
      if (!(await renameClientFolder(id, fname, session.user.id)))
        return NextResponse.json({ error: "The client's SharePoint folder could not be renamed, so nothing was changed. Try again in a minute." }, { status: 502 });
      data.folderName = fname;
    }
  }
  if (body.pan && body.pan !== existing.pan) {
    const dup = await prisma.client.findFirst({ where: { id: { not: id }, pan: body.pan }, select: { name: true } });
    if (dup) return NextResponse.json({ error: `That PAN already belongs to ${dup.name}. Check the PAN and try again.` }, { status: 409 });
  }

  const changes = maskedChanges(existing as unknown as Record<string, unknown>, data as Record<string, unknown>, CLIENT_PII);
  try {
    await prisma.client.update({ where: { id }, data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return NextResponse.json({ error: "Another client already has that name or PAN. Check them and try again." }, { status: 409 });
    throw e;
  }
  // Who changed which fields, before / after masked (identifiers last 4, names initials, notes fingerprinted).
  await auditEdit(prisma, { actorId: session.user.id, action: "update", entity: "Client", entityId: id, changes });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}
