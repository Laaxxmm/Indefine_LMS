// Security audit #17: the Neo Centra extension sent the WHOLE practice.turia.in cookie jar
// (including the HttpOnly accessToken) plus the relay token to a free-text https URL from the popup.
// Ported from the audit PoC (.audit-sec/secrets/area-a-secrets-config.test.ts "neo-centra: LMS
// target URL is user-configurable ... and the whole Turia cookie jar is sent"): the LMS origin is
// now pinned at build time and validated, only accessToken is sent, and the server stores only it.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ROOT = join(__dirname, "..", "..");
const DIR = join(ROOT, "neo-centra-extension");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
const PINNED = "https://lms.indefine.in";

const db = vi.hoisted(() => ({ upserts: [] as { create: { cookie: string } }[] }));
vi.mock("@/lib/prisma", () => ({ prisma: { neoTuriaSession: { upsert: async (a: { create: { cookie: string } }) => { db.upserts.push(a); return {}; }, findUnique: async () => null } } }));

type Listener = (...a: unknown[]) => unknown;

/** A minimal chrome.* for the service worker: cookies, storage, alarms, runtime messages. */
function fakeChrome(cookies: { name: string; value: string; path?: string }[], stored: Record<string, unknown>) {
  const listeners: Record<string, Listener[]> = {};
  const on = (name: string) => ({ addListener: (fn: Listener) => (listeners[name] ??= []).push(fn) });
  const chrome = {
    runtime: { id: "neo-ext-id", onInstalled: on("installed"), onStartup: on("startup"), onMessage: on("message") },
    alarms: { create: vi.fn(), onAlarm: on("alarm") },
    cookies: {
      onChanged: on("cookieChanged"),
      getAll: vi.fn(async (q: { domain: string; name?: string }) => cookies.filter((c) => !q.name || c.name === q.name).map((c) => ({ path: "/", domain: q.domain, ...c }))),
    },
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in stored).map((k) => [k, stored[k]]))),
        set: vi.fn(async (o: Record<string, unknown>) => Object.assign(stored, o)),
        remove: vi.fn(async (k: string) => void delete stored[k]),
      },
    },
    action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
  };
  return { chrome, listeners };
}

async function loadWorker(cookies: { name: string; value: string }[], stored: Record<string, unknown>) {
  vi.resetModules();
  const { chrome, listeners } = fakeChrome(cookies, stored);
  vi.stubGlobal("chrome", chrome);
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  });
  await import("../../neo-centra-extension/background.js" as string);
  const message = (msg: unknown, senderId = "neo-ext-id") =>
    new Promise<unknown>((resolve) => {
      const handled = listeners.message[0](msg, { id: senderId }, resolve);
      if (handled !== true) resolve("ignored");
    });
  return { calls, message, stored };
}

const JAR = [
  { name: "accessToken", value: "eyJhbGciOiJIUzI1NiJ9.turia-session.sig" },
  { name: "refreshToken", value: "rt-should-never-leave" },
  { name: "activeOrganizationId", value: "org-42" },
  { name: "_ga", value: "GA1.2.3" },
];

afterEach(() => vi.unstubAllGlobals());

