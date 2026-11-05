import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEPARTMENTS } from "@/lib/ca-firm";
import { isClientsAdmin } from "@/lib/clients/core";
import { validationMessage } from "@/lib/errors";

const bodyZ = z.object({
  department: z.enum(DEPARTMENTS.filter((d) => d !== "GENERAL") as [typeof DEPARTMENTS[number], ...typeof DEPARTMENTS]),
  name: z.string().trim().min(2).max(80),
});

// Add a service under a department. Admins only.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!isClientsAdmin(session.user)) return NextResponse.json({ error: "Only admins can change the service list. Ask an admin." }, { status: 403 });
  const parsed = bodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
  const max = await prisma.serviceType.aggregate({ where: { department: parsed.data.department }, _max: { order: true } });
  try {
    const s = await prisma.serviceType.create({ data: { ...parsed.data, order: (max._max.order ?? -1) + 1 }, select: { id: true } });
    return NextResponse.json({ id: s.id }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return NextResponse.json({ error: "That service already exists under this department. Use the existing one." }, { status: 409 });
    throw e;
  }
}
