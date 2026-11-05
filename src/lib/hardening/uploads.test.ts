import { describe, expect, it, vi } from "vitest";
import {
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  checkUpload,
  notScannedScanner,
  readUploadForm,
  screenUpload,
  sniffMatches,
  type UploadLogEntry,
  type VirusScanner,
} from "./uploads";

const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.7\n1 0 obj\n");
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
const CSV = enc("ref,party,amount\nINV-1,Acme,100\n");
const JSON_BYTES = enc('﻿  {"a":1}');
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]);

describe("checkUpload: type allowlist and 25 MB", () => {
  it("accepts exactly pdf, xlsx, xls, csv, json, docx", () => {
    expect(UPLOAD_EXTENSIONS.sort()).toEqual(["csv", "docx", "json", "pdf", "xls", "xlsx"]);
    for (const ext of UPLOAD_EXTENSIONS) expect(checkUpload({ name: `GSTR-1.${ext.toUpperCase()}`, size: 10 })).toEqual({ ok: true, ext });
  });

  it.each(["invoice.exe", "notes.txt", "photo.png", "archive.zip", "macro.xlsm", "noextension", "page.html", "script.js"])("rejects %s with 415", (name) => {
    expect(checkUpload({ name, size: 10 })).toMatchObject({ ok: false, status: 415, code: "type" });
  });

  it("rejects a declared MIME type that contradicts the extension, accepts generic ones", () => {
    expect(checkUpload({ name: "a.pdf", size: 10, type: "application/x-msdownload" })).toMatchObject({ ok: false, status: 415, code: "type-mismatch" });
    expect(checkUpload({ name: "a.csv", size: 10, type: "text/csv; charset=utf-8" })).toMatchObject({ ok: true });
    expect(checkUpload({ name: "a.xlsx", size: 10, type: "application/octet-stream" })).toMatchObject({ ok: true });
    expect(checkUpload({ name: "a.xlsx", size: 10, type: "" })).toMatchObject({ ok: true });
  });

  it("enforces 25 MB: exactly the limit passes, one byte more is 413; empty is 400", () => {
    expect(UPLOAD_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(checkUpload({ name: "big.xlsx", size: UPLOAD_MAX_BYTES })).toMatchObject({ ok: true });
    expect(checkUpload({ name: "big.xlsx", size: UPLOAD_MAX_BYTES + 1 })).toEqual({ ok: false, status: 413, code: "size", reason: "The file is 25 MB; the limit is 25 MB" });
    expect(checkUpload({ name: "big.pdf", size: 40 * 1024 * 1024 })).toMatchObject({ reason: "The file is 40 MB; the limit is 25 MB" });
    expect(checkUpload({ name: "empty.csv", size: 0 })).toMatchObject({ ok: false, status: 400, code: "empty" });
  });

  it("rejects names with folders, NUL or nothing", () => {
    for (const name of ["", "  ", "../etc/passwd.csv", "a\\b.csv", "a\0.csv", "x".repeat(201) + ".csv"]) expect(checkUpload({ name, size: 1 }), name).toMatchObject({ ok: false, code: "name" });
  });
});

describe("sniffMatches", () => {
  it("checks magic bytes and text-ness", () => {
    expect(sniffMatches("pdf", PDF)).toBe(true);
    expect(sniffMatches("pdf", CSV)).toBe(false);
    expect(sniffMatches("xlsx", ZIP)).toBe(true);
    expect(sniffMatches("docx", ZIP)).toBe(true);
    expect(sniffMatches("xlsx", EXE)).toBe(false);
    expect(sniffMatches("xls", OLE)).toBe(true);
    expect(sniffMatches("xls", CSV)).toBe(true); // bank "xls" exports that are text
    expect(sniffMatches("xls", EXE)).toBe(false);
    expect(sniffMatches("csv", CSV)).toBe(true);
    expect(sniffMatches("csv", EXE)).toBe(false);
    expect(sniffMatches("json", JSON_BYTES)).toBe(true);
    expect(sniffMatches("json", enc("[1,2]"))).toBe(true);
    expect(sniffMatches("json", CSV)).toBe(false);
    expect(sniffMatches("exe", EXE)).toBe(false);
  });
});

describe("screenUpload: scan hook and logging", () => {
  it("default scanner: not scanned → allowed with a warning, logged without the file name", async () => {
    const log: UploadLogEntry[] = [];
    const r = await screenUpload({ name: "Acme Traders register.csv", bytes: CSV }, { log: (e) => log.push(e) });
    expect(r).toEqual({ ok: true, ext: "csv", verdict: await notScannedScanner.scan({ name: "", bytes: CSV }), warning: "No virus scanner is configured: allowed with a warning" });
    expect(log).toEqual([{ source: "upload", sha256: expect.stringMatching(/^[0-9a-f]{16}$/), ext: "csv", bytes: CSV.length, verdict: "not-scanned", engine: "none" }]);
    expect(JSON.stringify(log)).not.toContain("Acme");
  });

  it("logs to the console by default (warning level when not scanned)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await screenUpload({ name: "a.pdf", bytes: PDF });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[upload\] \{"source":"upload".*"verdict":"not-scanned","engine":"none"\}$/));
  });

  it("a real scanner's verdicts: clean passes silently-ish, infected is 422 and logged as rejected", async () => {
    const scanner = (status: "clean" | "infected"): VirusScanner => ({ engine: "clamav", scan: async () => ({ status, engine: "clamav", detail: status === "infected" ? "Eicar-Test-Signature" : undefined }) });
    const log: UploadLogEntry[] = [];
    expect(await screenUpload({ name: "a.pdf", bytes: PDF }, { scanner: scanner("clean"), log: (e) => log.push(e) })).toMatchObject({ ok: true, warning: null, verdict: { status: "clean" } });
    expect(await screenUpload({ name: "a.pdf", bytes: PDF }, { scanner: scanner("infected"), log: (e) => log.push(e) })).toEqual({
      ok: false,
      status: 422,
      code: "infected",
      reason: "The virus scan (clamav) flagged this file: Eicar-Test-Signature",
    });
    expect(log.map((e) => e.verdict)).toEqual(["clean", "rejected"]);
    expect(log[1].problem).toBe("infected");
  });

  it("rejects a renamed executable by content, and an oversized file before scanning", async () => {
    const scan = vi.fn(notScannedScanner.scan);
    const scanner = { engine: "spy", scan };
    expect(await screenUpload({ name: "invoice.pdf", bytes: EXE }, { scanner, log: () => {} })).toMatchObject({ ok: false, status: 415, code: "content" });
    expect(await screenUpload({ name: "a.csv", bytes: CSV }, { scanner, maxBytes: 10, log: () => {} })).toMatchObject({ ok: false, status: 413, code: "size" });
    expect(scan).not.toHaveBeenCalled();
  });

  it("warn mode (ClientDocs): an off-list type is allowed with a warning; size and infection stay strict", async () => {
    const r = await screenUpload({ name: "notes.txt", bytes: enc("AGM held on 30 Sep") }, { typeMode: "warn", log: () => {} });
    expect(r).toMatchObject({ ok: true, ext: "txt", warning: expect.stringMatching(/^\.txt file type is not accepted.*; No virus scanner/) });
    expect(await screenUpload({ name: "notes.txt", bytes: enc("x".repeat(20)) }, { typeMode: "warn", maxBytes: 10, log: () => {} })).toMatchObject({ ok: false, code: "size" });
    const infected: VirusScanner = { engine: "x", scan: async () => ({ status: "infected", engine: "x" }) };
    expect(await screenUpload({ name: "a.csv", bytes: CSV }, { typeMode: "warn", scanner: infected, log: () => {} })).toMatchObject({ ok: false, code: "infected" });
  });
});

