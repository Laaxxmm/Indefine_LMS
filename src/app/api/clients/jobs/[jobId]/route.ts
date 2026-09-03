import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageClients, canViewClients, jobPatchZ } from "@/lib/clients/core";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

// Inline edits (handler / status / due / fees / notes). Any active user.
export async function PATCH(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });

  const { jobId } = await params;
  const parsed = jobPatchZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  if (parsed.data.handlerId) {
    const h = await prisma.user.findUnique({ where: { id: parsed.data.handlerId }, select: { active: true } });
    if (!h?.active) return NextResponse.json({ error: "Unknown handler" }, { status: 400 });
  }
  const updated = await prisma.job.updateMany({ where: { id: jobId }, data: parsed.data });
  if (updated.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}

// Remove a job record. Admins and partners only; refused while documents are attached
// (SharePoint files are never deleted, so the DB rows must not silently vanish either).
export async function DELETE(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageClients(session.user)) return NextResponse.json({ error: "Admins and partners only" }, { status: 403 });

  const { jobId } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { _count: { select: { documents: true } } } });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (job._count.documents > 0) return NextResponse.json({ error: "Remove the job's documents first" }, { status: 409 });
  await prisma.job.delete({ where: { id: jobId } });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}