describe("neo-centra-extension: pinned LMS origin", () => {
  it("config.js pins the origin; manifest host_permissions and CSP connect-src agree; the worker is a module that imports it", () => {
    expect(read("config.js")).toMatch(/export const LMS_ORIGIN = "https:\/\/lms\.indefine\.in";/);
    const manifest = JSON.parse(read("manifest.json"));
    expect(manifest.host_permissions).toEqual(["https://practice.turia.in/*", `${PINNED}/*`]);
    expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
    expect(manifest.content_security_policy.extension_pages).toBe(`script-src 'self'; object-src 'self'; connect-src ${PINNED} https://practice.turia.in`);
    const bg = read("background.js");
    expect(bg).toMatch(/import \{ LMS_ORIGIN \} from "\.\/config\.js";/);
    expect(bg).not.toMatch(/lmsUrl"\]|get\(\["lmsUrl"/); // the old free-text setting is never read
    expect(bg).not.toMatch(/cookies\.map\(\(c\) => `\$\{c\.name\}=\$\{c\.value\}`\)/); // no whole-jar header
    expect(read("popup.html")).not.toMatch(/<input id="lmsUrl"/);
    expect(bg).not.toMatch(/onMessageExternal/);
  });

  it("build.mjs only accepts https://host or http://localhost, never a path or a government host, and rewrites all three places", async () => {
    const { checkOrigin, rewrite } = await import("../../neo-centra-extension/build.mjs" as string);
    expect(checkOrigin("https://staging.example.in")).toBe("https://staging.example.in");
    expect(checkOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    for (const bad of ["http://evil.example", "https://x.example/path", "https://u:p@x.example", "https://portal.karnataka.gov.in", "javascript:alert(1)", "not a url"]) expect(checkOrigin(bad), bad).toBeNull();
    const out = rewrite(read("manifest.json"), read("config.js"), "https://staging.example.in");
    const m = JSON.parse(out.manifest);
    expect(m.host_permissions).toEqual(["https://practice.turia.in/*", "https://staging.example.in/*"]);
    expect(m.content_security_policy.extension_pages).toContain("connect-src https://staging.example.in https://practice.turia.in");
    expect(out.config).toContain('export const LMS_ORIGIN = "https://staging.example.in";');
  });
});

describe("neo-centra-extension: what the service worker sends", () => {
  it("sends ONLY the accessToken cookie, to the pinned origin, even when an old free-text lmsUrl is stored", async () => {
    const { calls, message, stored } = await loadWorker(JAR, { relayToken: "relay-tok-1", lmsUrl: "https://evil.example" });
    expect(await message({ type: "SYNC_NOW" })).toEqual({ ok: true });
    const lms = calls.filter((c) => !c.url.startsWith("https://practice.turia.in/"));
    expect(lms).toHaveLength(1);
    expect(lms[0].url).toBe(`${PINNED}/api/tools/neo-centra/turia-cookie`);
    expect(JSON.parse(String(lms[0].init.body))).toEqual({ cookie: "accessToken=eyJhbGciOiJIUzI1NiJ9.turia-session.sig" });
    expect(String(lms[0].init.body)).not.toMatch(/refreshToken|activeOrganizationId|_ga/);
    expect((lms[0].init.headers as Record<string, string>).Authorization).toBe("Bearer relay-tok-1");
    expect(lms[0].init.redirect).toBe("error");
    expect(calls.some((c) => c.url.includes("evil.example"))).toBe(false);
    // SET_CONFIG takes the relay token only; GET_STATE reports the pinned origin.
    await message({ type: "SET_CONFIG", relayToken: "relay-tok-2", lmsUrl: "https://evil.example" });
    expect(stored.relayToken).toBe("relay-tok-2");
    expect(await message({ type: "GET_STATE" })).toMatchObject({ lmsOrigin: PINNED, relayToken: "relay-tok-2" });
  });

  it("ignores messages from anything but its own popup; sends nothing without an accessToken", async () => {
    const w = await loadWorker([{ name: "_ga", value: "x" }], { relayToken: "relay-tok-1" });
    expect(await w.message({ type: "SYNC_NOW" }, "some-other-extension")).toBe("ignored");
    expect(await w.message({ type: "SYNC_NOW" })).toEqual({ ok: false, reason: "no-token" });
    expect(w.calls.filter((c) => c.url.startsWith(PINNED))).toEqual([]);
  });
});

describe("relay endpoint storage (src/lib/neo-centra/turia.ts)", () => {
  beforeEach(() => {
    db.upserts = [];
    vi.stubEnv("NEO_TURIA_COOKIE_KEY", randomBytes(32).toString("hex"));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stores only accessToken, sealed, whatever else the caller sends; refuses a header without one", async () => {
    vi.resetModules();
    const { storeTuriaCookie, turiaAccessTokenCookie, TuriaSessionError } = await import("@/lib/neo-centra/turia");
    const { open, keyFromEnv } = await import("@/lib/secret-box");
    await storeTuriaCookie("refreshToken=rt-1; accessToken=tok-abcdefgh; activeOrganizationId=org-42; _ga=GA1");
    const stored = db.upserts.at(-1)!.create.cookie;
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(open(stored, keyFromEnv("NEO_TURIA_COOKIE_KEY"))).toBe("accessToken=tok-abcdefgh");
    await expect(storeTuriaCookie("refreshToken=rt-1; _ga=GA1")).rejects.toBeInstanceOf(TuriaSessionError);
    expect(turiaAccessTokenCookie("accessToken=has space")).toBeNull();
    expect(turiaAccessTokenCookie("accessToken=short")).toBeNull();
    expect(turiaAccessTokenCookie("accessToken=a\r\nX-Injected: 1")).toBeNull();
    expect(db.upserts).toHaveLength(1);
  });
});
