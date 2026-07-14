import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSopAdmin } from "@/lib/sop/access";

// Revoke a user's SOP editor rights (admins only).
export async function DELETE(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSopAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const { userId } = await params;
  await prisma.sopEditor.delete({ where: { userId } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
