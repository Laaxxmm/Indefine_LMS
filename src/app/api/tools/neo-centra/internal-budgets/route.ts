import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseNeoCentra, isNeoCentraAdmin } from "@/lib/neo-centra/access";

// Bucket 4 board-approved hour budgets. Any director can view; admins edit.
export async function GET() {
  const session = await auth();
  if (!session?.user || !canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  const rows = await prisma.neoInternalBudget.findMany({ orderBy: { taskName: "asc" } });
  return NextResponse.json(rows);
}

const Body = z.object({
  taskName: z.string().min(1),
  approvedHours: z.number().positive(),
  taskIdentity: z.string().optional(),
  turiaTaskId: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !isNeoCentraAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  const row = await prisma.neoInternalBudget.create({ data: { ...parsed.data, approvedBy: session.user.name ?? null } });
  return NextResponse.json(row, { status: 201 });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user || !isNeoCentraAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.neoInternalBudget.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
