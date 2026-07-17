import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { generateDeadlines } from "@/lib/neo-centra/compliance";

const Body = z.object({
  fyStart: z.number().int(),
  key: z.string().min(1),
  status: z.enum(["PENDING", "DONE"]),
});

// Mark a compliance deadline done / reopen it. Directors only.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { fyStart, key, status } = parsed.data;

  // Guard: the key must belong to this FY's generated deadlines.
  if (!generateDeadlines(fyStart).some((d) => d.key === key)) {
    return NextResponse.json({ error: "Unknown deadline" }, { status: 404 });
  }

  const done = status === "DONE";
  await prisma.neoComplianceStatus.upsert({
    where: { fyStartYear_key: { fyStartYear: fyStart, key } },
    create: {
      fyStartYear: fyStart, key, status,
      completedAt: done ? new Date() : null,
      completedById: done ? session.user.id : null,
      completedByName: done ? session.user.name ?? "Unknown" : null,
    },
    update: {
      status,
      completedAt: done ? new Date() : null,
      completedById: done ? session.user.id : null,
      completedByName: done ? session.user.name ?? "Unknown" : null,
    },
  });

  return NextResponse.json({ ok: true, status });
}
