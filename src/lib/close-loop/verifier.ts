// Live SharePoint check behind close-gate condition (a) (ADR-005): is the Final deliverable still
// there, at the Path A folder, non-empty, with the bytes we hashed? The gate takes a
// DeliverableVerifier by injection so it can be tested without Graph. Reads only (GET).
//
// Hash without downloading (docs/qa/efficiency-report.md): SharePoint libraries report
// quickXorHash, not SHA-256. When this process has hashed the item's current content itself — it
// uploaded the file (deliverable store) or downloaded and hashed it on an earlier check — and the
// item's content tag (cTag), quickXorHash and size are all unchanged since, getItem reports that
// SHA-256 and the gate does not download (content-registry.ts). The same proof is kept on the
// Deliverable row (quickXorHash + cTag written at upload / finalize, only when SharePoint's reported
// quickXorHash and size equalled the bytes we hashed), so a restart needs no download either.
// Anything else (an older row without them, an edit in SharePoint — its cTag changes —, a drive
// without cTag) falls back to the download-and-hash below, exactly as before.
import { createHash } from "node:crypto";
import { defaultContentRegistry, factsFromBytes, liveFingerprint, type ContentRegistry } from "@/lib/integrations/sharepoint/content-registry";
import { NotProvisionedError } from "@/lib/integrations/sharepoint/errors";
import type { SharePointClient } from "@/lib/integrations/sharepoint/graph-client";
import { COMPLIANCE_LIBRARY, DEFAULT_TENANT_HOST, clSiteUrl } from "@/lib/integrations/sharepoint/paths";

/** What the gate knows about one Final deliverable, enough to find it live. */
export interface DeliverableRef {
  clientCode: string;
  /** Drive id of the client's Compliance library when the deliverable recorded it. */
  driveId: string | null;
  driveItemId: string;
  /** Library-relative path the file must be at: "FY2026-27/GST/2026-10/Final/ACME_Pack_v1.xlsx". */
  path: string;
  /** The Deliverable row's content record (sha256 + SharePoint fingerprint at upload), when known. */
  recorded?: RecordedContent | null;
}

/** What the Deliverable row says about the content uploaded. quickXorHash / cTag are null on older rows. */
export type RecordedContent = { sha256: string; quickXorHash: string | null; cTag: string | null; sizeBytes: number };

/**
 * The row's SHA-256 when the live item is provably the content recorded at upload: the row has a
 * cTag and quickXorHash, and the item's cTag, quickXorHash and size are all unchanged. Else null.
 */
export function recordedSha256(recorded: RecordedContent | null | undefined, item: Parameters<typeof liveFingerprint>[0]): string | null {
  if (!recorded?.cTag || !recorded.quickXorHash) return null;
  const live = liveFingerprint(item);
  if (!live) return null;
  if (live.cTag !== recorded.cTag || live.quickXorHash !== recorded.quickXorHash || live.size !== recorded.sizeBytes) return null;
  return recorded.sha256.toLowerCase();
}

export interface LiveItem {
  exists: boolean;
  /** Graph id of the item found; compared with the stored driveItemId. */
  driveItemId: string | null;
  sizeBytes: number;
  /** Library-relative path of the item found (null when it does not exist). */
  path: string | null;
  /**
   * SHA-256 when the drive reports one, or when this process hashed the item's current content
   * itself (cTag + quickXorHash + size unchanged since); otherwise null and the gate downloads.
   */
  sha256: string | null;
}

export interface DeliverableVerifier {
  getItem(ref: DeliverableRef): Promise<LiveItem>;
  /** The file's bytes, or null when it is not there. Used only when getItem gave no sha256. */
  download(ref: DeliverableRef): Promise<Uint8Array | null>;
}

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export const MISSING: LiveItem = { exists: false, driveItemId: null, sizeBytes: 0, path: null, sha256: null };

/** The SharePointClient methods this verifier uses: GETs only (metadata and file content). */
export type VerifierGraph = Pick<SharePointClient, "getSiteByUrl" | "getDriveByName" | "getItemByPath" | "downloadFile">;

/**
 * Graph-backed verifier over the Path A graph-client. Finds the item by its exact expected path and
 * reports its id and size, so a different file at that path, or a moved or deleted file, fails.
 * The SHA-256 comes from Graph's file.hashes.sha256Hash when the drive reports it, else from the
 * content registry when the item is provably unchanged since this process hashed it, else from the
 * Deliverable row's recorded fingerprint when the item is provably the uploaded content; otherwise the
 * gate downloads the bytes and hashes them (and the registry learns them for the next check).
 * `graph` is called lazily so a missing Graph credential surfaces as a gate reason, not a crash.
 */
export function graphDeliverableVerifier(graph: () => VerifierGraph, opts: { host?: string; registry?: ContentRegistry } = {}): DeliverableVerifier {
  const host = opts.host ?? DEFAULT_TENANT_HOST;
  const registry = opts.registry ?? defaultContentRegistry;
  const drives = new Map<string, string>();
  /** The metadata getItem last saw per item: a download is remembered only if its bytes are that content. */
  const seen = new Map<string, { driveId: string; itemId: string; meta: NonNullable<ReturnType<typeof liveFingerprint>> }>();

  async function driveFor(ref: DeliverableRef): Promise<string> {
    if (ref.driveId) return ref.driveId;
    const cached = drives.get(ref.clientCode);
    if (cached) return cached;
    const siteUrl = clSiteUrl(ref.clientCode, host);
    const site = await graph().getSiteByUrl(siteUrl);
    if (!site) throw new NotProvisionedError(`Client site ${siteUrl} does not exist`);
    const drive = await graph().getDriveByName(site.id, COMPLIANCE_LIBRARY);
    if (!drive) throw new NotProvisionedError(`Library ${COMPLIANCE_LIBRARY} on ${siteUrl} does not exist`);
    drives.set(ref.clientCode, drive.id);
    return drive.id;
  }

  return {
    async getItem(ref) {
      const driveId = await driveFor(ref);
      const item = await graph().getItemByPath(driveId, ref.path);
      if (!item || item.folder) return MISSING;
      const meta = liveFingerprint(item);
      if (meta) seen.set(`${driveId}\u0000${ref.path}`, { driveId, itemId: item.id, meta });
      const sha256 = item.file?.hashes?.sha256Hash ?? registry.knownSha256(driveId, item) ?? recordedSha256(ref.recorded, item);
      return { exists: true, driveItemId: item.id, sizeBytes: item.size ?? 0, path: ref.path, sha256 };
    },
    async download(ref) {
      const driveId = await driveFor(ref);
      const bytes = await graph().downloadFile(driveId, ref.path);
      const last = seen.get(`${driveId}\u0000${ref.path}`);
      if (bytes && last) {
        // Remember only when these bytes are the content getItem described (same quickXorHash and size).
        const facts = factsFromBytes({ ...last.meta, file: { hashes: { quickXorHash: last.meta.quickXorHash } } }, bytes, sha256Hex(bytes));
        if (facts) registry.remember(last.driveId, last.itemId, facts);
      }
      return bytes;
    },
  };
}
