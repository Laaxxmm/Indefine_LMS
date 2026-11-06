// File upload limits for Firm OS (Phase 11): a type allowlist (pdf, xlsx, xls, csv, json, docx),
// 25 MB per file, a content sniff so a renamed file is caught, and a virus-scan hook.
//
// Where it applies
//   - precheckContentLength() / readFormDataCapped(): the same Content-Length + running-count caps for a
//     route that keeps its own form handling (call first, before req.formData()).
//   - readMultipartUpload() / readUploadForm(): every route that accepts a multipart upload. The
//     body is capped before it is read (Content-Length, then a running count), and each file is
//     screened strictly against the route's own type list. Used by the LMS client documents
//     (DOCUMENT_TYPES: office files and scanned images, 50 MB each), the tax office tools (PDF)
//     and engagement-letter PDFs. Rejections are 413 / 415 / 422 with a sentence.
//   - Agent inputs (src/lib/agents/core/inputs.ts): files a run reads from the job's ClientDocs
//     folder on SharePoint are screened with screenUpload() in "warn" mode for type (the ROC agent
//     reads an optional notes.txt), and strictly for size and the scan verdict; the staff "uploads"
//     source is screened strictly.
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

export type UploadTypes = Readonly<Record<string, readonly string[]>>;
/** What staff attach to a client record: the office documents above plus scanned images (KYC scans). */
export const DOCUMENT_TYPES: UploadTypes = { ...UPLOAD_TYPES, jpg: ["image/jpeg", "image/pjpeg"], jpeg: ["image/jpeg", "image/pjpeg"], png: ["image/png"] };
/** PDF only (returns, signed letters). */
export const PDF_TYPES: UploadTypes = { pdf: UPLOAD_TYPES.pdf };
/**
 * Training materials (course handouts, live-session materials): the office documents and images
 * above plus slides (pptx, ppt), Word 97 (doc) and plain text. Re-audit NEW-6: these used to arrive
 * through server actions with no type screen; the route handlers now screen them strictly.
 */
export const MATERIAL_TYPES: UploadTypes = {
  ...DOCUMENT_TYPES,
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ppt: ["application/vnd.ms-powerpoint"],
  doc: ["application/msword"],
  txt: ["text/plain"],
};
/** Largest training-material file (as the old server actions allowed). */
export const MATERIAL_MAX_BYTES = 50 * 1024 * 1024;
/** MIME types that say nothing about the content (the extension and the sniff decide). */
const GENERIC_MIME = new Set(["", "application/octet-stream", "binary/octet-stream", "application/x-download"]);

export type UploadProblem = "name" | "type" | "type-mismatch" | "empty" | "size" | "content" | "infected";
export type UploadCheck = { ok: true; ext: string } | { ok: false; status: 400 | 413 | 415 | 422; code: UploadProblem; reason: string };

