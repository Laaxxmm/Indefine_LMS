import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit/log";
import { isSopAdmin } from "@/lib/sop/access";

// Revoke a user's SOP editor rights (admins only). The grant row is a permission, not personal
// data, so it is removed; the revoke is audited.
export async function DELETE(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isSopAdmin(session.user)) return NextResponse.json({ error: "Only admins can give access to the SOP builder. Ask an admin." }, { status: 403 });

  const { userId } = await params;
  const removed = await prisma.sopEditor.deleteMany({ where: { userId } });
  if (removed.count) await logAudit(prisma, { actorId: session.user.id, action: "sop.editor-revoke", entity: "SopEditor", entityId: userId });
  return NextResponse.json({ ok: true });
}
