// File upload limits for Firm OS (Phase 11): a type allowlist (pdf, xlsx, xls, csv, json, docx),
// 25 MB per file, a content sniff so a renamed file is caught, and a virus-scan hook.
//
// Where it applies
//   - readUploadForm(): for any route that accepts a file (the agent "uploads" input source and
//     Phase 10 attachments plug in here). Rejections are 413 / 415 / 422. It never buffers more
//     than the limit: precheckContentLength() refuses by the declared length before the body is
//     read, and readFormDataCapped() counts bytes as they arrive (chunked bodies, lying headers).
//     A route that must keep its own form handling calls those two directly, first thing.
//   - Agent inputs (src/lib/agents/core/inputs.ts): files a run reads from the job's ClientDocs
//     folder on SharePoint are screened with screenUpload() in "warn" mode for type (the ROC agent
//     reads an optional notes.txt), and strictly for size and the scan verdict; the staff "uploads"
//     source is screened strictly.
//   - The legacy LMS client-document upload keeps its own MAX_UPLOAD_BYTES (not Firm OS).
//
// Virus scanning is a placeholder: no scanner is configured, so the default verdict is
// "not-scanned" and the file is ALLOWED WITH A WARNING, which is logged (one structured line, no
// file name: names can carry client names, ADR-006). Plug a real engine in by implementing
// VirusScanner (e.g. ClamAV over TCP, or Defender for Storage) and passing it as `scanner`; an
// "infected" verdict rejects the file. Blocked: needs a scanning service (docs/runbooks/breach.md).
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Allowed extensions → MIME types a browser or SharePoint may report for them. */
export const UPLOAD_TYPES: Readonly<Record<string, readonly string[]>> = {
  pdf: ["application/pdf"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  xls: ["application/vnd.ms-excel"],
  csv: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"],
  json: ["application/json", "text/json", "text/plain"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};
export const UPLOAD_EXTENSIONS = Object.keys(UPLOAD_TYPES);
/** MIME types that say nothing about the content (the extension and the sniff decide). */
const GENERIC_MIME = new Set(["", "application/octet-stream", "binary/octet-stream", "application/x-download"]);

export type UploadProblem = "name" | "type" | "type-mismatch" | "empty" | "size" | "content" | "infected";
export type UploadCheck = { ok: true; ext: string } | { ok: false; status: 400 | 413 | 415 | 422; code: UploadProblem; reason: string };

export const extOf = (name: string) => (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();

/** Name, extension, declared MIME type and size; no bytes needed. */
export function checkUpload(file: { name: string; size: number; type?: string | null }, maxBytes = UPLOAD_MAX_BYTES): UploadCheck {
  const name = file.name?.trim() ?? "";
  if (!name || name.length > 200 || /[\\/\0]/.test(name) || name === "." || name === "..") return { ok: false, status: 400, code: "name", reason: "The file needs a plain name (no folders), up to 200 characters" };
  const ext = extOf(name);
  if (!UPLOAD_TYPES[ext]) return { ok: false, status: 415, code: "type", reason: `${ext ? `.${ext}` : "This"} file type is not accepted. Upload ${UPLOAD_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")} only.` };
  const mime = (file.type ?? "").split(";")[0].trim().toLowerCase();
  if (!GENERIC_MIME.has(mime) && !UPLOAD_TYPES[ext].includes(mime)) return { ok: false, status: 415, code: "type-mismatch", reason: `The file is named .${ext} but was sent as ${mime}` };
  return sizeCheck(file.size, maxBytes) ?? { ok: true, ext };
}

/** Empty (400) or over the limit (413), or null. */
function sizeCheck(size: number, maxBytes: number): Extract<UploadCheck, { ok: false }> | null {
  if (size <= 0) return { ok: false, status: 400, code: "empty", reason: "The file is empty" };
  if (size > maxBytes) return { ok: false, status: 413, code: "size", reason: `The file is ${mb(size)}; the limit is ${mb(maxBytes)}` };
  return null;
}

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`;

/** Does the content look like its extension? (PDF header, ZIP for xlsx/docx, OLE for xls, text for csv/json.) */
export function sniffMatches(ext: string, bytes: Uint8Array): boolean {
  const head = (n: number) => Array.from(bytes.subarray(0, n));
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  switch (ext) {
    case "pdf":
      return starts([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    case "xlsx":
    case "docx":
      return starts([0x50, 0x4b, 0x03, 0x04]); // ZIP (OOXML)
    case "xls":
      // OLE compound file; an "xls" that is really CSV/HTML (common bank exports) is text.
      return starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) || isText(bytes);
    case "csv":
      return isText(bytes);
    case "json": {
      if (!isText(bytes)) return false;
      const first = head(64).find((b) => ![0xef, 0xbb, 0xbf, 0x20, 0x09, 0x0a, 0x0d].includes(b));
      return first === 0x7b || first === 0x5b; // { or [
    }
    default:
      return false;
  }
}

/** No NUL byte in the first 8 KB. */
function isText(bytes: Uint8Array): boolean {
  return !bytes.subarray(0, 8192).includes(0);
}

// ------------------------------------------------------------------ virus scan hook

export type ScanVerdict = { status: "clean" | "infected" | "not-scanned"; engine: string; detail?: string };

/** Implement to plug in a real engine. */
export interface VirusScanner {
  readonly engine: string;
  scan(file: { name: string; bytes: Uint8Array }): Promise<ScanVerdict>;
}

/** The default: nothing is scanned; files are allowed with a warning. */
export const notScannedScanner: VirusScanner = {
  engine: "none",
  scan: async () => ({ status: "not-scanned", engine: "none", detail: "No virus scanner is configured: allowed with a warning" }),
};

export type UploadLogEntry = {
  source: string;
  sha256: string;
  ext: string;
  bytes: number;
  verdict: ScanVerdict["status"] | "rejected";
  engine: string;
  problem?: UploadProblem;
};

export type UploadLog = (e: UploadLogEntry) => void;

/** One structured line per screened file (no file name: it may carry a client's name). */
export const consoleUploadLog: UploadLog = (e) => {
  const line = `[upload] ${JSON.stringify(e)}`;
  if (e.verdict === "clean") console.info(line);
  else console.warn(line);
};

export type ScreenResult =
  | { ok: true; ext: string; verdict: ScanVerdict; warning: string | null }
  | { ok: false; status: 400 | 413 | 415 | 422; code: UploadProblem; reason: string };

export type ScreenOptions = {
  scanner?: VirusScanner;
  log?: UploadLog;
  maxBytes?: number;
  /** "warn": a type outside the allowlist is logged, not rejected (ClientDocs). Size and scan stay strict. */
  typeMode?: "strict" | "warn";
  /** Where the file came from, for the log ("upload", "client-docs"). */
  source?: string;
};

/** Every check on one file: name/type/size, content sniff, then the scan hook. */
export async function screenUpload(file: { name: string; bytes: Uint8Array; type?: string | null }, opts: ScreenOptions = {}): Promise<ScreenResult> {
  const scanner = opts.scanner ?? notScannedScanner;
  const log = opts.log ?? consoleUploadLog;
  const ext = extOf(file.name);
  const entry = (verdict: UploadLogEntry["verdict"], problem?: UploadProblem): UploadLogEntry => ({
    source: opts.source ?? "upload",
    sha256: createHash("sha256").update(file.bytes).digest("hex").slice(0, 16),
    ext,
    bytes: file.bytes.length,
    verdict,
    engine: scanner.engine,
    ...(problem ? { problem } : {}),
  });
  const reject = (r: Extract<ScreenResult, { ok: false }>): ScreenResult => {
    log(entry("rejected", r.code));
    return r;
  };

  const c = checkUpload({ name: file.name, size: file.bytes.length, type: file.type }, opts.maxBytes);
  const typeOnly = !c.ok && (c.code === "type" || c.code === "type-mismatch");
  if (!c.ok && !(typeOnly && opts.typeMode === "warn")) return reject(c);
  // Warn mode lets an off-list type through, never an empty or oversized file.
  const size = typeOnly ? sizeCheck(file.bytes.length, opts.maxBytes ?? UPLOAD_MAX_BYTES) : null;
  if (size) return reject(size);
  const typeWarning = !c.ok ? c.reason : null;
  if (c.ok && !sniffMatches(c.ext, file.bytes)) {
    const r = { ok: false as const, status: 415 as const, code: "content" as const, reason: `The content does not look like a .${c.ext} file` };
    if (opts.typeMode !== "warn") return reject(r);
  }

  const verdict = await scanner.scan({ name: file.name, bytes: file.bytes });
  if (verdict.status === "infected") return reject({ ok: false, status: 422, code: "infected", reason: `The virus scan (${verdict.engine}) flagged this file${verdict.detail ? `: ${verdict.detail}` : ""}` });
  log(entry(verdict.status));
  const warning = [typeWarning, verdict.status === "not-scanned" ? (verdict.detail ?? "Not scanned for viruses") : null].filter(Boolean).join("; ") || null;
  return { ok: true, ext: c.ok ? c.ext : ext, verdict, warning };
}

/** JSON error for a refused upload. */
export function uploadErrorResponse(r: Extract<ScreenResult, { ok: false }>): NextResponse {
  return NextResponse.json({ error: r.reason, code: r.code }, { status: r.status });
}

export type UploadedFile = { name: string; type: string; bytes: Uint8Array; warning: string | null };

// ------------------------------------------------------------------ body size (before the body is read)

/** Multipart framing (boundaries, part headers, small text fields) allowed on top of the file limit. */
export const MULTIPART_FRAMING_BYTES = 64 * 1024;

const tooLarge = (size: number, max: number) => uploadErrorResponse({ ok: false, status: 413, code: "size", reason: `The upload is ${mb(size)}; the limit is ${mb(max)}` });

/**
 * Content-Length pre-check for an upload route: call it FIRST, before req.formData() / req.json().
 * Returns the 413 to send when the declared length is over `maxBytes` (+ multipart framing), else
 * null. A body with no Content-Length (chunked) passes here; read it with readFormDataCapped(),
 * which counts the bytes as they arrive. src/middleware.ts applies the same idea per route earlier.
 */
export function precheckContentLength(req: Request, maxBytes: number = UPLOAD_MAX_BYTES, framing = MULTIPART_FRAMING_BYTES): NextResponse | null {
  const raw = req.headers.get("content-length");
  if (raw === null || raw.trim() === "") return null;
  const declared = Number(raw);
  if (!Number.isFinite(declared) || declared < 0) return NextResponse.json({ error: "The Content-Length header is not a number", code: "size" }, { status: 400 });
  return declared > maxBytes + framing ? tooLarge(declared, maxBytes) : null;
}

class BodyTooLargeError extends Error {}

/**
 * req.formData(), but it stops reading once more than `maxBytes` (+ framing) has arrived, whatever
 * the headers say — covers chunked bodies and a Content-Length that lies. 413 when over, 400 when
 * the body is not form data.
 */
export async function readFormDataCapped(
  req: Request,
  maxBytes: number = UPLOAD_MAX_BYTES,
  framing = MULTIPART_FRAMING_BYTES,
): Promise<{ ok: true; form: FormData } | { ok: false; res: NextResponse }> {
  const pre = precheckContentLength(req, maxBytes, framing);
  if (pre) return { ok: false, res: pre };
  const limit = maxBytes + framing;
  const badForm = () => ({ ok: false as const, res: NextResponse.json({ error: "Send the file as multipart/form-data", code: "name" }, { status: 400 }) });
  if (!req.body) return badForm();
  let seen = 0;
  const counted = req.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctl) {
        seen += chunk.byteLength;
        if (seen > limit) ctl.error(new BodyTooLargeError());
        else ctl.enqueue(chunk);
      },
    }),
  );
  try {
    const form = await new Response(counted, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
    return { ok: true, form };
  } catch {
    return seen > limit ? { ok: false, res: tooLarge(seen, maxBytes) } : badForm();
  }
}

/**
 * For a route that accepts a multipart upload: refuses by Content-Length before reading the body,
 * reads it with a running byte cap, then reads the one file field and screens it. Returns the file,
 * or the error response to send.
 */
export async function readUploadForm(req: Request, opts: ScreenOptions & { field?: string } = {}): Promise<{ ok: true; file: UploadedFile } | { ok: false; res: NextResponse }> {
  const max = opts.maxBytes ?? UPLOAD_MAX_BYTES;
  const read = await readFormDataCapped(req, max);
  if (!read.ok) return read;
  const form = read.form;
  const value = form.get(opts.field ?? "file");
  if (!value || typeof value === "string") return { ok: false, res: NextResponse.json({ error: "Attach a file", code: "empty" }, { status: 400 }) };
  const file = value as File;
  const pre = checkUpload({ name: file.name, size: file.size, type: file.type }, max);
  if (!pre.ok && pre.code === "size") return { ok: false, res: uploadErrorResponse(pre) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const r = await screenUpload({ name: file.name, bytes, type: file.type }, { ...opts, source: opts.source ?? "upload", typeMode: "strict" });
  if (!r.ok) return { ok: false, res: uploadErrorResponse(r) };
  return { ok: true, file: { name: file.name, type: file.type, bytes, warning: r.warning } };
}
