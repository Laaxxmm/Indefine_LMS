// Input sources for the agent runner: the job's SharePoint ClientDocs folder, files staff upload,
// and books exports, combined; plus a static source for tests and fixtures. Read-only: nothing
// here writes to SharePoint.
import type { DeliverableStore } from "@/lib/integrations/sharepoint/deliverable-store";
import type { SharePointClient } from "@/lib/integrations/sharepoint/graph-client";
import type { InputFile, InputRequest, InputSource } from "./runner";

/** Inputs larger than this in total stop the run (a register, not a data dump). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export class InputTooLargeError extends Error {
  constructor(total: number, max: number) {
    super(`Inputs total ${total} bytes, above the ${max}-byte limit; split the documents`);
    this.name = "InputTooLargeError";
  }
}

/** Fixed files (tests, fixtures, replay). */
export function staticInputSource(files: InputFile[]): InputSource {
  return { gather: async () => files.map((f) => ({ ...f, bytes: Buffer.from(f.bytes) })) };
}

/** No files (default for sources not wired yet). */
export const emptyInputSource: InputSource = { gather: async () => [] };

/** All sources in order; names are kept as given (agents look files up by name). */
export function combineInputSources(sources: InputSource[], maxBytes = MAX_INPUT_BYTES): InputSource {
  return {
    async gather(req: InputRequest) {
      const out: InputFile[] = [];
      for (const s of sources) out.push(...(await s.gather(req)));
      const total = out.reduce((n, f) => n + f.bytes.length, 0);
      if (total > maxBytes) throw new InputTooLargeError(total, maxBytes);
      return out;
    },
  };
}

/** Files directly inside the job's {Period}/ClientDocs folder on the client's CL- site. */
export function clientDocsInputSource(client: SharePointClient, store: DeliverableStore, maxBytes = MAX_INPUT_BYTES): InputSource {
  return {
    async gather(req: InputRequest) {
      const driveId = await store.complianceDrive(req.clientCode);
      const folder = await client.getItemByPath(driveId, req.clientDocsFolder);
      if (!folder) return [];
      const files: InputFile[] = [];
      let total = 0;
      // Name order, so a run sees the same files in the same order every time.
      const items = (await client.listChildren(driveId, req.clientDocsFolder)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const item of items) {
        if (!item.file) continue;
        total += item.size ?? 0;
        if (total > maxBytes) throw new InputTooLargeError(total, maxBytes);
        const bytes = await client.downloadFile(driveId, `${req.clientDocsFolder}/${item.name}`);
        if (bytes) files.push({ name: item.name, source: "client-docs", bytes, contentType: item.file.mimeType, path: `${req.clientDocsFolder}/${item.name}` });
      }
      return files;
    },
  };
}

/** Production input source: ClientDocs + uploads + books exports (the last two plug in later phases). */
export function defaultInputSource(client: SharePointClient, store: DeliverableStore, extra: { uploads?: InputSource; booksExports?: InputSource } = {}): InputSource {
  return combineInputSources([clientDocsInputSource(client, store), extra.uploads ?? emptyInputSource, extra.booksExports ?? emptyInputSource]);
}
