// Pairing tokens: creation (hash only stored, audit without the token), the active limit, revoke
// by UPDATE, expiry after 90 days, verification (constant-time compare, lastUsedAt on every use).
import { beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({ timingSafeEqual: undefined as unknown as ReturnType<typeof vi.fn> }));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  spies.timingSafeEqual = vi.fn(actual.timingSafeEqual);
  return { ...actual, default: actual, timingSafeEqual: spies.timingSafeEqual };
});

const { createHash } = await import("node:crypto");
const tokens = await import("../tokens");
const { CompanionError } = await import("../errors");
const { MSG } = await import("../messages");
const { COMPANION_MAX_ACTIVE_TOKENS, COMPANION_TOKEN_TTL_DAYS } = await import("../config");
const { asSession, fakeDb, fakeToken, user } = await import("./fakes");
const { createPairing, generateToken, hashToken, hashesEqual, isTokenShape, listPairings, normaliseLabel, readBearer, revokePairing, tokenExpiresAt, tokenStatus, verifyPairing } = tokens;

const NOW = new Date("2026-11-05T06:30:00Z"); // 05 Nov 2026 12:00 IST
const DAY = 86_400_000;
const bytes = (n: number, fill = 7) => Buffer.alloc(n, fill);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const partner = user({ id: "u-partner", level: "PARTNER" });
const staff = user({ id: "u-staff" });
const admin = user({ id: "u-admin", role: "ADMIN" });

