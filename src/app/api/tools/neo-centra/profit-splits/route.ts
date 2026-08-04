import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canUseNeoCentra, isNeoCentraAdmin } from "@/lib/neo-centra/access";

// Bucket 3 manual profit splits. Any director may view; admins edit. A split applies
// on the next Sync (it feeds the incentive compute, like Bucket 4 approved hours).
export async function GET() {
  const session = await auth();
  if (!session?.user || !canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  const rows = await prisma.neoProfitSplit.findMany({ orderBy: { taskName: "asc" } });
  return NextResponse.json(rows);
}

// taskName is display/ordering only — Turia returns a blank `taskname` for some tasks,
// and requiring it here blocked saving an otherwise valid split ("String must contain at
// least 1 character(s)"). Accept blank and fall back to the task id below.
const Body = z.object({
  taskName: z.string().optional(),
  taskIdentity: z.string().optional(),
  turiaTaskId: z.string().optional(),
  splits: z.record(z.string(), z.number().min(0).max(100)),
}).refine((b) => Object.keys(b.splits).length >= 2, { message: "Need at least two partners" })
  .refine((b) => { const sum = Object.values(b.splits).reduce((s, n) => s + n, 0); return sum >= 99 && sum <= 101; }, { message: "Percentages must add up to 100" })
  .refine((b) => b.turiaTaskId || b.taskIdentity, { message: "Task id required" });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user || !isNeoCentraAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  const { taskIdentity, turiaTaskId, splits } = parsed.data;
  const taskName = parsed.data.taskName?.trim() || taskIdentity || turiaTaskId || "Untitled task";

  // No unique key on the optional task ids — upsert by hand (match turiaTaskId first).
  const existing = await prisma.neoProfitSplit.findFirst({
    where: turiaTaskId ? { turiaTaskId } : { taskIdentity },
  });
  const data = { taskName, taskIdentity: taskIdentity ?? null, turiaTaskId: turiaTaskId ?? null, splits, updatedBy: session.user.name ?? null };
  const row = existing
    ? await prisma.neoProfitSplit.update({ where: { id: existing.id }, data })
    : await prisma.neoProfitSplit.create({ data });
  return NextResponse.json(row, { status: existing ? 200 : 201 });
}

// Reset a task to the equal-split default by removing its saved split.
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user || !isNeoCentraAdmin(session.user)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const url = new URL(req.url);
  const turiaTaskId = url.searchParams.get("turiaTaskId");
  const taskIdentity = url.searchParams.get("taskIdentity");
  if (!turiaTaskId && !taskIdentity) return NextResponse.json({ error: "Task id required" }, { status: 400 });
  await prisma.neoProfitSplit.deleteMany({ where: turiaTaskId ? { turiaTaskId } : { taskIdentity: taskIdentity! } });
  return NextResponse.json({ ok: true });
}
