// What this process knows about the content of SharePoint files it has hashed itself
// (docs/qa/efficiency-report.md, close-gate verification without downloads).
//
// When the deliverable store uploads a file, it knows the bytes: it computes their SHA-256 and
// quickXorHash, and Graph's upload response gives the new item's quickXorHash and content tag
// (cTag). When the two quickXorHashes agree, SharePoint holds exactly our bytes, so the item's
// SHA-256 is known. The same is learnt when the close gate downloads a file and hashes it.
//
// Later checks (the close gate, the reconciler's DONE re-check every 30 minutes) read the item's
// metadata only. The remembered SHA-256 is reused ONLY when the item's cTag, quickXorHash and size
// are all unchanged since then. cTag is SharePoint's own content version — it changes whenever the
// file's content changes and cannot be set by a user — so a replaced or edited file always
// misses here and is downloaded and hashed as before. quickXorHash alone (not collision resistant)
// is never trusted on its own; an item without a cTag is always downloaded.
//
// Process memory only (bounded LRU, pinned on globalThis so every server bundle shares one). The
// same facts are also written to the Deliverable row (quickXorHash, cTag) at upload / finalize, and
// the close-gate verifier reads them from the row, so after a restart a file this app uploaded is
// still verified without a download; files without a recorded fingerprint are downloaded once.
import type { GraphItem } from "./graph-client";
import { quickXorHash } from "./quick-xor-hash";

export type ContentFacts = { sha256: string; quickXorHash: string; size: number; cTag: string };

type ItemMeta = Pick<GraphItem, "id" | "size" | "cTag" | "file">;

export interface ContentRegistry {
  /** Remember facts about a drive item's current content. */
  remember(driveId: string, itemId: string, facts: ContentFacts): void;
  /** The SHA-256 of the item's content when its live metadata proves it is unchanged, else null. */
  knownSha256(driveId: string, item: ItemMeta): string | null;
  readonly size: number;
}

export const CONTENT_REGISTRY_MAX = 5000;

/** The live metadata that must match: content tag, quickXorHash and size. Null when any is missing. */
export function liveFingerprint(item: Pick<GraphItem, "size" | "cTag" | "file">): { cTag: string; quickXorHash: string; size: number } | null {
  const qx = item.file?.hashes?.quickXorHash;
  if (!item.cTag || !qx || typeof item.size !== "number") return null;
  return { cTag: item.cTag, quickXorHash: qx, size: item.size };
}

/**
 * Bounded by two generations (no per-entry removal): new and re-checked items go to the young map;
 * when it holds half of `max`, it becomes the old map and the previous old map is dropped whole.
 * An item found in the old map is copied back to the young one, so files that keep being checked stay.
 */
export function createContentRegistry(max = CONTENT_REGISTRY_MAX): ContentRegistry {
  const half = Math.max(1, Math.ceil(max / 2));
  let young = new Map<string, ContentFacts>();
  let old = new Map<string, ContentFacts>();
  const key = (driveId: string, itemId: string) => `${driveId}\u0000${itemId}`;
  const put = (k: string, facts: ContentFacts) => {
    young.set(k, facts);
    if (young.size >= half) {
      old = young;
      young = new Map();
    }
  };
  return {
    remember(driveId, itemId, facts) {
      put(key(driveId, itemId), { ...facts, sha256: facts.sha256.toLowerCase() });
    },
    knownSha256(driveId, item) {
      const live = liveFingerprint(item);
      const k = key(driveId, item.id);
      let facts = young.get(k);
      if (!facts) {
        facts = old.get(k);
        if (facts) put(k, facts);
      }
      if (!live || !facts) return null;
      if (facts.cTag !== live.cTag || facts.quickXorHash !== live.quickXorHash || facts.size !== live.size) return null;
      return facts.sha256;
    },
    get size() {
      return young.size + old.size;
    },
  };
}

/**
 * Facts for an item whose bytes we hold, or null unless the item reports a cTag and its size and
 * quickXorHash equal those of `bytes` (then SharePoint stores exactly these bytes).
 */
export function factsFromBytes(item: Pick<GraphItem, "size" | "cTag" | "file">, bytes: Uint8Array, sha256: string): ContentFacts | null {
  const live = liveFingerprint(item);
  if (!live || live.size !== bytes.byteLength) return null;
  const qx = quickXorHash(bytes);
  if (qx !== live.quickXorHash) return null;
  return { sha256, quickXorHash: qx, size: bytes.byteLength, cTag: live.cTag };
}

const pinned = globalThis as unknown as { __firmOsContentRegistry?: ContentRegistry };

/** One registry per process, shared by the deliverable store (uploads) and the close-gate verifier. */
export const defaultContentRegistry: ContentRegistry = (pinned.__firmOsContentRegistry ??= createContentRegistry());
