// Deliverable file store on Path A (Phase 4): agent drafts go to {Period}/Working, approved packs
// are copied to {Period}/Final. Every write is create-only (conflict "fail"); when a name is taken
// the `_v{n}` suffix is bumped, so a Final file is never replaced, only joined by a higher version.
// Paths come from paths.ts (deliverablePath); this module never assembles a Path A URL itself.
//
// Graph economy (docs/qa/efficiency-report.md): the Compliance drive id of a client is looked up
// once per store and kept (a library is never deleted or recreated under Path A); a folder's names
// are listed with one children GET (a missing folder is a 404, not a separate item GET), and kept
// for a few seconds so the several deliverables of one run are numbered from one listing (a stale
// name is harmless: the upload is create-only and a 409 bumps the version, as for any race); and
// every upload records what SharePoint now holds (content-registry.ts) so later checks of the same
// file can be answered from its metadata instead of a download.
import { createHash } from "node:crypto";
import { defaultContentRegistry, factsFromBytes, type ContentRegistry } from "./content-registry";
import { ConflictError, GraphError, NotProvisionedError } from "./errors";
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
   * (SharePoint libraries usually do not), else what this process knows about the item's current
   * content (cTag + quickXorHash + size unchanged since we hashed it), otherwise downloads and
   * hashes the bytes.
   */
  verify(driveId: string, folder: string, fileName: string, sha256: string): Promise<boolean>;
}

const join = (folder: string, name: string) => `${folder.replace(/\/+$/, "")}/${name}`;

/** How long a client's Compliance drive id is kept (it does not change; the bound only limits staleness). */
export const DRIVE_ID_TTL_MS = 6 * 60 * 60 * 1000;
/** How long a folder listing is reused for numbering the next upload into the same folder. */
export const LISTING_TTL_MS = 30_000;

export type DeliverableStoreOptions = { host?: string; registry?: ContentRegistry; now?: () => number };

export function createDeliverableStore(client: SharePointClient, opts: DeliverableStoreOptions = {}): DeliverableStore {
  const host = opts.host ?? DEFAULT_TENANT_HOST;
  const registry = opts.registry ?? defaultContentRegistry;
  const now = opts.now ?? Date.now;
  const drives = new Map<string, { id: string; at: number }>();
  const listings = new Map<string, { names: Set<string>; at: number }>();
  const listingKey = (driveId: string, folder: string) => `${driveId}\u0000${folder.replace(/\/+$/, "")}`;

  /** Names in `folder` (empty when it does not exist yet), from one children GET. */
  async function existingNames(driveId: string, folder: string): Promise<Set<string>> {
    const key = listingKey(driveId, folder);
    const hit = listings.get(key);
    if (hit && now() - hit.at < LISTING_TTL_MS) return hit.names;
    let names: Set<string>;
    try {
      names = new Set((await client.listChildren(driveId, folder)).map((c) => c.name));
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e;
      names = new Set();
    }
    listings.set(key, { names, at: now() });
    return names;
  }

  /** Upload with conflict "fail", bumping the version on every 409 (bounded). */
  async function uploadFrom(driveId: string, folder: string, fileName: string, bytes: Uint8Array): Promise<StoredFile> {
    const taken = await existingNames(driveId, folder);
    const start = nextFreeVersion(fileName, taken, versionOf(fileName) ?? 1);
    for (let v = start; v < start + MAX_VERSION_ATTEMPTS; v++) {
      const name = withVersion(fileName, v);
      try {
        const item = await client.uploadFile(driveId, join(folder, name), bytes, { conflict: "fail" });
        taken.add(name);
        const sha256 = sha256Hex(bytes);
        const facts = factsFromBytes(item, bytes, sha256);
        if (facts) registry.remember(driveId, item.id, facts);
        return { item, driveId, folder, fileName: name, version: v, sha256, sizeBytes: bytes.byteLength };
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        taken.add(name);
      }
    }
    throw new ConflictError(`${join(folder, fileName)} (no free version within ${MAX_VERSION_ATTEMPTS} attempts)`);
  }

  return {
    async complianceDrive(clientCode) {
      const known = drives.get(clientCode);
      if (known && now() - known.at < DRIVE_ID_TTL_MS) return known.id;
      const siteUrl = clSiteUrl(clientCode, host);
      const site = await client.getSiteByUrl(siteUrl);
      if (!site) throw new NotProvisionedError(`Client site ${siteUrl} does not exist yet; run onboarding (ensureClientSite) first`);
      const drive = await client.getDriveByName(site.id, COMPLIANCE_LIBRARY);
      if (!drive) throw new NotProvisionedError(`Library ${COMPLIANCE_LIBRARY} on ${siteUrl} does not exist yet; run ensureFyTree first`);
      drives.set(clientCode, { id: drive.id, at: now() });
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
      const known = registry.knownSha256(driveId, item);
      if (known) return known === want;
      const bytes = await client.downloadFile(driveId, join(folder, fileName));
      if (!bytes) return false;
      const actual = sha256Hex(bytes);
      const facts = factsFromBytes(item, bytes, actual);
      if (facts) registry.remember(driveId, item.id, facts);
      return actual === want;
    },
  };
}
