import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients, createClientBodyZ } from "@/lib/clients/core";
import { ClientExistsError, ClientNameError, clientFolderName, createClientRecord, findDuplicateClient } from "@/lib/clients/service";
import { ensureJobFolder } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";
import { validationMessage } from "@/lib/errors";

export const maxDuration = 60;

// Onboard a client together with its first job. Any active user.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "Your account is not active. Ask an admin to reactivate it." }, { status: 403 });

  const parsed = createClientBodyZ.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: validationMessage(parsed.error) }, { status: 400 });
  const { client, job } = parsed.data;

  try {
    clientFolderName(client.name);
  } catch (e) {
    if (e instanceof ClientNameError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  const dup = await findDuplicateClient(prisma, { name: client.name, pan: client.pan });
  if (dup) return NextResponse.json({ error: `A client called ${dup.name} already exists. Open that client instead of adding it again.`, existingId: dup.id }, { status: 409 });

  const handlerIds = [...new Set([client.primaryHandlerId, job.handlerId])];
  const [service, handlers] = await Promise.all([
    prisma.serviceType.findUnique({ where: { id: job.serviceTypeId } }),
    prisma.user.findMany({ where: { id: { in: handlerIds }, active: true }, select: { id: true } }),
  ]);
  if (!service?.active) return NextResponse.json({ error: "That service isn't offered any more. Reload the page and pick another." }, { status: 400 });
  if (handlers.length !== handlerIds.length) return NextResponse.json({ error: "That handler isn't an active user. Pick someone from the list." }, { status: 400 });

  let created;
  try {
    created = await createClientRecord(prisma, { client, job, createdById: session.user.id });
  } catch (e) {
    if (e instanceof ClientExistsError) {
      return NextResponse.json(e.existingId ? { error: e.message, existingId: e.existingId } : { error: e.message }, { status: 409 });
    }
    throw e;
  }

  const jobId = created.jobId as string;
  const folderId = await ensureJobFolder(jobId, session.user.id); // also creates the client + KYC folders
  scheduleWorkbookRebuild();
  return NextResponse.json({ id: created.id, jobId, folderStatus: folderId ? "READY" : "PENDING" }, { status: 201 });
}
