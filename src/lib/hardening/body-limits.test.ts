// Security audit #9: 60 MB server-action bodies were accepted on every page route (the public
// sign-in page included) and decoded before the action-id check; upload routes read formData()
// before any size check. Ported from the audit PoC (.audit-sec/secrets/area-a-secrets-config.test.ts
// "DoS configuration", .audit-sec/web/uploads.test.ts): the config ceiling is now the largest
// legitimate action, a middleware refuses by Content-Length first, and the upload helpers cap reads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware, config } from "@/middleware";
import { BODY_LIMITS, LARGE_BODY_ROUTES, MAX_LARGE_BODY, bodyLimitFor, checkBody, hasBearerToken, hasSessionCookie } from "./body-limits";
import { MULTIPART_FRAMING_BYTES, precheckContentLength, readFormDataCapped } from "./uploads";

const ROOT = join(__dirname, "../../..");
const MB = 1024 * 1024;
const SESSION = "authjs.session-token=4f6d2c3e-1b2a-4c5d-9e8f-0a1b2c3d4e5f";

function post(path: string, headers: Record<string, string>) {
  return new NextRequest(`https://lms.example${path}`, { method: "POST", headers });
}

describe("server-action ceiling (next.config.ts)", () => {
  it("is no longer 60 MB: it is the largest legitimate action (the admin handout, 50 MB + framing)", () => {
    const cfg = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(cfg).not.toMatch(/bodySizeLimit: "60mb"/);
    const m = /bodySizeLimit: "(\d+)mb"/.exec(cfg);
    expect(m).toBeTruthy();
    expect(Number(m![1]) * MB).toBeLessThanOrEqual(51 * MB);
    expect(Number(m![1]) * MB).toBe(MAX_LARGE_BODY);
  });
});

describe("middleware: refuses oversized bodies before Next reads them", () => {
  it("a 60 MB anonymous POST to the public sign-in page (a server-action shape) gets 413", async () => {
    const res = middleware(post("/", { "content-length": String(60 * MB), "next-action": "deadbeef", "content-type": "multipart/form-data; boundary=x" }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "This request is too large (60 MB). The limit here is 64 KB.", limit: 64 * 1024 });
  });

  it("anonymous bodies: 64 KB; signed in: 2 MB; bearer callers: 1 MB", () => {
    expect(middleware(post("/", { "content-length": String(64 * 1024) })).status).not.toBe(413);
    expect(middleware(post("/", { "content-length": String(64 * 1024 + 1) })).status).toBe(413);
    expect(middleware(post("/clients", { cookie: SESSION, "content-length": String(2 * MB) })).status).not.toBe(413);
    expect(middleware(post("/clients", { cookie: SESSION, "content-length": String(2 * MB + 1) })).status).toBe(413);
    expect(middleware(post("/api/cron/work", { authorization: "Bearer 0123456789abcdef0123", "content-length": String(MB + 1) })).status).toBe(413);
  });

  it("the upload routes get their large limit only with the credential they need", () => {
    const docs = "/api/clients/c1/documents";
    expect(middleware(post(docs, { cookie: SESSION, "content-length": String(50 * MB) })).status).not.toBe(413);
    expect(middleware(post(docs, { cookie: SESSION, "content-length": String(52 * MB) })).status).toBe(413);
    expect(middleware(post(docs, { "content-length": String(50 * MB) })).status).toBe(413); // no session: anonymous tier
    expect(middleware(post("/admin/video/v1", { cookie: SESSION, "content-length": String(50 * MB) })).status).not.toBe(413);
    expect(middleware(post("/admin/video/v1", { "content-length": String(50 * MB) })).status).toBe(413);
    expect(middleware(post("/api/tools/engagement-letters/l1/file", { cookie: SESSION, "content-length": String(5 * MB) })).status).toBe(413);
    expect(middleware(post("/api/tools/statutory/ingest", { authorization: "Bearer 0123456789abcdef0123", "content-length": String(20 * MB) })).status).not.toBe(413);
    expect(middleware(post("/api/tools/statutory/ingest", { cookie: SESSION, "content-length": String(20 * MB) })).status).toBe(413); // needs the relay bearer
  });

  it("an anonymous chunked body (no Content-Length) gets 411; GET is never touched; a junk length is 400", () => {
    expect(middleware(post("/", { "transfer-encoding": "chunked" })).status).toBe(411);
    expect(middleware(post("/clients", { cookie: SESSION, "transfer-encoding": "chunked" })).status).not.toBe(411);
    expect(middleware(new NextRequest("https://lms.example/", { method: "GET", headers: { "content-length": String(60 * MB) } })).status).not.toBe(413);
    expect(middleware(post("/", { "content-length": "12abc" })).status).toBe(400);
  });

  it("runs on pages and API routes, not on static assets", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const p of ["/", "/clients/c1", "/api/firm-os/onboard/start", "/admin/video/v1"]) expect(re.test(p), p).toBe(true);
    for (const p of ["/_next/static/chunks/main.js", "/_next/image", "/favicon.ico", "/logo.png"]) expect(re.test(p), p).toBe(false);
  });
});

