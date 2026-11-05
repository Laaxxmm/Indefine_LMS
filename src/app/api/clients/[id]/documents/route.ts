import { NextResponse } from "next/server";
import type { ClientDocType } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canViewClients, DOC_TYPES, isKycDocType } from "@/lib/clients/core";
import { MAX_UPLOAD_BYTES, uploadClientDocument } from "@/lib/clients/storage";
import { scheduleWorkbookRebuild } from "@/lib/clients/workbook";
import { DOCUMENT_TYPES, readMultipartUpload } from "@/lib/hardening/uploads";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Files in one upload, and the whole request (each file ≤ MAX_UPLOAD_BYTES). */
const MAX_FILES = 20;
const MAX_REQUEST_BYTES = 120 * 1024 * 1024;

// Upload one or more files as the same doc type. Per-file success/failure; nothing is
// recorded for a file that did not land on SharePoint. The body is capped before it is read and
// every file is screened (src/lib/hardening/uploads.ts): office documents and scanned images only
// (PDF, Word, Excel, CSV, JSON, JPG, PNG), content checked against the name, 50 MB each.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Sign in to upload documents." }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "Your account is not active, so you can't upload documents. Ask an admin to reactivate it." }, { status: 403 });

  const { id: clientId } = await params;
  const read = await readMultipartUpload(req, { fields: ["files"], types: DOCUMENT_TYPES, maxBytes: MAX_UPLOAD_BYTES, maxFiles: MAX_FILES, maxTotalBytes: MAX_REQUEST_BYTES, source: "client-document" });
  if (!read.ok) return read.res;
  const form = read.form;

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

  if (read.files.length === 0 && read.rejected.length === 0) return NextResponse.json({ error: "Attach at least one file" }, { status: 400 });

  const uploaded: Array<{ id: string; name: string; webUrl: string }> = [];
  const failed: Array<{ name: string; error: string }> = read.rejected.map((r) => ({ name: r.name, error: r.reason }));
  for (const f of read.files) {
    try {
      const file = new File([f.bytes.slice()], f.name, { type: f.type });
      const doc = await uploadClientDocument({ clientId, jobId, docType, file, userId: session.user.id });
      uploaded.push({ id: doc.id, name: doc.name, webUrl: doc.webUrl });
    } catch (e) {
      failed.push({ name: f.name, error: (e as Error).message });
    }
  }
  if (uploaded.length) scheduleWorkbookRebuild();
  const status = uploaded.length ? 200 : read.rejected.length && read.rejected.length === failed.length ? Math.max(...read.rejected.map((r) => r.status)) : 502;
  return NextResponse.json({ uploaded, failed }, { status });
}
