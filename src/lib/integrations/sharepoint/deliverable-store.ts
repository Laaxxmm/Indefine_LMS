// Deliverable file store on Path A (Phase 4): agent drafts go to {Period}/Working, approved packs
// are copied to {Period}/Final. Every write is create-only (conflict "fail"); when a name is taken
// the `_v{n}` suffix is bumped, so a Final file is never replaced, only joined by a higher version.
// Paths come from paths.ts (deliverablePath); this module never assembles a Path A URL itself.
import { createHash } from "node:crypto";
import { ConflictError, NotProvisionedError } from "./errors";
import type { GraphItem, SharePointClient } from "./graph-client";
import { COMPLIANCE_LIBRARY, DEFAULT_TENANT_HOST, clSiteUrl } from "./paths";

/** How many higher versions an upload tries before giving up (race or a crowded folder). */
export const MAX_VERSION_ATTEMPTS = 50;

const VERSION_RE = /_v(\d+)(\.[A-Za-z0-9]+)$/;

/** `ACME_Pack_2026-10_v1.xlsx` → 1; a name without a suffix → null. */
export function versionOf(fileName: string): number | null {
  const m = VERSION_RE.exec(fileName);
  return m ? Number(m[1]) : null;
}

/** Same file name with the `_v{n}` suffix set to `version` (added before the extension when absent). */
export function withVersion(fileName: string, version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error(`version must be a positive integer, got ${version}`);
  if (VERSION_RE.test(fileName)) return fileName.replace(VERSION_RE, `_v${version}$2`);
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? `${fileName.slice(0, dot)}_v${version}${fileName.slice(dot)}` : `${fileName}_v${version}`;
}

/** Lowest version ≥ `from` whose name is not in `taken` (case-insensitive, as SharePoint is). */
export function nextFreeVersion(fileName: string, taken: Iterable<string>, from: number): number {
  const names = new Set([...taken].map((n) => n.toLowerCase()));
  let v = Math.max(1, from);
  while (names.has(withVersion(fileName, v).toLowerCase())) v += 1;
  return v;
}

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export type StoredFile = {
  item: GraphItem;
  driveId: string;
  /** Library-relative folder, e.g. "FY2026-27/GST/2026-10/Final". */
  folder: string;
  fileName: string;
  version: number;
  sha256: string;
  sizeBytes: number;
};

export interface DeliverableStore {
  /** Drive id of the client's `Compliance` library. NotProvisionedError when the site or library is missing. */
  complianceDrive(clientCode: string): Promise<string>;
  /** Create `fileName` (re-versioned upwards from its own `_v{n}` until free) in `folder`. Never overwrites. */
  putNew(driveId: string, folder: string, fileName: string, bytes: Uint8Array): Promise<StoredFile>;
  /** Copy `fromFolder/fileName` into `toFolder`, re-versioned upwards until free. Never overwrites. */
  copyVersioned(driveId: string, fromFolder: string, fileName: string, toFolder: string): Promise<StoredFile>;
  read(driveId: string, folder: string, fileName: string): Promise<Buffer | null>;
  /**
   * Does the stored file still have this sha256? Uses Graph's sha256Hash when the drive reports one
   * (SharePoint libraries usually do not), otherwise downloads and hashes the bytes.
   */
  verify(driveId: string, folder: string, fileName: string, sha256: string): Promise<boolean>;
}

const join = (folder: string, name: string) => `${folder.replace(/\/+$/, "")}/${name}`;

export function createDeliverableStore(client: SharePointClient, opts: { host?: string } = {}): DeliverableStore {
  const host = opts.host ?? DEFAULT_TENANT_HOST;

  async function existingNames(driveId: string, folder: string): Promise<string[]> {
    const folderItem = await client.getItemByPath(driveId, folder);
    if (!folderItem) return [];
    return (await client.listChildren(driveId, folder)).map((c) => c.name);
  }

  /** Upload with conflict "fail", bumping the version on every 409 (bounded). */
  async function uploadFrom(driveId: string, folder: string, fileName: string, bytes: Uint8Array): Promise<StoredFile> {
    const start = nextFreeVersion(fileName, await existingNames(driveId, folder), versionOf(fileName) ?? 1);
    for (let v = start; v < start + MAX_VERSION_ATTEMPTS; v++) {
      const name = withVersion(fileName, v);
      try {
        const item = await client.uploadFile(driveId, join(folder, name), bytes, { conflict: "fail" });
        return { item, driveId, folder, fileName: name, version: v, sha256: sha256Hex(bytes), sizeBytes: bytes.byteLength };
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }
    throw new ConflictError(`${join(folder, fileName)} (no free version within ${MAX_VERSION_ATTEMPTS} attempts)`);
  }

  return {
    async complianceDrive(clientCode) {
      const siteUrl = clSiteUrl(clientCode, host);
      const site = await client.getSiteByUrl(siteUrl);
      if (!site) throw new NotProvisionedError(`Client site ${siteUrl} does not exist yet; run onboarding (ensureClientSite) first`);
      const drive = await client.getDriveByName(site.id, COMPLIANCE_LIBRARY);
      if (!drive) throw new NotProvisionedError(`Library ${COMPLIANCE_LIBRARY} on ${siteUrl} does not exist yet; run ensureFyTree first`);
      return drive.id;
    },
    putNew(driveId, folder, fileName, bytes) {
      return uploadFrom(driveId, folder, fileName, bytes);
    },
    async copyVersioned(driveId, fromFolder, fileName, toFolder) {
      const bytes = await client.downloadFile(driveId, join(fromFolder, fileName));
      if (!bytes) throw new NotProvisionedError(`Cannot copy ${join(fromFolder, fileName)}: the file is not there`);
      return uploadFrom(driveId, toFolder, fileName, bytes);
    },
    read(driveId, folder, fileName) {
      return client.downloadFile(driveId, join(folder, fileName));
    },
    async verify(driveId, folder, fileName, sha256) {
      const want = sha256.toLowerCase();
      const item = await client.getItemByPath(driveId, join(folder, fileName));
      if (!item) return false;
      const reported = item.file?.hashes?.sha256Hash;
      if (reported) return reported.toLowerCase() === want;
      const bytes = await client.downloadFile(driveId, join(folder, fileName));
      return !!bytes && sha256Hex(bytes) === want;
    },
  };
}
