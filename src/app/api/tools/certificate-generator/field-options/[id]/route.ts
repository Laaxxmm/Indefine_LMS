import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseCertificateTool } from "@/lib/certificates/access";

// Remove a saved value (shared firm-wide — any internal user may prune the list).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canUseCertificateTool(session.user)) return NextResponse.json({ error: "You don't have access to the certificate generator. Ask an admin to give you access." }, { status: 403 });

  const { id } = await params;
  await prisma.certificateFieldOption.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
