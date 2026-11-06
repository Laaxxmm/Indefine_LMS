import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSopAdmin } from "@/lib/sop/access";
import { validationMessage } from "@/lib/errors";

// Grant a user global SOP create/edit rights (admins only).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isSopAdmin(session.user)) return NextResponse.json({ error: "Only admins can give access to the SOP builder. Ask an admin." }, { status: 403 });

  const parsed = z.object({ userId: z.string().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, name: true, email: true, active: true } });
  if (!user || !user.active) return NextResponse.json({ error: "That person isn't an active member of staff. Pick someone from the list." }, { status: 400 });

  const editor = await prisma.sopEditor.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, userName: user.name ?? user.email, userEmail: user.email, grantedById: session.user.id },
    select: { userId: true, userName: true, userEmail: true },
  });
  return NextResponse.json({ editor }, { status: 201 });
}
