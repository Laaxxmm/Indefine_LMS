import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEPARTMENTS } from "@/lib/ca-firm";
import { isClientsAdmin } from "@/lib/clients/core";

const bodyZ = z.object({
  department: z.enum(DEPARTMENTS.filter((d) => d !== "GENERAL") as [typeof DEPARTMENTS[number], ...typeof DEPARTMENTS]),
  name: z.string().trim().min(2).max(80),
});

// Add a service under a department. Admins only.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isClientsAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const parsed = bodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const max = await prisma.serviceType.aggregate({ where: { department: parsed.data.department }, _max: { order: true } });
  try {
    const s = await prisma.serviceType.create({ data: { ...parsed.data, order: (max._max.order ?? -1) + 1 }, select: { id: true } });
    return NextResponse.json({ id: s.id }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return NextResponse.json({ error: "That service already exists under this department" }, { status: 409 });
    throw e;
  }
}