describe("body-limit rules", () => {
  it("tiers and large routes", () => {
    expect(BODY_LIMITS).toEqual({ anonymous: 64 * 1024, bearer: MB, session: 2 * MB });
    expect(bodyLimitFor({ method: "GET", pathname: "/", hasSession: false, hasBearer: false })).toBeNull();
    expect(bodyLimitFor({ method: "post", pathname: "/api/tools/office-tools/tax/gstr3b", hasSession: true, hasBearer: false })).toBe(50 * MB);
    expect(LARGE_BODY_ROUTES.every((r) => r.maxBytes <= MAX_LARGE_BODY && r.why.length > 10)).toBe(true);
    expect(checkBody({ method: "POST", pathname: "/", contentLength: null, transferEncoding: null, hasSession: false, hasBearer: false })).toEqual({ ok: true, limit: 64 * 1024 });
  });

  it("session cookie and bearer detection (presence and shape only)", () => {
    expect(hasSessionCookie(SESSION)).toBe(true);
    expect(hasSessionCookie(`theme=dark; __Secure-authjs.session-token=${"a".repeat(36)}`)).toBe(true);
    expect(hasSessionCookie("authjs.session-token.0=" + "b".repeat(40))).toBe(true);
    expect(hasSessionCookie("authjs.session-token=")).toBe(false);
    expect(hasSessionCookie("authjs.csrf-token=" + "c".repeat(40))).toBe(false);
    expect(hasSessionCookie(null)).toBe(false);
    expect(hasBearerToken("Bearer fosc_" + "x".repeat(43))).toBe(true);
    expect(hasBearerToken("Bearer short")).toBe(false);
    expect(hasBearerToken("Basic dXNlcjpwYXNz")).toBe(false);
  });
});

describe("upload helpers for route handlers (exported from src/lib/hardening/uploads.ts)", () => {
  it("precheckContentLength refuses an oversized declared body (413) before anything is read", async () => {
    const req = new Request("http://x/api/clients/c1/documents", { method: "POST", headers: { "content-length": String(60 * MB) }, body: "x" });
    const res = precheckContentLength(req, 50 * MB);
    expect(res?.status).toBe(413);
    expect(await res!.json()).toEqual({ error: "The upload is 60 MB; the limit is 50 MB", code: "size" });
    expect(req.bodyUsed).toBe(false);
    expect(precheckContentLength(new Request("http://x", { method: "POST", headers: { "content-length": String(50 * MB + MULTIPART_FRAMING_BYTES) }, body: "x" }), 50 * MB)).toBeNull();
    expect(precheckContentLength(new Request("http://x", { method: "POST", body: "x" }), 1)).toBeNull(); // no length: the capped reader decides
  });

  it("readFormDataCapped stops a body with no Content-Length once it passes the cap (413), and reads a small form", async () => {
    // A chunked upload as the server sees it: a stream with no Content-Length, 16 KB at a time.
    const big = new FormData();
    big.set("files", new File([new Uint8Array(300 * 1024)], "big.pdf", { type: "application/pdf" }));
    const wire = new Response(big);
    const bytes = new Uint8Array(await wire.arrayBuffer());
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (sent >= bytes.length) return ctl.close();
        ctl.enqueue(bytes.subarray(sent, sent + 16 * 1024));
        sent += 16 * 1024;
      },
    });
    const chunked = new Request("http://x", { method: "POST", body: stream, headers: { "content-type": wire.headers.get("content-type")! }, duplex: "half" } as RequestInit);
    const r = await readFormDataCapped(chunked, 100 * 1024, 1024);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.res.status).toBe(413);
    expect(sent).toBeLessThan(bytes.length); // reading stopped early: the rest was never pulled

    const small = new FormData();
    small.set("docType", "PAN");
    small.set("files", new File(["%PDF-1.7"], "pan.pdf", { type: "application/pdf" }));
    const ok = await readFormDataCapped(new Request("http://x", { method: "POST", body: small }), 100 * 1024);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.form.get("docType")).toBe("PAN");

    const notForm = await readFormDataCapped(new Request("http://x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }), 1024);
    expect(notForm.ok || notForm.res.status).toBe(400);
  });
});
