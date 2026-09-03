import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageClients, clientBodyZ, folderName, turnoverBand } from "@/lib/clients/core";
import { renameClientFolder } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

const patchZ = clientBodyZ.partial().extend({ active: z.boolean().optional() });

// Edit client details. Admins and partners only.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageClients(session.user)) return NextResponse.json({ error: "Admins and partners only" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.client.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = patchZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const body = parsed.data;

  const data: Prisma.ClientUncheckedUpdateInput = { ...body };
  if (body.turnover !== undefined) data.turnoverBand = turnoverBand(body.turnover);

  if (body.name && body.name !== existing.name) {
    const fname = folderName(body.name);
    if (!/[A-Za-z0-9]/.test(fname)) return NextResponse.json({ error: "Client name needs at least one letter or digit" }, { status: 400 });
    const dup = await prisma.client.findFirst({
      where: { id: { not: id }, OR: [{ name: { equals: body.name, mode: "insensitive" } }, { folderName: fname }] },
      select: { name: true },
    });
    if (dup) return NextResponse.json({ error: `Another client is already called ${dup.name}` }, { status: 409 });
    if (fname !== existing.folderName) {
      if (!(await renameClientFolder(id, fname, session.user.id)))
        return NextResponse.json({ error: "Could not rename the SharePoint folder — try again" }, { status: 502 });
      data.folderName = fname;
    }
  }
  if (body.pan && body.pan !== existing.pan) {
    const dup = await prisma.client.findFirst({ where: { id: { not: id }, pan: body.pan }, select: { name: true } });
    if (dup) return NextResponse.json({ error: `PAN already belongs to ${dup.name}` }, { status: 409 });
  }

  await prisma.client.update({ where: { id }, data });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}