export const extOf = (name: string) => (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toLowerCase();

/** Name, extension, declared MIME type and size; no bytes needed. */
export function checkUpload(file: { name: string; size: number; type?: string | null }, maxBytes = UPLOAD_MAX_BYTES, types: UploadTypes = UPLOAD_TYPES): UploadCheck {
  const name = file.name?.trim() ?? "";
  if (!name || name.length > 200 || /[\\/\0]/.test(name) || name === "." || name === "..") return { ok: false, status: 400, code: "name", reason: "The file needs a plain name (no folders), up to 200 characters. Rename it and upload it again." };
  const ext = extOf(name);
  if (!types[ext]) return { ok: false, status: 415, code: "type", reason: `${ext ? `.${ext}` : "This"} file type is not accepted. Upload ${Object.keys(types).map((e) => `.${e}`).join(", ")} files only.` };
  const mime = (file.type ?? "").split(";")[0].trim().toLowerCase();
  if (!GENERIC_MIME.has(mime) && !types[ext].includes(mime)) return { ok: false, status: 415, code: "type-mismatch", reason: `The file is named .${ext} but its contents are a different kind of file. Save it again as .${ext} and upload it.` };
  return sizeCheck(file.size, maxBytes) ?? { ok: true, ext };
}

/** Empty (400) or over the limit (413), or null. */
function sizeCheck(size: number, maxBytes: number): Extract<UploadCheck, { ok: false }> | null {
  if (size <= 0) return { ok: false, status: 400, code: "empty", reason: "The file is empty. Check you picked the right file and upload it again." };
  if (size > maxBytes) return { ok: false, status: 413, code: "size", reason: `The file is ${mb(size)}; the limit is ${mb(maxBytes)}. Upload a smaller file, or split it.` };
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
    case "pptx":
      return starts([0x50, 0x4b, 0x03, 0x04]); // ZIP (OOXML)
    case "xls":
      // OLE compound file; an "xls" that is really CSV/HTML (common bank exports) is text.
      return starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) || isText(bytes);
    case "doc":
    case "ppt":
      return starts([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // OLE (Office 97)
    case "csv":
    case "txt":
      return isText(bytes);
    case "jpg":
    case "jpeg":
      return starts([0xff, 0xd8, 0xff]);
    case "png":
      return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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
  /** The accepted types for this route (default UPLOAD_TYPES). */
  types?: UploadTypes;
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

  const c = checkUpload({ name: file.name, size: file.bytes.length, type: file.type }, opts.maxBytes, opts.types);
  const typeOnly = !c.ok && (c.code === "type" || c.code === "type-mismatch");
  if (!c.ok && !(typeOnly && opts.typeMode === "warn")) return reject(c);
  // Warn mode lets an off-list type through, never an empty or oversized file.
  const size = typeOnly ? sizeCheck(file.bytes.length, opts.maxBytes ?? UPLOAD_MAX_BYTES) : null;
  if (size) return reject(size);
  const typeWarning = !c.ok ? c.reason : null;
  if (c.ok && !sniffMatches(c.ext, file.bytes)) {
    const r = { ok: false as const, status: 415 as const, code: "content" as const, reason: `The content does not look like a .${c.ext} file. Save it again as .${c.ext} and upload it.` };
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

/** Multipart framing on top of the files themselves. */
const FRAMING_BYTES = 64 * 1024;

const tooBig = (size: number, max: number) => uploadErrorResponse({ ok: false, status: 413, code: "size", reason: `The upload is ${mb(size)}; the limit is ${mb(max)}` });

/**
 * The request body, read no further than `cap` bytes: refused unread when Content-Length says it
 * is bigger, and cut off (413) while reading when a body without one runs past the cap. Memory
 * stays bounded whatever the client sends.
 */
export async function readBodyCapped(req: Request, cap: number, limitShown = cap): Promise<{ ok: true; bytes: Uint8Array<ArrayBuffer> } | { ok: false; res: NextResponse }> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > cap) return { ok: false, res: tooBig(declared, limitShown) };
  if (!req.body) return { ok: true, bytes: new Uint8Array(new ArrayBuffer(0)) };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return { ok: false, res: tooBig(total, limitShown) };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { ok: true, bytes };
}

export type MultipartOptions = ScreenOptions & {
  /** File fields to read (default ["file"]). */
  fields?: readonly string[];
  /** Most files in one request (default 1). */
  maxFiles?: number;
  /** Cap on the whole body (default maxFiles × maxBytes plus framing). */
  maxTotalBytes?: number;
};

export type RejectedFile = { name: string; status: number; reason: string };

/**
 * For every route that accepts a multipart upload: the body is capped before it is read (see
 * readBodyCapped), then each file in the given fields is screened strictly (name, type allowlist
 * for the route, size, content sniff, virus-scan hook). Returns the other form fields, the screened
 * files and the refused ones (multi-file routes report those per file), or the response to send.
 */
export async function readMultipartUpload(
  req: Request,
  opts: MultipartOptions = {},
): Promise<{ ok: true; form: FormData; files: UploadedFile[]; rejected: RejectedFile[] } | { ok: false; res: NextResponse }> {
  const max = opts.maxBytes ?? UPLOAD_MAX_BYTES;
  const maxFiles = opts.maxFiles ?? 1;
  const cap = opts.maxTotalBytes ?? max * maxFiles + FRAMING_BYTES;
  const body = await readBodyCapped(req, cap, maxFiles === 1 ? max : cap);
  if (!body.ok) return body;
  let form: FormData;
  try {
    form = await new Response(body.bytes, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return { ok: false, res: NextResponse.json({ error: "The upload could not be read. Choose the file again and upload it from the Firm OS page.", code: "name" }, { status: 400 }) };
  }
  const values = (opts.fields ?? ["file"]).flatMap((f) => form.getAll(f)).filter((v): v is File => typeof v !== "string");
  if (values.length > maxFiles) {
    return { ok: false, res: NextResponse.json({ error: `Upload at most ${maxFiles} file${maxFiles === 1 ? "" : "s"} at a time.`, code: "size" }, { status: 413 }) };
  }
  const files: UploadedFile[] = [];
  const rejected: RejectedFile[] = [];
  for (const file of values) {
    const pre = checkUpload({ name: file.name, size: file.size, type: file.type }, max, opts.types);
    if (!pre.ok && pre.code === "size") {
      rejected.push({ name: file.name, status: pre.status, reason: pre.reason });
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await screenUpload({ name: file.name, bytes, type: file.type }, { ...opts, source: opts.source ?? "upload", typeMode: "strict" });
    if (r.ok) files.push({ name: file.name, type: file.type, bytes, warning: r.warning });
    else rejected.push({ name: file.name, status: r.status, reason: r.reason });
  }
  return { ok: true, form, files, rejected };
}

/**
 * For a route that accepts one file: refuses by Content-Length (and by a running count) before
 * the body is read, then screens the one file field. Returns the file, or the error response.
 */
export async function readUploadForm(req: Request, opts: ScreenOptions & { field?: string } = {}): Promise<{ ok: true; file: UploadedFile; form: FormData } | { ok: false; res: NextResponse }> {
  const r = await readMultipartUpload(req, { ...opts, fields: [opts.field ?? "file"], maxFiles: 1 });
  if (!r.ok) return r;
  const bad = r.rejected[0];
  if (bad) return { ok: false, res: NextResponse.json({ error: bad.reason, code: "rejected" }, { status: bad.status }) };
  const file = r.files[0];
  if (!file) return { ok: false, res: NextResponse.json({ error: "Attach a file", code: "empty" }, { status: 400 }) };
  return { ok: true, file, form: r.form };
}

/**
 * A browser form posted from another site (re-audit NEW-6: the admin uploads moved from server
 * actions, which check the origin themselves, to route handlers that take a plain form post).
 * Refuses when the browser says the request is cross-site, or the Origin's host is not this host.
 */
export function crossSiteRefusal(req: Request): NextResponse | null {
  const refuse = () => NextResponse.json({ error: "This upload must be sent from the Firm OS page itself. Open the page and try again." }, { status: 403 });
  if ((req.headers.get("sec-fetch-site") ?? "").toLowerCase() === "cross-site") return refuse();
  const origin = req.headers.get("origin");
  if (!origin || origin === "null") return origin === "null" ? refuse() : null;
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  try {
    return new URL(origin).host.toLowerCase() === host ? null : refuse();
  } catch {
    return refuse();
  }
}

// ------------------------------------------------------------------ body size for routes with their own form handling

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
  if (!Number.isFinite(declared) || declared < 0) return NextResponse.json({ error: "The upload could not be read. Choose the file again and upload it from the Firm OS page.", code: "size" }, { status: 400 });
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
  const badForm = () => ({ ok: false as const, res: NextResponse.json({ error: "The upload could not be read. Choose the file again and upload it from the Firm OS page.", code: "name" }, { status: 400 }) });
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
