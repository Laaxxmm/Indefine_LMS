// Re-audit NEW-6 (MEDIUM): JSON readers had no byte cap — a signed-in caller (or a forged session
// cookie) sending a chunked body with no Content-Length was unbounded, and zod then parsed it. Ported
// from the re-audit PoC platform.test.ts ("route handlers that read req.json() with no cap"): every
// JSON reader now counts bytes as they arrive (1 MB default, 413 with a plain sentence), and no route
// handler calls req.json() directly.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
import { BODY_TOO_LARGE, JSON_BODY_MAX_BYTES, readJsonCapped, readJsonOrMarker } from "./json-body";
import { parse as parseCorrection, readJson as readCorrectionJson } from "@/lib/corrections/http";
import { parse as parseCloseLoop, readJson as readCloseLoopJson } from "@/lib/close-loop/http";
import { parseJson } from "@/lib/agents/http";
import { isPlainMessage } from "@/lib/errors";

const ROOT = join(__dirname, "..", "..", "..");

/** A request whose body arrives in 64 KB chunks with no Content-Length (chunked); `pulled` counts what was read. */
function chunked(totalBytes: number, fill = "a") {
  let sent = 0;
  const pulled = { bytes: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (sent >= totalBytes) return ctl.close();
      const n = Math.min(64 * 1024, totalBytes - sent);
      const chunk = new TextEncoder().encode((sent === 0 ? '{"note":"' : "") + fill.repeat(n));
      sent += n;
      pulled.bytes += chunk.byteLength;
      ctl.enqueue(chunk);
    },
  });
  const req = new Request("http://x/api", { method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
  return { req, pulled };
}

const json = (value: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(value), headers: { "content-type": "application/json" } });

describe("NEW-6: capped JSON bodies", () => {
  it("a small body reads as before; an empty or malformed one is null (as req.json().catch(() => null) gave)", async () => {
    expect(await readJsonCapped(json({ a: 1 }))).toEqual({ ok: true, value: { a: 1 } });
    expect(await readJsonCapped(new Request("http://x", { method: "POST", body: "{not json" }))).toEqual({ ok: true, value: null });
    expect(await readJsonCapped(new Request("http://x", { method: "POST" }))).toEqual({ ok: true, value: null });
  });

  it("PoC: a chunked 20 MB JSON body is cut off just past 1 MB with a 413 and a plain sentence", async () => {
    const { req, pulled } = chunked(20 * 1024 * 1024);
    const r = await readJsonCapped(req);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.res.status).toBe(413);
    const body = (await r.res.json()) as { error: string };
    expect(isPlainMessage(body.error)).toBe(true);
    expect(body.error).toMatch(/too large to send.*1 MB/);
    expect(pulled.bytes).toBeLessThan(JSON_BODY_MAX_BYTES + 3 * 64 * 1024); // stopped reading, not buffered to the end
  });

  it("a declared Content-Length over the cap is refused unread; a route may set its own cap", async () => {
    const big = new Request("http://x", { method: "POST", body: "{}", headers: { "content-length": String(5 * 1024 * 1024) } });
    const r = await readJsonCapped(big);
    expect(r.ok).toBe(false);
    expect((await readJsonCapped(chunked(2 * 1024 * 1024).req, 4 * 1024 * 1024)).ok).toBe(true);
  });

  it("every helper answers 413 over the cap (agents, corrections / privacy, close-loop)", async () => {
    const schema = z.object({ note: z.string() });
    expect((await parseJson(schema, chunked(3 * 1024 * 1024).req)).res?.status).toBe(413);
    const c = parseCorrection(schema, await readCorrectionJson(chunked(3 * 1024 * 1024).req));
    expect(!c.ok && c.res.status).toBe(413);
    const l = parseCloseLoop(schema, await readCloseLoopJson(chunked(3 * 1024 * 1024).req));
    expect(!l.ok && l.res.status).toBe(413);
    expect(await readJsonOrMarker(chunked(3 * 1024 * 1024).req)).toBe(BODY_TOO_LARGE);
    expect(parseCorrection(schema, { note: "ok" }).ok).toBe(true);
  });

  it("no route handler reads req.json() itself; the JSON helpers are capped", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) files.push(p);
      }
    };
    walk(join(ROOT, "src/app"));
    const direct = files.filter((p) => /\breq(?:uest)?\.json\(\)/.test(readFileSync(p, "utf8"))).map((p) => relative(ROOT, p).replace(/\\/g, "/"));
    expect(direct).toEqual([]);
    for (const helper of ["src/lib/agents/http.ts", "src/lib/corrections/http.ts", "src/lib/close-loop/http.ts", "src/lib/agents/onboarding/http.ts", "src/lib/work/http.ts", "src/lib/workspace/http.ts"]) {
      const src = readFileSync(join(ROOT, helper), "utf8");
      expect(src, helper).toMatch(/readJsonCapped|readJsonOrMarker/);
      expect(src, helper).not.toMatch(/\breq\.json\(\)/);
    }
  });
});
