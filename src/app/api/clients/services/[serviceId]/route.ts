import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isClientsAdmin } from "@/lib/clients/core";

const patchZ = z.object({ active: z.boolean().optional() });

// (De)activate a service. Admins only. Never renamed or deleted — jobs reference it.
export async function PATCH(req: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isClientsAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const { serviceId } = await params;
  const parsed = patchZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const r = await prisma.serviceType.updateMany({ where: { id: serviceId }, data: parsed.data });
  if (r.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
