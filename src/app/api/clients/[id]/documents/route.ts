import { NextResponse } from "next/server";
import type { ClientDocType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients, DOC_TYPES, isKycDocType } from "@/lib/clients/core";
import { MAX_UPLOAD_BYTES, uploadClientDocument } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";

export const runtime = "nodejs";
export const maxDuration = 300;

// Upload one or more files as the same doc type. Per-file success/failure; nothing is
// recorded for a file that did not land on SharePoint.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });

  const { id: clientId } = await params;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Invalid upload" }, { status: 400 });

  const docType = String(form.get("docType") ?? "") as ClientDocType;
  if (!(docType in DOC_TYPES)) return NextResponse.json({ error: "Pick a document type" }, { status: 400 });
  const jobId = String(form.get("jobId") ?? "") || null;
  if (jobId && isKycDocType(docType)) return NextResponse.json({ error: "KYC document types go under the client, not a job" }, { status: 400 });
  if (!jobId && !isKycDocType(docType)) return NextResponse.json({ error: "Pick a job for this document type" }, { status: 400 });

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (jobId) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { clientId: true } });
    if (job?.clientId !== clientId) return NextResponse.json({ error: "Job not found on this client" }, { status: 404 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return NextResponse.json({ error: "Attach at least one file" }, { status: 400 });

  const uploaded: Array<{ id: string; name: string; webUrl: string }> = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) { failed.push({ name: file.name, error: "Over 50 MB" }); continue; }
    try {
      const doc = await uploadClientDocument({ clientId, jobId, docType, file, userId: session.user.id });
      uploaded.push({ id: doc.id, name: doc.name, webUrl: doc.webUrl });
    } catch (e) {
      failed.push({ name: file.name, error: (e as Error).message });
    }
  }
  if (uploaded.length) scheduleWorkbookRebuild();
  return NextResponse.json({ uploaded, failed }, { status: uploaded.length ? 200 : 502 });
}