describe("token format and hashing", () => {
  it("is fosc_ + 32 random bytes in base64url (43 chars), from crypto randomness by default", () => {
    const t = generateToken(bytes);
    expect(t).toBe("fosc_" + Buffer.alloc(32, 7).toString("base64url"));
    expect(t).toHaveLength(48);
    expect(isTokenShape(t)).toBe(true);
    const a = generateToken();
    const b = generateToken();
    expect(isTokenShape(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(() => generateToken(() => Buffer.alloc(16))).toThrow(/wrong number of bytes/);
  });

  it("rejects anything that is not token-shaped", () => {
    expect(isTokenShape(fakeToken())).toBe(true);
    for (const bad of ["", "fosc_", fakeToken().slice(0, -1), fakeToken() + "a", fakeToken().replace("fosc_", "fosx_"), "fosc_" + "!".repeat(43), ` ${fakeToken()}`]) {
      expect(isTokenShape(bad)).toBe(false);
    }
  });

  it("stores sha256 hex and compares digests in constant time", () => {
    const t = fakeToken("b");
    expect(hashToken(t)).toBe(sha(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    spies.timingSafeEqual.mockClear();
    expect(hashesEqual(hashToken(t), hashToken(t))).toBe(true);
    expect(hashesEqual(hashToken(t), hashToken(fakeToken("c")))).toBe(false);
    expect(spies.timingSafeEqual).toHaveBeenCalledTimes(2);
    const [x, y] = spies.timingSafeEqual.mock.calls[0] as [Buffer, Buffer];
    expect(x.length).toBe(32);
    expect(y.length).toBe(32);
    // Not a digest → false without comparing (timingSafeEqual would throw on unequal lengths).
    spies.timingSafeEqual.mockClear();
    expect(hashesEqual("abc", hashToken(t))).toBe(false);
    expect(hashesEqual(hashToken(t).toUpperCase(), hashToken(t))).toBe(false);
    expect(spies.timingSafeEqual).not.toHaveBeenCalled();
  });

  it("reads the bearer token from the Authorization header", () => {
    expect(readBearer(`Bearer ${fakeToken()}`)).toBe(fakeToken());
    expect(readBearer(`bearer   ${fakeToken()}  `)).toBe(fakeToken());
    for (const h of [null, undefined, "", "Bearer", "Bearer ", `Basic ${fakeToken()}`, `Bearer ${fakeToken()} extra`]) expect(readBearer(h)).toBeNull();
  });

  it("cleans labels and refuses empty or long ones with plain sentences", () => {
    expect(normaliseLabel("  Office\tdesktop \n Chrome ")).toBe("Office desktop Chrome");
    expect(() => normaliseLabel("   ")).toThrow(MSG.labelRequired);
    expect(() => normaliseLabel("x".repeat(61))).toThrow(MSG.labelTooLong);
    expect(normaliseLabel("x".repeat(60))).toHaveLength(60);
  });
});

describe("expiry", () => {
  it("expires 90 days after creation (data, not a column)", () => {
    expect(COMPANION_TOKEN_TTL_DAYS).toBe(90);
    expect(tokenExpiresAt(NOW).getTime() - NOW.getTime()).toBe(90 * DAY);
    const row = { createdAt: NOW, revokedAt: null };
    expect(tokenStatus(row, new Date(NOW.getTime() + 90 * DAY - 1))).toBe("active");
    expect(tokenStatus(row, new Date(NOW.getTime() + 90 * DAY))).toBe("expired");
    expect(tokenStatus({ createdAt: NOW, revokedAt: NOW }, NOW)).toBe("revoked");
  });
});

describe("createPairing", () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    db = fakeDb({ users: [partner, staff, admin] });
  });

  it("returns the token once and stores only its sha256, with the label", async () => {
    const { token, pairing } = await createPairing(db as never, asSession(partner), "  Office desktop ", NOW, bytes);
    expect(isTokenShape(token)).toBe(true);
    expect(db.tokens).toHaveLength(1);
    const row = db.tokens[0];
    expect(row.tokenHash).toBe(sha(token));
    expect(row).toMatchObject({ userId: "u-partner", label: "Office desktop", revokedAt: null, lastUsedAt: null });
    expect(JSON.stringify(db.tokens)).not.toContain(token);
    expect(pairing).toEqual({ id: row.id, label: "Office desktop", created: "05 Nov 2026", lastUsed: null, expires: "03 Feb 2027" });
  });

  it("writes an AuditEvent without the token or its hash", async () => {
    const { token } = await createPairing(db as never, asSession(partner), "Laptop", NOW, bytes);
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({ actorId: "u-partner", action: "create", entity: "CompanionToken", entityId: db.tokens[0].id });
    const meta = JSON.stringify(db.audits[0]);
    expect(meta).not.toContain(token);
    expect(meta).not.toContain(db.tokens[0].tokenHash);
    expect(meta).toContain("read:next-task");
  });

  it("is allowed for admins, partners and people whose companion setting is on; refused otherwise", async () => {
    await expect(createPairing(db as never, asSession(admin), "A", NOW)).resolves.toBeTruthy();
    await expect(createPairing(db as never, asSession(staff), "S", NOW)).rejects.toThrow(MSG.noAccess);
    db.settings["u-staff"] = false;
    await expect(createPairing(db as never, asSession(staff), "S", NOW)).rejects.toMatchObject({ status: 403 });
    db.settings["u-staff"] = true;
    await expect(createPairing(db as never, asSession(staff), "S", NOW)).resolves.toBeTruthy();
    await expect(createPairing(db as never, asSession(user({ id: "u-gone", level: "PARTNER", active: false })), "X", NOW)).rejects.toBeInstanceOf(CompanionError);
    expect(db.tokens.map((t) => t.userId)).toEqual(["u-admin", "u-staff"]);
  });

  it(`allows at most ${COMPANION_MAX_ACTIVE_TOKENS} active pairings; revoked and expired ones do not count`, async () => {
    db.tokens.push({ id: "old", userId: "u-partner", tokenHash: sha("old"), label: "Old", createdAt: new Date(NOW.getTime() - 91 * DAY), lastUsedAt: null, revokedAt: null });
    db.tokens.push({ id: "rev", userId: "u-partner", tokenHash: sha("rev"), label: "Rev", createdAt: NOW, lastUsedAt: null, revokedAt: NOW });
    for (let i = 0; i < COMPANION_MAX_ACTIVE_TOKENS; i++) await createPairing(db as never, asSession(partner), `P${i}`, NOW);
    const over = createPairing(db as never, asSession(partner), "One more", NOW);
    await expect(over).rejects.toThrow(MSG.tooManyActive);
    await expect(createPairing(db as never, asSession(partner), "One more", NOW)).rejects.toMatchObject({ status: 409 });
    expect(db.tokens).toHaveLength(2 + COMPANION_MAX_ACTIVE_TOKENS);
  });
});

describe("revokePairing", () => {
  it("sets revokedAt with an UPDATE, keeps the row and audits once", async () => {
    const db = fakeDb({ users: [partner] });
    const { pairing } = await createPairing(db as never, asSession(partner), "Laptop", NOW);
    const later = new Date(NOW.getTime() + DAY);
    await expect(revokePairing(db as never, asSession(partner), pairing.id, later)).resolves.toEqual({ revoked: true });
    expect(db.tokens).toHaveLength(1);
    expect(db.tokens[0].revokedAt).toEqual(later);
    expect(db.calls.filter((c) => c.model === "companionToken").map((c) => c.method)).toEqual(["findMany", "create", "findFirst", "update"]);
    expect(db.audits.map((a) => a.action)).toEqual(["create", "revoke"]);
    // Again: nothing changes, no second audit event.
    await expect(revokePairing(db as never, asSession(partner), pairing.id, later)).resolves.toEqual({ revoked: false });
    expect(db.audits).toHaveLength(2);
  });

  it("only revokes the person's own pairings", async () => {
    const db = fakeDb({ users: [partner, staff] });
    const { pairing } = await createPairing(db as never, asSession(partner), "Laptop", NOW);
    await expect(revokePairing(db as never, asSession(staff), pairing.id, NOW)).rejects.toThrow(MSG.pairingNotFound);
    await expect(revokePairing(db as never, asSession(staff), pairing.id, NOW)).rejects.toMatchObject({ status: 404 });
    expect(db.tokens[0].revokedAt).toBeNull();
  });

  it("has no way to remove a pairing (the service and its database surface only update)", () => {
    const exported = Object.keys(tokens);
    expect(exported.filter((k) => /delete|remove|purge|destroy|drop/i.test(k))).toEqual([]);
    expect(Object.keys(fakeDb().companionToken).sort()).toEqual(["create", "findFirst", "findMany", "findUnique", "update"]);
  });
});

describe("verifyPairing", () => {
  const seed = (overrides: Partial<{ createdAt: Date; revokedAt: Date | null }> = {}) => {
    const t = fakeToken("v");
    const db = fakeDb({ tokens: [{ id: "tok-v", userId: "u-staff", tokenHash: sha(t), label: "Laptop", createdAt: NOW, lastUsedAt: null, revokedAt: null, ...overrides }] });
    return { t, db };
  };

  it("accepts a live token and updates lastUsedAt at most every 10 minutes", async () => {
    const { t, db } = seed();
    await expect(verifyPairing(db as never, t, NOW)).resolves.toEqual({ ok: true, tokenId: "tok-v", userId: "u-staff" });
    expect(db.tokens[0].lastUsedAt).toEqual(NOW);
    await verifyPairing(db as never, t, new Date(NOW.getTime() + 60_000)); // the next poll: no write
    expect(db.tokens[0].lastUsedAt).toEqual(NOW);
    const later = new Date(NOW.getTime() + 10 * 60_000);
    await verifyPairing(db as never, t, later);
    expect(db.tokens[0].lastUsedAt).toEqual(later);
  });

  it("refuses missing, malformed (without a query), unknown, revoked and expired tokens", async () => {
    const { db } = seed();
    await expect(verifyPairing(db as never, null, NOW)).resolves.toEqual({ ok: false, reason: "missing" });
    await expect(verifyPairing(db as never, "not-a-token", NOW)).resolves.toEqual({ ok: false, reason: "unknown" });
    expect(db.calls).toEqual([]);
    await expect(verifyPairing(db as never, fakeToken("w"), NOW)).resolves.toEqual({ ok: false, reason: "unknown" });

    const revoked = seed({ revokedAt: NOW });
    await expect(verifyPairing(revoked.db as never, revoked.t, NOW)).resolves.toEqual({ ok: false, reason: "revoked" });
    const expired = seed({ createdAt: new Date(NOW.getTime() - 90 * DAY) });
    await expect(verifyPairing(expired.db as never, expired.t, NOW)).resolves.toEqual({ ok: false, reason: "expired" });
    // Refused tokens are not marked used.
    expect(revoked.db.tokens[0].lastUsedAt).toBeNull();
    expect(expired.db.tokens[0].lastUsedAt).toBeNull();
    expect(db.tokens[0].lastUsedAt).toBeNull();
  });

  it("compares the stored and computed hashes in constant time after the lookup", async () => {
    const { t, db } = seed();
    spies.timingSafeEqual.mockClear();
    await verifyPairing(db as never, t, NOW);
    expect(spies.timingSafeEqual).toHaveBeenCalledTimes(1);
    // A row whose stored hash does not match (corrupted) is treated as unknown.
    db.tokens[0].tokenHash = sha("something else");
    const lookup = db.companionToken.findUnique;
    db.companionToken.findUnique = async () => ({ ...db.tokens[0] });
    await expect(verifyPairing(db as never, t, NOW)).resolves.toEqual({ ok: false, reason: "unknown" });
    db.companionToken.findUnique = lookup;
  });
});

describe("listPairings", () => {
  it("lists active pairings newest first with DD MMM YYYY dates and IST last use; counts the rest", async () => {
    const db = fakeDb({
      tokens: [
        { id: "a", userId: "u-staff", tokenHash: sha("a"), label: "Desk", createdAt: new Date("2026-10-01T04:00:00Z"), lastUsedAt: new Date("2026-11-04T09:15:00Z"), revokedAt: null },
        { id: "b", userId: "u-staff", tokenHash: sha("b"), label: null, createdAt: new Date("2026-11-02T04:00:00Z"), lastUsedAt: null, revokedAt: null },
        { id: "c", userId: "u-staff", tokenHash: sha("c"), label: "Gone", createdAt: new Date("2026-10-02T04:00:00Z"), lastUsedAt: null, revokedAt: new Date("2026-10-03T04:00:00Z") },
        { id: "d", userId: "u-staff", tokenHash: sha("d"), label: "Old", createdAt: new Date("2026-07-01T04:00:00Z"), lastUsedAt: null, revokedAt: null },
        { id: "e", userId: "u-other", tokenHash: sha("e"), label: "Not mine", createdAt: NOW, lastUsedAt: null, revokedAt: null },
      ],
    });
    const { active, inactiveCount } = await listPairings(db as never, "u-staff", NOW);
    expect(active).toEqual([
      { id: "b", label: "Unnamed pairing", created: "02 Nov 2026", lastUsed: null, expires: "31 Jan 2027" },
      { id: "a", label: "Desk", created: "01 Oct 2026", lastUsed: "04 Nov 2026 14:45 IST", expires: "30 Dec 2026" },
    ]);
    expect(inactiveCount).toBe(2);
  });
});
