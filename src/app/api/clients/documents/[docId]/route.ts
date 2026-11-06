import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageClients } from "@/lib/clients/core";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

// Unlink a document record. The file stays on SharePoint (never deleted from here).
export async function DELETE(_req: Request, { params }: { params: Promise<{ docId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canManageClients(session.user)) return NextResponse.json({ error: "Only admins and partners can do this. Ask one of them." }, { status: 403 });
  const { docId } = await params;
  const r = await prisma.clientDocument.deleteMany({ where: { id: docId } });
  if (r.count === 0) return NextResponse.json({ error: "That document wasn't found. Reload the client page." }, { status: 404 });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}
