// In-memory DeliverableStore (accuracy harness, tests): same create-only, version-bumping
// contract as the SharePoint store, with files held in a Map. Nothing is ever replaced.
import { nextFreeVersion, sha256Hex, versionOf, withVersion, type DeliverableStore, type StoredFile } from "@/lib/integrations/sharepoint/deliverable-store";

export type MemoryStore = DeliverableStore & {
  /** "driveId/folder/name" → bytes. */
  readonly files: ReadonlyMap<string, Buffer>;
  list(folder: string): string[];
};

export function createMemoryStore(driveId = "memory-drive"): MemoryStore {
  const files = new Map<string, Buffer>();
  let seq = 0;
  const k = (d: string, folder: string, name: string) => `${d}/${folder.replace(/\/+$/, "")}/${name}`;
  const namesIn = (d: string, folder: string) => {
    const prefix = `${d}/${folder.replace(/\/+$/, "")}/`;
    return [...files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/")).map((p) => p.slice(prefix.length));
  };

  function put(d: string, folder: string, fileName: string, bytes: Uint8Array): StoredFile {
    const v = nextFreeVersion(fileName, namesIn(d, folder), versionOf(fileName) ?? 1);
    const name = withVersion(fileName, v);
    const buf = Buffer.from(bytes);
    files.set(k(d, folder, name), buf);
    return { item: { id: `mem-item-${++seq}`, name, size: buf.length }, driveId: d, folder, fileName: name, version: v, sha256: sha256Hex(buf), sizeBytes: buf.length, quickXorHash: null, cTag: null };
  }

  return {
    files,
    list: (folder) => namesIn(driveId, folder).sort(),
    complianceDrive: async () => driveId,
    putNew: async (d, folder, fileName, bytes) => put(d, folder, fileName, bytes),
    async copyVersioned(d, fromFolder, fileName, toFolder) {
      const bytes = files.get(k(d, fromFolder, fileName));
      if (!bytes) throw new Error(`Cannot copy ${fromFolder}/${fileName}: the file is not there`);
      return put(d, toFolder, fileName, bytes);
    },
    read: async (d, folder, fileName) => files.get(k(d, folder, fileName)) ?? null,
    verify: async (d, folder, fileName, sha256) => {
      const b = files.get(k(d, folder, fileName));
      return !!b && sha256Hex(b) === sha256.toLowerCase();
    },
  };
}
