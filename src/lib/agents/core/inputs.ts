// Input sources for the agent runner: the job's SharePoint ClientDocs folder, files staff upload,
// and books exports, combined; plus a static source for tests and fixtures. Read-only: nothing
// here writes to SharePoint.
//
// Upload limits (Phase 11, src/lib/hardening/uploads.ts): every file a source returns is screened
// by screenedInputSource(): 25 MB per file, the virus-scan hook (default "not scanned — allowed
// with warning", logged once per gather), and the type allowlist (pdf, xlsx, xls, csv, json, docx).
// ClientDocs is screened in "warn" mode for type, because the ROC agent reads an optional
// notes.txt placed there; staff uploads are screened strictly. A rejected file stops the run.
// ZIP-based files (xlsx, docx) are also inspected for decompression bombs and oversized sheets
// (src/lib/hardening/xlsx-guard.ts: 64 MB unpacked, 50,000 rows, column IV, 300,000 cells).
import type { DeliverableStore } from "@/lib/integrations/sharepoint/deliverable-store";
import { GraphError } from "@/lib/integrations/sharepoint/errors";
import type { SharePointClient } from "@/lib/integrations/sharepoint/graph-client";
import { screenUpload, type ScreenOptions, type UploadLogEntry } from "@/lib/hardening/uploads";
import { XlsxLimitError, inspectXlsx, isZipBytes } from "@/lib/hardening/xlsx-guard";
import type { InputFile, InputRequest, InputSource } from "./runner";

/** Inputs larger than this in total stop the run (a register, not a data dump). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export class InputTooLargeError extends Error {
  constructor(total: number, max: number) {
    super(`The documents for this run add up to ${(total / 1048576).toFixed(1)} MB, above the ${(max / 1048576).toFixed(1)} MB limit for one run. Split them across runs, or remove files the agent does not need.`);
    this.name = "InputTooLargeError";
  }
}

export class InputRejectedError extends Error {
  constructor(name: string, reason: string) {
    super(`${name} was refused: ${reason}`);
    this.name = "InputRejectedError";
  }
}

/**
 * Screens every file the inner source returns (src/lib/hardening/uploads.ts). Throws
 * InputRejectedError on a refused file; logs one summary line per gather (no file names).
 */
export function screenedInputSource(inner: InputSource, opts: ScreenOptions & { typeMode: "strict" | "warn" }): InputSource {
  return {
    async gather(req: InputRequest) {
      const files = await inner.gather(req);
      const entries: UploadLogEntry[] = [];
      const log = opts.log ?? ((e: UploadLogEntry) => void entries.push(e));
      try {
        for (const f of files) {
          const r = await screenUpload({ name: f.name, bytes: f.bytes, type: f.contentType }, { ...opts, log, source: f.source });
          if (!r.ok) throw new InputRejectedError(f.name, r.reason);
          // A ZIP-based file (xlsx, docx) is walked before any agent parses it: unpacked size,
          // packing ratio, rows / columns / cells per sheet (src/lib/hardening/xlsx-guard.ts).
          if (isZipBytes(f.bytes)) {
            try {
              await inspectXlsx(f.bytes);
            } catch (e) {
              if (e instanceof XlsxLimitError) throw new InputRejectedError(f.name, e.message);
              throw e;
            }
          }
        }
      } finally {
        const flagged = entries.filter((e) => e.verdict !== "clean");
        if (flagged.length) console.warn(`[upload] ${req.clientCode} inputs screened: ${JSON.stringify(flagged)}`);
      }
      return files;
    },
  };
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
      // One children GET; a folder that does not exist yet is a 404 (no separate item GET).
      let listed: Awaited<ReturnType<SharePointClient["listChildren"]>>;
      try {
        listed = await client.listChildren(driveId, req.clientDocsFolder);
      } catch (e) {
        if (e instanceof GraphError && e.status === 404) return [];
        throw e;
      }
      const files: InputFile[] = [];
      let total = 0;
      // Name order, so a run sees the same files in the same order every time.
      const items = listed.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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

/**
 * Production input source: ClientDocs + uploads + books exports (the last two plug in later
 * phases), each screened by the upload limits: ClientDocs and books exports in "warn" mode for
 * type, staff uploads strictly.
 */
export function defaultInputSource(
  client: SharePointClient,
  store: DeliverableStore,
  extra: { uploads?: InputSource; booksExports?: InputSource; screen?: ScreenOptions } = {},
): InputSource {
  return combineInputSources([
    screenedInputSource(clientDocsInputSource(client, store), { ...extra.screen, typeMode: "warn" }),
    screenedInputSource(extra.uploads ?? emptyInputSource, { ...extra.screen, typeMode: "strict" }),
    screenedInputSource(extra.booksExports ?? emptyInputSource, { ...extra.screen, typeMode: "warn" }),
  ]);
}
