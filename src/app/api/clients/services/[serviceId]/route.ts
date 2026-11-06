import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isClientsAdmin } from "@/lib/clients/core";
import { validationMessage } from "@/lib/errors";
import { readJsonCapped } from "@/lib/hardening/json-body";

const patchZ = z.object({ active: z.boolean().optional() });

// (De)activate a service. Admins only. Never renamed or deleted — jobs reference it.
export async function PATCH(req: Request, { params }: { params: Promise<{ serviceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isClientsAdmin(session.user)) return NextResponse.json({ error: "Only admins can change the service list. Ask an admin." }, { status: 403 });
  const { serviceId } = await params;
  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const parsed = patchZ.safeParse(jsonBody.value);
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
  const r = await prisma.serviceType.updateMany({ where: { id: serviceId }, data: parsed.data });
  if (r.count === 0) return NextResponse.json({ error: "That service wasn't found. Reload the page." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
