import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients, createClientBodyZ, folderName, turnoverBand } from "@/lib/clients/core";
import { ensureJobFolder } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

export const maxDuration = 60;

// Onboard a client together with its first job. Any active user.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });

  const parsed = createClientBodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const { client, job } = parsed.data;

  const fname = folderName(client.name);
  if (!/[A-Za-z0-9]/.test(fname)) return NextResponse.json({ error: "Client name needs at least one letter or digit" }, { status: 400 });

  const dup = await prisma.client.findFirst({
    where: { OR: [{ name: { equals: client.name, mode: "insensitive" } }, { folderName: fname }, ...(client.pan ? [{ pan: client.pan }] : [])] },
    select: { id: true, name: true },
  });
  if (dup) return NextResponse.json({ error: `Client already exists: ${dup.name}`, existingId: dup.id }, { status: 409 });

  const handlerIds = [...new Set([client.primaryHandlerId, job.handlerId])];
  const [service, handlers] = await Promise.all([
    prisma.serviceType.findUnique({ where: { id: job.serviceTypeId } }),
    prisma.user.findMany({ where: { id: { in: handlerIds }, active: true }, select: { id: true } }),
  ]);
  if (!service?.active) return NextResponse.json({ error: "Unknown service" }, { status: 400 });
  if (handlers.length !== handlerIds.length) return NextResponse.json({ error: "Unknown handler" }, { status: 400 });

  let created;
  try {
    created = await prisma.client.create({
      data: {
        ...client,
        folderName: fname,
        turnoverBand: turnoverBand(client.turnover),
        createdById: session.user.id,
        jobs: { create: { ...job, createdById: session.user.id } },
      },
      include: { jobs: { select: { id: true } } },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return NextResponse.json({ error: "Client already exists" }, { status: 409 });
    throw e;
  }

  const jobId = created.jobs[0].id;
  const folderId = await ensureJobFolder(jobId, session.user.id); // also creates the client + KYC folders
  scheduleWorkbookRebuild();
  return NextResponse.json({ id: created.id, jobId, folderStatus: folderId ? "READY" : "PENDING" }, { status: 201 });
}
