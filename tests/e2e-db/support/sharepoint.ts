// SharePoint (Path A) setup for the DB-backed golden paths: fixture inputs into a job's ClientDocs
// and (close-loop negatives) a Final file at a chosen path. Real Graph through the app's own client
// and deliverable store, so the test process needs the same MS_* / SP_PNP_* variables as the app.
// Every write is create-only: an input already present with the same bytes is reused, one with
// different bytes fails loudly (the agent would read both); nothing is ever deleted or overwritten.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FirmService } from "@prisma/client";
import { createDeliverableStore, type StoredFile } from "@/lib/integrations/sharepoint/deliverable-store";
import { ConflictError } from "@/lib/integrations/sharepoint/errors";
import { defaultSharePointClient } from "@/lib/integrations/sharepoint/factory";
import { deliverablePath, type DeliverableKind, type Period } from "@/lib/integrations/sharepoint/paths";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let client: ReturnType<typeof defaultSharePointClient> | null = null;
const sp = () => (client ??= defaultSharePointClient());
const store = () => createDeliverableStore(sp());

export function folderOf(code: string, fy: string, service: FirmService, period: string, kind: DeliverableKind) {
  return deliverablePath(code, fy, service, period as Period, kind);
}

/** The synthetic input files of an accuracy fixture (fixtures/accuracy/<agent>/<fixture>/input). */
export function fixtureFiles(agent: string, fixture: string): { name: string; bytes: Buffer }[] {
  const dir = join(process.cwd(), "fixtures", "accuracy", agent, fixture, "input");
  return readdirSync(dir).map((name) => ({ name, bytes: readFileSync(join(dir, name)) }));
}

/** Put `files` into the job's ClientDocs folder under their own names (create-only, idempotent). */
export async function uploadToClientDocs(job: { clientCode: string; fy: string; service: FirmService; period: string }, files: { name: string; bytes: Buffer }[]) {
  const s = store();
  const driveId = await s.complianceDrive(job.clientCode);
  const folder = folderOf(job.clientCode, job.fy, job.service, job.period, "ClientDocs").path;
  for (const f of files) {
    try {
      await sp().uploadFile(driveId, `${folder}/${f.name}`, f.bytes, { conflict: "fail" });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      const existing = await s.read(driveId, folder, f.name);
      if (!existing || sha(existing) !== sha(f.bytes)) {
        throw new Error(`${folder}/${f.name} already exists with different content; the agent would read the wrong input. Use a fresh period or client for e2e.`);
      }
    }
  }
  return { driveId, folder };
}

/** A Final file (create-only, versioned) at the job's Final folder or any `kindFolder` override. */
export async function putFinalFile(job: { clientCode: string; fy: string; service: FirmService; period: string }, name: string, bytes: Buffer, opts: { period?: string } = {}): Promise<StoredFile & { spPath: string }> {
  const s = store();
  const driveId = await s.complianceDrive(job.clientCode);
  const f = folderOf(job.clientCode, job.fy, job.service, opts.period ?? job.period, "Final");
  const stored = await s.putNew(driveId, f.path, name, bytes);
  return { ...stored, spPath: f.serverRelativeUrl };
}
