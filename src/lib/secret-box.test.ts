// Security audit #15 / #16. Ported from the audit PoC (.audit-sec/secrets/area-a-secrets-config.test.ts):
//   - open() returned ANY unprefixed value verbatim even with a key configured, so a database writer
//     could swap in an attacker-chosen Graph refresh token or Turia cookie (confused deputy);
//   - sealGraphToken stored plaintext when GRAPH_TOKEN_KEY was unset, in production too.
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  account: null as null | Record<string, unknown>,
  turia: null as null | { cookie: string },
  upserts: [] as unknown[],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    account: { findFirst: async () => db.account, update: async () => ({}) },
    neoTuriaSession: { findUnique: async () => db.turia, upsert: async (a: unknown) => { db.upserts.push(a); return {}; } },
  },
}));

import { LEGACY_PLAINTEXT_ENV, PlaintextSecretError, keyFromEnv, legacyPlaintextAllowed, open, seal } from "./secret-box";

const hexKey = () => randomBytes(32).toString("hex");

beforeEach(() => {
  db.account = null;
  db.turia = null;
  db.upserts = [];
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());

describe("secret-box: a configured key means ciphertext only (PoC #15)", () => {
  it("refuses an unprefixed (plaintext) value when a key is configured", () => {
    vi.stubEnv(LEGACY_PLAINTEXT_ENV, "");
    const key = randomBytes(32);
    expect(open(seal("real-token", key), key)).toBe("real-token");
    expect(() => open("attacker-chosen-token", key, "Microsoft Graph token")).toThrow(PlaintextSecretError);
    expect(() => open("attacker-chosen-token", key, "Microsoft Graph token")).toThrow(/stored Microsoft Graph token is not encrypted, so it was refused/);
    // A sealed value made with another key is still rejected by the GCM tag.
    expect(() => open(seal("x", randomBytes(32)), key)).toThrow();
  });

  it("LEGACY_PLAINTEXT_SECRETS=true reads plaintext during a migration, logged once per kind", () => {
    vi.stubEnv(LEGACY_PLAINTEXT_ENV, "true");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const key = randomBytes(32);
    expect(legacyPlaintextAllowed()).toBe(true);
    expect(open("legacy-a", key, "legacy test secret")).toBe("legacy-a");
    expect(open("legacy-b", key, "legacy test secret")).toBe("legacy-b");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/LEGACY_PLAINTEXT_SECRETS=true: read an unencrypted legacy test secret/));
    expect(legacyPlaintextAllowed({ [LEGACY_PLAINTEXT_ENV]: "1" })).toBe(false); // only the word true
  });

  it("without a key, plaintext passes and a sealed value fails loudly; keys must be 64 hex", () => {
    expect(open("plain", null)).toBe("plain");
    expect(() => open(seal("x", randomBytes(32)), null)).toThrow(/no key/);
    vi.stubEnv("SB_T", "ab".repeat(31));
    expect(() => keyFromEnv("SB_T")).toThrow(/64 hex/);
  });
});

describe("Graph tokens (src/lib/graph.ts, PoC #16)", () => {
  it("production without GRAPH_TOKEN_KEY: refuses to store a token (null) and logs one plain admin message", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GRAPH_TOKEN_KEY", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sealGraphToken, graphTokenStorageStatus } = await import("@/lib/graph");
    expect(sealGraphToken("EwB-refresh-token")).toBeNull();
    expect(sealGraphToken("EwB-access-token")).toBeNull();
    expect(sealGraphToken(undefined)).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/GRAPH_TOKEN_KEY is not set, so Microsoft 365 sign-in tokens are not being saved\. Ask the admin to set GRAPH_TOKEN_KEY/));
    expect(err).not.toHaveBeenCalledWith(expect.stringContaining("stored unencrypted"));
    expect(graphTokenStorageStatus()).toEqual({ ok: false, message: expect.stringMatching(/^GRAPH_TOKEN_KEY is not set/) });
  });

  it("production without the key: a stored plaintext token is not used (no Graph call)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GRAPH_TOKEN_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    db.account = { provider: "microsoft-entra-id", providerAccountId: "p1", access_token: "plain-access", refresh_token: "plain-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, scope: "x" };
    const { getUserGraphToken } = await import("@/lib/graph");
    expect(await getUserGraphToken("u1", "x")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("with the key: tokens are sealed; a row swapped to plaintext by a DB writer is refused", async () => {
    vi.stubEnv("GRAPH_TOKEN_KEY", hexKey());
    vi.stubEnv(LEGACY_PLAINTEXT_ENV, "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { sealGraphToken, getUserGraphToken, graphTokenStorageStatus } = await import("@/lib/graph");
    expect(sealGraphToken("tok")?.startsWith("enc:v1:")).toBe(true);
    expect(graphTokenStorageStatus()).toEqual({ ok: true, message: null });
    const future = Math.floor(Date.now() / 1000) + 3600;
    db.account = { provider: "microsoft-entra-id", providerAccountId: "p1", access_token: sealGraphToken("good-access"), refresh_token: null, expires_at: future, scope: "x" };
    expect(await getUserGraphToken("u1", "x")).toBe("good-access");
    db.account = { ...db.account, access_token: "attacker-access" };
    expect(await getUserGraphToken("u1", "x")).toBeNull();
  });

  it("outside production a missing key still stores plaintext for local development, with a warning", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GRAPH_TOKEN_KEY", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sealGraphToken } = await import("@/lib/graph");
    expect(sealGraphToken("dev-token")).toBe("dev-token");
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/allowed outside production only/));
  });
});

describe("Turia cookie (src/lib/neo-centra/turia.ts)", () => {
  it("refuses to store without NEO_TURIA_COOKIE_KEY; stores sealed with it", async () => {
    vi.stubEnv("NEO_TURIA_COOKIE_KEY", "");
    const { storeTuriaCookie } = await import("@/lib/neo-centra/turia");
    await expect(storeTuriaCookie("accessToken=abcdefghijkl")).rejects.toThrow(/refusing to store/);
    vi.stubEnv("NEO_TURIA_COOKIE_KEY", hexKey());
    await storeTuriaCookie("accessToken=abcdefghijkl", "u1", "n");
    expect((db.upserts.at(-1) as { create: { cookie: string } }).create.cookie.startsWith("enc:v1:")).toBe(true);
  });

  it("a plaintext row is not used as the firm's Turia session (unless the migration flag is on); no key → not used", async () => {
    vi.stubEnv("NEO_TURIA_COOKIE_KEY", hexKey());
    vi.stubEnv(LEGACY_PLAINTEXT_ENV, "");
    const { getTuriaCookie, TuriaSessionError } = await import("@/lib/neo-centra/turia");
    db.turia = { cookie: "accessToken=attacker" };
    await expect(getTuriaCookie()).rejects.toBeInstanceOf(TuriaSessionError);
    await expect(getTuriaCookie()).rejects.toThrow(/not encrypted, so it was not used/);
    vi.stubEnv(LEGACY_PLAINTEXT_ENV, "true");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getTuriaCookie()).toBe("accessToken=attacker");
    vi.stubEnv("NEO_TURIA_COOKIE_KEY", "");
    await expect(getTuriaCookie()).rejects.toThrow(/NEO_TURIA_COOKIE_KEY is not set on the server, so the stored Turia session is not used/);
  });
});
