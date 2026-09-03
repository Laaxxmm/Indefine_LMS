import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients } from "@/lib/clients/core";
import { ensureClientFolder, ensureJobFolder } from "@/lib/clients/storage";

export const maxDuration = 60;

// "Retry" on the SharePoint banner: create whatever folders are still missing.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });
  const { id } = await params;
  await ensureClientFolder(id, session.user.id);
  const jobs = await prisma.job.findMany({ where: { clientId: id, graphFolderId: null }, select: { id: true } });
  let pending = 0;
  for (const j of jobs) if (!(await ensureJobFolder(j.id, session.user.id))) pending++;
  const client = await prisma.client.findUnique({ where: { id }, select: { folderStatus: true } });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ client: client.folderStatus, jobsPending: pending });
}
