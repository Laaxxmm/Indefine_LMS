import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canEditClientJob, canManageClients, canViewClients, jobPatchZ } from "@/lib/clients/core";
import { JOB_PII, auditEdit, maskedChanges } from "@/lib/clients/audit";
import { logAudit } from "@/lib/audit/log";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";
import { validationMessage } from "@/lib/errors";
import { readJsonCapped } from "@/lib/hardening/json-body";

// Inline edits (handler / status / due / fees / notes): management, the client's primary handler
// or the job's own handler (canEditClientJob). Each change is an AuditEvent with masked
// before / after (src/lib/clients/audit.ts).
export async function PATCH(req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "Your account is not active. Ask an admin to reactivate it." }, { status: 403 });

  const { jobId } = await params;
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { id: true, handlerId: true, status: true, dueOn: true, fees: true, notes: true, client: { select: { primaryHandlerId: true } } },
  });
  if (!job) return NextResponse.json({ error: "That job wasn't found. Reload the client page." }, { status: 404 });
  if (!canEditClientJob(session.user, job)) {
    return NextResponse.json({ error: "Only the client's handler, the job's handler, an admin or a partner can change this job. Ask one of them." }, { status: 403 });
  }
  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const parsed = jobPatchZ.safeParse(jsonBody.value);
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error, "Some details are missing or in the wrong format. Check them and try again.") }, { status: 400 });
  if (parsed.data.handlerId) {
    const h = await prisma.user.findUnique({ where: { id: parsed.data.handlerId }, select: { active: true } });
    if (!h?.active) return NextResponse.json({ error: "That handler isn't an active user. Pick someone from the list." }, { status: 400 });
  }
  const changes = maskedChanges(job, parsed.data, JOB_PII);
  const updated = await prisma.job.updateMany({ where: { id: jobId }, data: parsed.data });
  if (updated.count === 0) return NextResponse.json({ error: "That job wasn't found. Reload the client page." }, { status: 404 });
  await auditEdit(prisma, { actorId: session.user.id, action: "update", entity: "Job", entityId: jobId, changes });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}

// Remove a job record. Admins and partners only; refused while documents are attached
// (SharePoint files are never deleted, so the DB rows must not silently vanish either).
export async function DELETE(_req: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canManageClients(session.user)) return NextResponse.json({ error: "Only admins and partners can do this. Ask one of them." }, { status: 403 });

  const { jobId } = await params;
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { _count: { select: { documents: true } } } });
  if (!job) return NextResponse.json({ error: "That job wasn't found. Reload the client page." }, { status: 404 });
  if (job._count.documents > 0) return NextResponse.json({ error: "This job still has documents, so it can't be removed. Remove its documents first." }, { status: 409 });
  await prisma.job.delete({ where: { id: jobId } });
  await logAudit(prisma, { actorId: session.user.id, action: "delete", entity: "Job", entityId: jobId });
  scheduleWorkbookRebuild();
  return NextResponse.json({ ok: true });
}
