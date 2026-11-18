// Coach route plumbing. The heartbeat read `req.text()` and preferences `req.json()`: the whole body,
// however large, before anything was checked — a chunked body with no Content-Length was unbounded.
// Both now read with a running byte count (readBodyCapped / readJsonCapped) and answer 413 with a
// plain sentence past the cap, having pulled no more of the stream than the cap allows.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

const { auth } = await import("@/lib/auth");
const { HEARTBEAT_MAX_BYTES, PREFERENCES_MAX_BYTES, eventIdZ, parseBody, preferencesZ, refuseNonEmptyBody, requireCoachUser, requireOwnCoachUser, toJson } = await import("./http");
const { isPlainMessage } = await import("@/lib/errors");

const KB = 1024;
const mockAuth = auth as unknown as ReturnType<typeof vi.fn>;

/** A POST whose body streams `total` bytes in 16 KB chunks with no Content-Length; `pulled()` says how much was read. */
function streamed(total: number, byte = 0x20) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(16 * KB, total - sent);
      sent += n;
      c.enqueue(new Uint8Array(n).fill(byte));
    },
  });
  const req = new Request("http://localhost/api/firm-os/coach/heartbeat", { method: "POST", body, duplex: "half" } as RequestInit);
  return { req, pulled: () => sent };
}

const post = (body: string, headers: Record<string, string> = {}) => new Request("http://localhost/api/firm-os/coach/x", { method: "POST", body, headers });

describe("heartbeat body: empty or {} only, read no further than the cap", () => {
  it("PoC: a 10 MB chunked body with no Content-Length is cut off at the cap with a plain 413", async () => {
    const s = streamed(10 * 1024 * KB);
    const res = await refuseNonEmptyBody(s.req);
    expect(res?.status).toBe(413);
    const body = (await res!.json()) as { error: string };
    expect(isPlainMessage(body.error)).toBe(true);
    expect(s.pulled()).toBeLessThanOrEqual(HEARTBEAT_MAX_BYTES + 32 * KB); // never the whole body
  });

  it("a declared Content-Length over the cap is refused unread", async () => {
    const res = await refuseNonEmptyBody(post("{}", { "content-length": String(HEARTBEAT_MAX_BYTES + 1) }));
    expect(res?.status).toBe(413);
  });

  it("nothing or {} passes; anything else is a 400 with the same sentence as before", async () => {
    expect(await refuseNonEmptyBody(new Request("http://localhost/x", { method: "POST" }))).toBeNull();
    expect(await refuseNonEmptyBody(post(""))).toBeNull();
    expect(await refuseNonEmptyBody(post("  {}  "))).toBeNull();
    for (const b of ['{"page":"/clients/1"}', "[]", "null", "not json", '"x"']) {
      const res = await refuseNonEmptyBody(post(b));
      expect(res?.status, b).toBe(400);
      expect(((await res!.json()) as { error: string }).error).toBe("This check-in from the page should carry nothing, so it was refused. Reload the page.");
    }
  });

  it("a body that cannot be read is refused, not accepted", async () => {
    const body = new ReadableStream<Uint8Array>({ pull: (c) => c.error(new Error("socket closed")) });
    const res = await refuseNonEmptyBody(new Request("http://localhost/x", { method: "POST", body, duplex: "half" } as RequestInit));
    expect(res?.status).toBe(400);
  });
});

describe("preferences body: capped JSON, then the schema", () => {
  it("PoC: a streamed body far over the cap is a plain 413, not read to the end", async () => {
    const s = streamed(10 * 1024 * KB, 0x61);
    const r = await parseBody(preferencesZ, s.req);
    expect(r.res?.status).toBe(413);
    expect(isPlainMessage(((await r.res!.json()) as { error: string }).error)).toBe(true);
    expect(s.pulled()).toBeLessThanOrEqual(PREFERENCES_MAX_BYTES + 32 * KB);
  });

  it("valid settings pass; unknown keys and bad values are a 400 with a sentence", async () => {
    expect((await parseBody(preferencesZ, post(JSON.stringify({ breakNudges: false, snoozeMinutes: 30 })))).data).toEqual({ breakNudges: false, snoozeMinutes: 30 });
    const bad = await parseBody(preferencesZ, post(JSON.stringify({ snoozeMinutes: 1.5 })));
    expect(bad.res?.status).toBe(400);
    expect(((await bad.res!.json()) as { error: string }).error).toBe("Enter the snooze time as a whole number of minutes.");
    expect((await parseBody(preferencesZ, post(JSON.stringify({ other: 1 })))).res?.status).toBe(400);
    expect((await parseBody(preferencesZ, post("{oops"))).res?.status).toBe(400);
  });
});

describe("who may use the coach", () => {
  beforeEach(() => mockAuth.mockReset());

  it("signed out → 401, inactive → 403, active → the person", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await requireCoachUser()).res?.status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "u1", active: false } });
    expect((await requireCoachUser()).res?.status).toBe(403);
    mockAuth.mockResolvedValue({ user: { id: "u1", active: true } });
    expect((await requireCoachUser()).user?.id).toBe("u1");
  });

  it("own preferences: the owner is always the signed-in person", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", active: true } });
    expect(await requireOwnCoachUser()).toMatchObject({ ownerId: "u1" });
    mockAuth.mockResolvedValue({ user: { id: "u1", active: false } });
    expect((await requireOwnCoachUser()).res?.status).toBe(403);
  });

  it("event ids and results", async () => {
    expect(eventIdZ.safeParse("evt_1-a").success).toBe(true);
    expect(eventIdZ.safeParse("../x").success).toBe(false);
    expect((await toJson({ ok: true, data: { n: 1 } }).json()) as unknown).toEqual({ n: 1 });
    const res = toJson({ ok: false, status: 404, error: "That notice could not be found. Reload the page and try again." });
    expect(res.status).toBe(404);
  });
});