describe("readUploadForm", () => {
  const form = (file: File | string | null, headers: Record<string, string> = {}) => {
    const fd = new FormData();
    if (file !== null) fd.set("file", file);
    return new Request("http://x/api/upload", { method: "POST", body: fd, headers });
  };

  it("returns the screened file", async () => {
    const r = await readUploadForm(form(new File([CSV], "register.csv", { type: "text/csv" })), { log: () => {} });
    expect(r).toMatchObject({ ok: true, file: { name: "register.csv", type: "text/csv", warning: expect.stringMatching(/No virus scanner/) } });
  });

  it("refuses a wrong type (415), an oversized declared body unread (413), a missing file (400) and a non-multipart body (400)", async () => {
    const exe = await readUploadForm(form(new File([EXE], "tool.exe")), { log: () => {} });
    expect(exe.ok || exe.res.status).toBe(415);
    const big = await readUploadForm(form(new File([CSV], "a.csv"), { "content-length": String(UPLOAD_MAX_BYTES + 1024 * 1024) }), { log: () => {} });
    expect(big.ok || big.res.status).toBe(413);
    if (!big.ok) expect(await big.res.json()).toEqual({ error: "The upload is 26 MB; the limit is 25 MB", code: "size" });
    const none = await readUploadForm(form(null), { log: () => {} });
    expect(none.ok || none.res.status).toBe(400);
    const text = await readUploadForm(form("just text"), { log: () => {} });
    expect(text.ok || text.res.status).toBe(400);
    const notMultipart = await readUploadForm(new Request("http://x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), { log: () => {} });
    expect(notMultipart.ok || notMultipart.res.status).toBe(400);
  });

  it("refuses a file over the limit by its size before reading it", async () => {
    const r = await readUploadForm(form(new File([CSV], "a.csv")), { maxBytes: 5, log: () => {} });
    expect(r.ok || r.res.status).toBe(413);
  });
});
