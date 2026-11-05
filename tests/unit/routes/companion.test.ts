// /companion page and its pairing routes: who may pair, what the page shows, and the 401/403/400
// answers of POST /api/firm-os/companion/tokens and …/tokens/[id]/revoke.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { activeSession, redirectTarget, renderHtml } from "./harness";
import type { FakeDb } from "@/lib/companion/__tests__/fakes";

// Firm OS switched on for these tests (FIRM_OS_ENABLED defaults off: src/lib/workspace/flag.ts).
beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const state = vi.hoisted(() => ({ fake: null as unknown as FakeDb }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
// The companion's models come from the in-memory fake; everything else from the empty-database mock.
vi.mock("@/lib/prisma", async () => {
  const { prismaMock } = await import("./harness");
  const { fakeDb } = await import("@/lib/companion/__tests__/fakes");
  state.fake = fakeDb();
  const own = new Set(["companionToken", "workspaceSetting", "auditEvent", "user", "$transaction"]);
  return { prisma: new Proxy({}, { get: (_t, k: string) => (own.has(k) ? (state.fake as unknown as Record<string, unknown>)[k] : prismaMock[k]) }) };
});

const { auth } = await import("@/lib/auth");
const { fakeDb } = await import("@/lib/companion/__tests__/fakes");
const { MSG } = await import("@/lib/companion/messages");
const { default: CompanionLayout } = await import("@/app/companion/layout");
const { default: CompanionPage } = await import("@/app/companion/page");
const createRoute = (await import("@/app/api/firm-os/companion/tokens/route")).POST;
const revokeRoute = (await import("@/app/api/firm-os/companion/tokens/[id]/revoke/route")).POST;

const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const partner = () => activeSession({ id: "u-partner", level: "PARTNER" });
const staff = () => activeSession({ id: "u-staff" });
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const post = (body: unknown) => new Request("http://x/api/firm-os/companion/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const revoke = (id: string) => revokeRoute(new Request("http://x/api", { method: "POST" }), { params: Promise.resolve({ id }) });
const page = async () => renderHtml(await CompanionLayout({ children: await CompanionPage() }));
// The prisma proxy reads state.fake on every access, so a fresh fake per test is enough.
const reset = () => {
  state.fake = fakeDb();
};

describe("/companion page", () => {
  beforeEach(() => {
    reset();
    signedIn(partner());
  });

  it("renders the pairing form, the empty list and the set-up steps for a partner", async () => {
    const html = (await page()).replace(/<!-- -->/g, "");
    expect(html).toContain("Companion");
    expect(html).toContain("Pair a browser");
    expect(html).toContain('for="companion-label"');
    expect(html).toContain("Create pairing token");
    expect(html).toContain("No active pairings");
    expect(html).toContain("How to set it up");
    expect(html).toContain("never files, signs, pays or sends anything");
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/companion">Companion</a>');
    expect(html).not.toContain("text-ink-faint"); // ~2:1 on white, below AA
    expect(html).not.toMatch(/submit to portal/i);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("lists active pairings with DD MMM YYYY dates, last use in IST and a Revoke button per row", async () => {
    state.fake.tokens.push(
      { id: "p1", userId: "u-partner", tokenHash: sha("p1"), label: "Desk", createdAt: new Date("2026-11-01T04:00:00Z"), lastUsedAt: null, revokedAt: null },
      { id: "p2", userId: "u-partner", tokenHash: sha("p2"), label: "Laptop", createdAt: new Date("2026-10-20T04:00:00Z"), lastUsedAt: new Date("2026-11-05T05:00:00Z"), revokedAt: null },
      { id: "p3", userId: "u-partner", tokenHash: sha("p3"), label: "Old", createdAt: new Date("2026-10-20T04:00:00Z"), lastUsedAt: null, revokedAt: new Date("2026-10-21T04:00:00Z") },
    );
    const html = (await page()).replace(/<!-- -->/g, "");
    expect(html).toContain("Active pairings (2)");
    expect(html).toContain("Desk");
    expect(html).toContain("01 Nov 2026");
    expect(html).toContain("Not used yet");
    expect(html).toContain("05 Nov 2026 10:30 IST");
    expect(html).toContain("30 Jan 2027"); // Desk expires 90 days after 01 Nov 2026
    expect(html).toContain('aria-label="Revoke Laptop"');
    expect(html).not.toContain(">Old<");
    expect(html).toContain("1 revoked or expired pairing is kept for the record");
    expect(html).not.toContain(sha("p1")); // hashes never reach the page
  });

  it("people without companion access: the layout sends them to the dashboard, which says why", async () => {
    signedIn(staff());
    expect(await redirectTarget(() => CompanionLayout({ children: null }))).toBe("/dashboard?module-off=companion");
    expect(state.fake.calls.some((c) => c.model === "companionToken")).toBe(false);
  });

  it("the page itself also tells people without companion access why, and reads no pairings for them", async () => {
    signedIn(staff());
    const html = await renderHtml(await CompanionPage());
    expect(html).toContain("Not turned on for you");
    expect(html).toContain(MSG.noAccess.replace("'", "&#x27;"));
    expect(html).not.toContain("Create pairing token");
    expect(state.fake.calls.some((c) => c.model === "companionToken")).toBe(false);
  });

  it("shows the form to staff whose companion setting is on", async () => {
    state.fake.settings["u-staff"] = true;
    signedIn(staff());
    expect(await page()).toContain("Create pairing token");
  });

  it("sends signed-out visitors to sign-in", async () => {
    signedIn(null);
    expect(await redirectTarget(() => CompanionLayout({ children: null }))).toBe("/");
    expect(await redirectTarget(() => CompanionPage())).toBe("/");
  });
});

describe("POST /api/firm-os/companion/tokens", () => {
  beforeEach(() => {
    reset();
    signedIn(partner());
  });

  it("401 signed out, 403 inactive or without companion access — nothing stored", async () => {
    signedIn(null);
    const out = await createRoute(post({ label: "Desk" }));
    expect(out.status).toBe(401);
    expect((await out.json()).error).toBe(MSG.signedOut);
    signedIn(activeSession({ id: "u-partner", level: "PARTNER", active: false }));
    expect((await createRoute(post({ label: "Desk" }))).status).toBe(403);
    signedIn(staff());
    const denied = await createRoute(post({ label: "Desk" }));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toBe(MSG.noAccess);
    expect(state.fake.tokens).toEqual([]);
  });

  it("400 with a plain sentence for a missing, empty or malformed label", async () => {
    for (const body of [{}, { label: 5 }, "not json"]) {
      const r = await createRoute(post(body));
      expect(r.status).toBe(400);
      const { error } = await r.json();
      expect([MSG.labelRequired, MSG.badRequest]).toContain(error);
    }
    const blank = await createRoute(post({ label: "   " }));
    expect(blank.status).toBe(400);
    expect((await blank.json()).error).toBe(MSG.labelRequired);
  });

  it("201 with the token once; only its hash is stored; not cached", async () => {
    const r = await createRoute(post({ label: "Office desktop" }));
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(body.token).toMatch(/^fosc_[A-Za-z0-9_-]{43}$/);
    expect(body.pairing).toMatchObject({ label: "Office desktop", lastUsed: null });
    expect(state.fake.tokens[0].tokenHash).toBe(sha(body.token));
    expect(state.fake.audits[0]).toMatchObject({ action: "create", entity: "CompanionToken", actorId: "u-partner" });
  });
});

describe("POST /api/firm-os/companion/tokens/[id]/revoke", () => {
  beforeEach(() => {
    reset();
    signedIn(partner());
    state.fake.tokens.push({ id: "p1", userId: "u-partner", tokenHash: sha("p1"), label: "Desk", createdAt: new Date(), lastUsedAt: null, revokedAt: null });
  });

  it("revokes the person's own pairing by setting revokedAt", async () => {
    const r = await revoke("p1");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ revoked: true });
    expect(state.fake.tokens[0].revokedAt).toBeInstanceOf(Date);
    expect(state.fake.tokens).toHaveLength(1);
    expect(state.fake.audits.map((a) => a.action)).toEqual(["revoke"]);
  });

  it("401 signed out, 404 for someone else's or an unknown pairing, 400 for a bad id", async () => {
    signedIn(null);
    expect((await revoke("p1")).status).toBe(401);
    signedIn(staff());
    const other = await revoke("p1");
    expect(other.status).toBe(404);
    expect((await other.json()).error).toBe(MSG.pairingNotFound);
    signedIn(partner());
    expect((await revoke("nope")).status).toBe(404);
    expect((await revoke("../etc")).status).toBe(400);
    expect(state.fake.tokens[0].revokedAt).toBeNull();
  });
});
