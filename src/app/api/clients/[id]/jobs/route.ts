import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients, jobBodyZ } from "@/lib/clients/core";
import { ensureJobFolder } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";
import { validationMessage } from "@/lib/errors";
import { readJsonCapped } from "@/lib/hardening/json-body";

export const maxDuration = 60;

// Add a job (service × FY) to an existing client. Any active user.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "Your account is not active. Ask an admin to reactivate it." }, { status: 403 });

  const { id: clientId } = await params;
  if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } })))
    return NextResponse.json({ error: "That client wasn't found. Go back to the client list and open it again." }, { status: 404 });

  const jsonBody = await readJsonCapped(req); // re-audit NEW-6: capped as it streams in
  if (!jsonBody.ok) return jsonBody.res;
  const parsed = jobBodyZ.safeParse(jsonBody.value);
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
  const job = parsed.data;

  const [service, handler] = await Promise.all([
    prisma.serviceType.findUnique({ where: { id: job.serviceTypeId } }),
    prisma.user.findUnique({ where: { id: job.handlerId }, select: { active: true } }),
  ]);
  if (!service?.active) return NextResponse.json({ error: "That service isn't offered any more. Reload the page and pick another." }, { status: 400 });
  if (!handler?.active) return NextResponse.json({ error: "That handler isn't an active user. Pick someone from the list." }, { status: 400 });

  let created;
  try {
    created = await prisma.job.create({ data: { ...job, clientId, createdById: session.user.id }, select: { id: true } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return NextResponse.json({ error: `${service.name} for ${job.fy} already exists on this client. Open the existing job instead.` }, { status: 409 });
    throw e;
  }
  const folderId = await ensureJobFolder(created.id, session.user.id);
  scheduleWorkbookRebuild();
  return NextResponse.json({ id: created.id, folderStatus: folderId ? "READY" : "PENDING" }, { status: 201 });
}
