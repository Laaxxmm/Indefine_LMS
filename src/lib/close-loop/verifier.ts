// Live SharePoint check behind close-gate condition (a) (ADR-005): is the Final deliverable still
// there, at the Path A folder, non-empty, with the bytes we hashed? The gate takes a
// DeliverableVerifier by injection so it can be tested without Graph. Reads only (GET).
import { createHash } from "node:crypto";
import { BlockedError, NotProvisionedError } from "@/lib/integrations/sharepoint/errors";
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
}

export interface LiveItem {
  exists: boolean;
  /** Graph id of the item found; compared with the stored driveItemId. */
  driveItemId: string | null;
  sizeBytes: number;
  /** Library-relative path of the item found (null when it does not exist). */
  path: string | null;
  /** SHA-256 when the drive reports one; SharePoint libraries usually do not (then the gate downloads). */
  sha256: string | null;
}

export interface DeliverableVerifier {
  getItem(ref: DeliverableRef): Promise<LiveItem>;
  /** The file's bytes, or null when it is not there. Used only when getItem gave no sha256. */
  download(ref: DeliverableRef): Promise<Uint8Array | null>;
}

export const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export const MISSING: LiveItem = { exists: false, driveItemId: null, sizeBytes: 0, path: null, sha256: null };

/** Action reported until the Phase 4 graph-client content download is merged and wired here. */
export const VERIFIER_DOWNLOAD_BLOCKED =
  "Wire the close-loop DeliverableVerifier.download to graph-client.downloadFile (and read file.hashes.sha256Hash from getItemByPath) after the Phase 4 SharePoint merge; until then the gate cannot hash Final files and jobs stay CLOSING.";

/** The SharePointClient methods this verifier uses: GETs only. */
export type VerifierGraph = Pick<SharePointClient, "getSiteByUrl" | "getDriveByName" | "getItemByPath">;

/**
 * Graph-backed verifier. Finds the item by its Path A path (the gate passes the exact expected
 * path) and reports its id and size, so a different file at that path or a moved file fails.
 * The content hash needs a download, which the graph-client does not offer before the Phase 4
 * merge: download() throws BlockedError, the gate records it as a reason and the job stays CLOSING.
 */
export function graphDeliverableVerifier(graph: () => VerifierGraph, opts: { host?: string } = {}): DeliverableVerifier {
  const host = opts.host ?? DEFAULT_TENANT_HOST;
  const drives = new Map<string, string>();

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
      const item = await graph().getItemByPath(await driveFor(ref), ref.path);
      if (!item || item.folder) return MISSING;
      return { exists: true, driveItemId: item.id, sizeBytes: item.size ?? 0, path: ref.path, sha256: null };
    },
    async download() {
      throw new BlockedError(VERIFIER_DOWNLOAD_BLOCKED);
    },
  };
}
