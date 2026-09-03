import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients, jobBodyZ } from "@/lib/clients/core";
import { ensureJobFolder } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

export const maxDuration = 60;

// Add a job (service × FY) to an existing client. Any active user.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });

  const { id: clientId } = await params;
  if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })))
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const parsed = jobBodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const job = parsed.data;

  const [service, handler] = await Promise.all([
    prisma.serviceType.findUnique({ where: { id: job.serviceTypeId } }),
    prisma.user.findUnique({ where: { id: job.handlerId }, select: { active: true } }),
  ]);
  if (!service?.active) return NextResponse.json({ error: "Unknown service" }, { status: 400 });
  if (!handler?.active) return NextResponse.json({ error: "Unknown handler" }, { status: 400 });

  let created;
  try {
    created = await prisma.job.create({ data: { ...job, clientId, createdById: session.user.id }, select: { id: true } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return NextResponse.json({ error: `${service.name} for ${job.fy} already exists on this client` }, { status: 409 });
    throw e;
  }
  const folderId = await ensureJobFolder(created.id, session.user.id);
  scheduleWorkbookRebuild();
  return NextResponse.json({ id: created.id, folderStatus: folderId ? "READY" : "PENDING" }, { status: 201 });
}
