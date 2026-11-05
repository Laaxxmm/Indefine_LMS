// GET/OPTIONS /api/firm-os/companion/next-task through the real route module and its production
// wiring (Prisma mocked, empty database). The full rules are tested in src/lib/companion/__tests__.
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
// These routes sit behind the Firm OS master switch (src/lib/workspace/flag.ts); it is on for these tests.
beforeEach(() => vi.stubEnv("FIRM_OS_ENABLED", "1"));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));

const { auth } = await import("@/lib/auth");
const { GET, OPTIONS } = await import("@/app/api/firm-os/companion/next-task/route");
const { MSG } = await import("@/lib/companion/messages");
const { COMPANION_EXTENSION_ID } = await import("@/lib/companion/config");
const { fakeToken } = await import("@/lib/companion/__tests__/fakes");
const { prismaCalls } = await import("./harness");

const EXT = "chrome-extension://" + "abcdefghijklmnop".repeat(2);
const url = "https://lms.indefine.in/api/firm-os/companion/next-task";

describe("/api/firm-os/companion/next-task route", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("never consults the session: a signed-in browser without a token gets 401", async () => {
    const r = await GET(new Request(url, { headers: { cookie: "authjs.session-token=abc" } }));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: MSG.tokenMissing });
    expect(auth).not.toHaveBeenCalled();
  });

  it("an unknown token is refused after one lookup by hash", async () => {
    prismaCalls.length = 0;
    const r = await GET(new Request(url, { headers: { authorization: `Bearer ${fakeToken("z")}` } }));
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe(MSG.tokenUnknown);
    expect(prismaCalls.map((c) => `${c.model}.${c.method}`)).toEqual(["companionToken.findUnique"]);
    expect(JSON.stringify(prismaCalls[0].args)).not.toContain(fakeToken("z"));
  });

  it("CORS allows the extension's fixed id by default, or exactly FIRM_OS_COMPANION_EXTENSION_ORIGIN when set", async () => {
    const pre = (origin: string) => OPTIONS(new Request(url, { method: "OPTIONS", headers: { origin } }));
    const own = `chrome-extension://${COMPANION_EXTENSION_ID}`;
    expect((await pre(own)).status).toBe(204);
    expect((await pre(EXT)).status).toBe(403);
    expect((await GET(new Request(url, { headers: { origin: EXT } }))).status).toBe(403);
    vi.stubEnv("FIRM_OS_COMPANION_EXTENSION_ORIGIN", EXT);
    expect((await pre(own)).status).toBe(403);
    const ok = await pre(EXT);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(EXT);
    expect((await pre("https://evil.example")).status).toBe(403);
    const r = await GET(new Request(url, { headers: { origin: EXT } }));
    expect(r.status).toBe(401);
    expect(r.headers.get("access-control-allow-origin")).toBe(EXT);
  });
});
