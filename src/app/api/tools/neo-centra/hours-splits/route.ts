import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseNeoCentra, isNeoCentraAdmin } from "@/lib/neo-centra/access";

// Bucket 4 planned-hours allocations. Any director may view; admins edit. Applied on
// the next Sync (it feeds the incentive compute, like the Bucket 3 profit split).
export async function GET() {
  const session = await auth();
  if (!session?.user || !canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  const rows = await prisma.neoHoursSplit.findMany({ orderBy: { taskName: "asc" } });
  return NextResponse.json(rows);
}

// Hours are entered freely per partner — deliberately NOT required to add up to Turia's
// Budget Time, so a partial allocation (only one partner targeted) is valid.
// taskName is display/ordering only — Turia returns a blank `taskname` for some tasks, so
// requiring it would block an otherwise valid allocation. Blank falls back to the task id.
const Body = z.object({
  taskName: z.string().optional(),
  taskIdentity: z.string().optional(),
  turiaTaskId: z.string().optional(),
  hours: z.record(z.string(), z.number().min(0).max(10000)),
}).refine((b) => Object.keys(b.hours).length >= 1, { message: "Set hours for at least one partner" })
  .refine((b) => b.turiaTaskId || b.taskIdentity, { message: "Task id required" });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !isNeoCentraAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  const { taskIdentity, turiaTaskId, hours } = parsed.data;
  const taskName = parsed.data.taskName?.trim() || taskIdentity || turiaTaskId || "Untitled task";

  // No unique key on the optional task ids — upsert by hand (match turiaTaskId first).
  const existing = await prisma.neoHoursSplit.findFirst({
    where: turiaTaskId ? { turiaTaskId } : { taskIdentity },
  });
  const data = { taskName, taskIdentity: taskIdentity ?? null, turiaTaskId: turiaTaskId ?? null, hours, updatedBy: session.user.name ?? null };
  const row = existing
    ? await prisma.neoHoursSplit.update({ where: { id: existing.id }, data })
    : await prisma.neoHoursSplit.create({ data });
  return NextResponse.json(row, { status: existing ? 200 : 201 });
}

// Clear a task's allocation (partners fall back to having no target).
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user || !isNeoCentraAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const url = new URL(req.url);
  const turiaTaskId = url.searchParams.get("turiaTaskId");
  const taskIdentity = url.searchParams.get("taskIdentity");
  if (!turiaTaskId && !taskIdentity) return NextResponse.json({ error: "Task id required" }, { status: 400 });
  await prisma.neoHoursSplit.deleteMany({ where: turiaTaskId ? { turiaTaskId } : { taskIdentity: taskIdentity! } });
  return NextResponse.json({ ok: true });
}
