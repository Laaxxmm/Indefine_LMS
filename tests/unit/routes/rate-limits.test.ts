// Firm OS rate limits on the shared database limiter (src/lib/hardening/rate-limit.ts):
// comms drafting is refused with 429 before any draft work; identifier lookups and the
// Companion's next-task use the database limiter through their own seams (production wiring).
import { beforeEach, describe, expect, it, vi } from "vitest";
// These routes sit behind the Firm OS master switch (src/lib/workspace/flag.ts); it is on for these tests.
beforeEach(() => vi.stubEnv("FIRM_OS_ENABLED", "1"));
import { activeSession } from "./harness";

// RateLimitBucket through the app's Prisma client: the upsert returns the count after this request.
const bucket = vi.hoisted(() => ({ count: 1, windowStart: new Date(), keys: [] as unknown[] }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: async (_q: TemplateStringsArray, ...values: unknown[]) => {
      bucket.keys.push(values[0]);
      return [{ count: bucket.count, windowStart: bucket.windowStart }];
    },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
const drafting = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/agents/comms/defaults", () => ({
  commsDeps: () => {
    drafting.calls += 1;
    throw new Error("draft work must not start when the person is over the limit");
  },
}));

const { auth } = await import("@/lib/auth");
const drafts = await import("@/app/api/firm-os/comms/drafts/route");
const { identifierRateLimiter, databaseIdentifierRateLimiter } = await import("@/lib/search/rate-limit");
const { databaseCompanionRateLimiter } = await import("@/lib/companion/rate-limit");
const { nextTaskDeps } = await import("@/lib/companion/defaults");

const post = (body: unknown) => new Request("http://x/api/firm-os/comms/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  bucket.count = 1;
  bucket.windowStart = new Date();
  bucket.keys.length = 0;
  drafting.calls = 0;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(activeSession({ id: "u-priya" }));
});

describe("comms drafting", () => {
  it("the 31st draft in the hour gets 429 with Retry-After and a plain sentence, counted per person, before any draft work", async () => {
    bucket.count = 31;
    bucket.windowStart = new Date(Date.now() - 20 * 60_000);
    const r = await drafts.POST(post({ kind: "status", jobId: "jt-1" }));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    const body = await r.json();
    expect(body.error).toBe("You have made too many draft messages in an hour (the limit is 30). Wait 40 minutes, then try again.");
    expect(body.error).not.toMatch(/\b429\b|rate.?limit/i);
    expect(bucket.keys).toEqual(["comms-draft:u-priya"]);
    expect(drafting.calls).toBe(0);
  });

  it("signed-out and unreadable requests are refused before counting", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect((await drafts.POST(post({ kind: "status" }))).status).toBe(401);
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(activeSession({ id: "u-priya" }));
    const bad = await drafts.POST(new Request("http://x/api", { method: "POST", body: "not json" }));
    expect(bad.status).toBe(400);
    expect(bucket.keys).toEqual([]);
  });
});

describe("identifier lookups and the Companion use the database limiter", () => {
  it("search's default identifier limiter counts in RateLimitBucket per person (10 in 10 minutes)", async () => {
    const lim = identifierRateLimiter();
    expect(await lim.hit("identifier-search:u-priya", new Date())).toEqual({ ok: true, remaining: 9 });
    bucket.count = 11;
    expect(await databaseIdentifierRateLimiter().hit("identifier-search:u-priya", new Date())).toMatchObject({ ok: false, retryAfterSeconds: expect.any(Number) });
    expect(bucket.keys).toEqual(["identifier-search:u-priya", "identifier-search:u-priya"]);
  });

  it("the Companion's next-task route is wired to the database limiter, counted per pairing token (20 a minute)", async () => {
    expect(nextTaskDeps().limiter).toBe(databaseCompanionRateLimiter);
    expect(await databaseCompanionRateLimiter.hit("companion:abc123", new Date())).toEqual({ ok: true, remaining: 19 });
    bucket.count = 21;
    expect(await databaseCompanionRateLimiter.hit("companion:abc123", new Date())).toMatchObject({ ok: false, retryAfterSec: expect.any(Number) });
    expect(bucket.keys).toEqual(["companion:abc123", "companion:abc123"]);
  });
});
