// SharePoint side of client onboarding. Best-effort everywhere: the DB row is saved
// first, and a Graph failure leaves folderStatus = PENDING/FAILED for retry (client
// page banner, nightly cron). Never deletes anything on SharePoint.
import type { ClientDocType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { departmentLabel } from "@/lib/ca-firm";
import {
  ensureFolder, getAppOnlyToken, getUserGraphToken, moveDriveItem, resolveFolderId, uploadFileToFolderId,
} from "@/lib/graph";
import { DOC_TYPES, safeName } from "./core";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const driveId = () => process.env.GRAPH_DRIVE_ID ?? "";
// Single path segment directly under the drive root (ensureFolder creates one level).
export const clientsRoot = () => (process.env.GRAPH_CLIENTS_ROOT || "Clients").replace(/^\/+|\/+$/g, "");

async function graphToken(userId?: string): Promise<string | null> {
  return (await getAppOnlyToken()) ?? (userId ? await getUserGraphToken(userId) : null);
}

// Single DB read for both ids. Warm path (graphFolderId already set) skips all Graph
// calls unless withKyc is asked for — the KYC id itself is never stored on the client
// row, so callers that only need the client folder id must not pay for (or fail on) it.
async function ensureClientTree(
  clientId: string, userId?: string, withKyc = false
): Promise<{ clientFolderId: string; kycFolderId: string | null } | null> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { folderName: true, graphFolderId: true } });
  if (!client) return null;
  if (client.graphFolderId) {
    if (!withKyc) return { clientFolderId: client.graphFolderId, kycFolderId: null };
    const [d, t] = [driveId(), await graphToken(userId)];
    if (!d || !t) return { clientFolderId: client.graphFolderId, kycFolderId: null };
    const clientPath = `${clientsRoot()}/${client.folderName}`;
    const kycId = await ensureFolder(d, clientPath, "KYC", t).catch((e) => {
      console.error(`KYC folder ${clientPath}/KYC failed:`, (e as Error).message);
      return null;
    });
    return { clientFolderId: client.graphFolderId, kycFolderId: kycId };
  }
  const [d, t] = [driveId(), await graphToken(userId)];
  if (!d || !t) return null;
  try {
    await ensureFolder(d, "", clientsRoot(), t);
    const clientFolderId = await ensureFolder(d, clientsRoot(), client.folderName, t);
    const kycId = await ensureFolder(d, `${clientsRoot()}/${client.folderName}`, "KYC", t);
    await prisma.client.update({ where: { id: clientId }, data: { graphFolderId: clientFolderId, folderStatus: "READY" } });
    return { clientFolderId, kycFolderId: kycId };
  } catch (e) {
    console.error(`client folder ${client.folderName} failed:`, (e as Error).message);
    await prisma.client.update({ where: { id: clientId }, data: { folderStatus: "FAILED" } }).catch(() => {});
    return null;
  }
}

/** Ensures <root>/<client>/KYC exists; stores the client folder id. Returns null on failure. */
export async function ensureClientFolder(clientId: string, userId?: string): Promise<string | null> {
  return (await ensureClientTree(clientId, userId))?.clientFolderId ?? null;
}

async function kycFolderId(clientId: string, userId?: string): Promise<string | null> {
  return (await ensureClientTree(clientId, userId, true))?.kycFolderId ?? null;
}

/** Ensures <root>/<client>/<FY>/<Department>/<Service>; stores the job folder id. */
export async function ensureJobFolder(jobId: string, userId?: string): Promise<string | null> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { client: { select: { id: true, folderName: true } }, serviceType: true },
  });
  if (!job) return null;
  if (job.graphFolderId) return job.graphFolderId;
  if (!(await ensureClientFolder(job.client.id, userId))) return null;
  const [d, t] = [driveId(), await graphToken(userId)];
  if (!d || !t) return null;
  const base = `${clientsRoot()}/${job.client.folderName}`;
  const dept = safeName(departmentLabel(job.serviceType.department)); // "Admin / Ops" → "Admin - Ops"
  const svc = safeName(job.serviceType.name);
  try {
    await ensureFolder(d, base, job.fy, t);
    await ensureFolder(d, `${base}/${job.fy}`, dept, t);
    const id = await ensureFolder(d, `${base}/${job.fy}/${dept}`, svc, t);
    await prisma.job.update({ where: { id: jobId }, data: { graphFolderId: id, folderStatus: "READY" } });
    return id;
  } catch (e) {
    console.error(`job folder ${base}/${job.fy}/${dept}/${svc} failed:`, (e as Error).message);
    await prisma.job.update({ where: { id: jobId }, data: { folderStatus: "FAILED" } }).catch(() => {});
    return null;
  }
}

/** Uploads one file and records it. Throws with a user-facing message on failure. */
export async function uploadClientDocument(opts: {
  clientId: string;
  jobId: string | null;
  docType: ClientDocType;
  file: File;
  userId: string;
}) {
  if (opts.file.size > MAX_UPLOAD_BYTES) throw new Error(`${opts.file.name} is over 50 MB`);
  const folderId = opts.jobId ? await ensureJobFolder(opts.jobId, opts.userId) : await kycFolderId(opts.clientId, opts.userId);
  if (!folderId) throw new Error("SharePoint folder unavailable — check Graph configuration and retry");
  const [d, t] = [driveId(), await graphToken(opts.userId)];
  if (!d || !t) throw new Error("No Graph token");
  const name = safeName(`${DOC_TYPES[opts.docType]} - ${opts.file.name}`);
  const item = await uploadFileToFolderId(d, folderId, name, await opts.file.arrayBuffer(), t);
  if (!item) throw new Error(`Upload of ${opts.file.name} failed`);
  return prisma.clientDocument.create({
    data: {
      clientId: opts.clientId,
      jobId: opts.jobId,
      docType: opts.docType,
      name,
      graphDriveId: d,
      graphItemId: item.id,
      webUrl: item.webUrl,
      sizeBytes: item.size,
      uploadedById: opts.userId,
    },
  });
}

/** Renames the client folder on SharePoint. True when nothing to move or moved OK. */
export async function renameClientFolder(clientId: string, newFolderName: string, userId?: string): Promise<boolean> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { graphFolderId: true } });
  if (!client?.graphFolderId) return true; // nothing on SharePoint yet
  const [d, t] = [driveId(), await graphToken(userId)];
  if (!d || !t) return false;
  const parent = await resolveFolderId(d, clientsRoot(), t);
  if (!parent) return false;
  return moveDriveItem(d, client.graphFolderId, parent, t, newFolderName);
}

export async function retryPendingFolders(): Promise<{ clients: number; jobs: number }> {
  let clients = 0;
  for (const c of await prisma.client.findMany({ where: { graphFolderId: null }, select: { id: true } }))
    if (await ensureClientFolder(c.id)) clients++;
  let jobs = 0;
  for (const j of await prisma.job.findMany({ where: { graphFolderId: null }, select: { id: true } }))
    if (await ensureJobFolder(j.id)) jobs++;
  return { clients, jobs };
}
