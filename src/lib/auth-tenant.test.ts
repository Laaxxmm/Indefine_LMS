// Security audit #31. Ported from the audit PoC (.audit-sec/secrets/area-a-secrets-config.test.ts
// "tenant pin regex" and "NextAuth adapter email linking"):
//   - a bare https://login.microsoftonline.com/organizations (or /common) issuer passed the pin;
//   - nothing compared the token's tid claim to the firm's tenant;
//   - the Prisma adapter's getUserByEmail was an exact-case lookup while the org sync lower-cases,
//     so "John.Doe@Firm.in" made a duplicate User row (and the sync's case-sensitive notIn could
//     deactivate a mixed-case row of someone still in the tenant).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkTenant, isTenantPinned, normalizeEmail, tenantFromIssuer } from "./auth-tenant";

const TID = "11111111-2222-3333-4444-555555555555";

describe("tenant pin (src/lib/auth-tenant.ts)", () => {
  it("only an Entra issuer naming one tenant GUID is pinned — bare /organizations and /common included", () => {
    expect(tenantFromIssuer(`https://login.microsoftonline.com/${TID}/v2.0`)).toBe(TID);
    expect(tenantFromIssuer(`https://login.microsoftonline.com/${TID.toUpperCase()}/v2.0/`)).toBe(TID);
    for (const bad of [
      "https://login.microsoftonline.com/common/v2.0",
      "https://login.microsoftonline.com/organizations/v2.0",
      "https://login.microsoftonline.com/CONSUMERS/v2.0",
      "https://login.microsoftonline.com/organizations", // the PoC's edge case
      "https://login.microsoftonline.com/common",
      "https://login.microsoftonline.com/indefine.onmicrosoft.com/v2.0", // domain form: never matches Entra's GUID iss
      `http://login.microsoftonline.com/${TID}/v2.0`,
      `https://login.microsoftonline.com.evil.example/${TID}/v2.0`,
      `https://evil.example/${TID}/v2.0`,
      `https://login.microsoftonline.com/${TID}/v2.0?x=1`,
      `https://login.microsoftonline.com/${TID}/oauth2/v2.0/token`,
      "",
      "not a url",
    ]) {
      expect(isTenantPinned(bad), bad).toBe(false);
    }
  });

  it("checkTenant: the token's tid must equal the pinned tenant", () => {
    const issuer = `https://login.microsoftonline.com/${TID}/v2.0`;
    expect(checkTenant(issuer, TID)).toEqual({ ok: true, tenant: TID });
    expect(checkTenant(issuer, TID.toUpperCase())).toEqual({ ok: true, tenant: TID });
    expect(checkTenant(issuer, "99999999-8888-7777-6666-555555555555")).toMatchObject({ ok: false, reason: expect.stringMatching(/is not the firm's tenant/) });
    expect(checkTenant(issuer, undefined)).toMatchObject({ ok: false, reason: expect.stringMatching(/\(missing\)/) });
    expect(checkTenant("https://login.microsoftonline.com/organizations", TID)).toMatchObject({ ok: false, reason: expect.stringMatching(/AUTH_MICROSOFT_ENTRA_ID_ISSUER must be/) });
  });

  it("normalizeEmail", () => {
    expect(normalizeEmail("  John.Doe@Firm.IN ")).toBe("john.doe@firm.in");
  });
});

// ------------------------------------------------------------------ the adapter and the org sync

const state = vi.hoisted(() => ({
  config: null as null | Record<string, unknown>,
  users: [] as { id: string; email: string; active: boolean; name: string | null; role: string; createdAt: Date }[],
  created: [] as Record<string, unknown>[],
  updated: [] as Record<string, unknown>[],
  base: { createUser: [] as unknown[], updateUser: [] as unknown[] },
}));

vi.mock("next-auth", () => ({
  default: (config: Record<string, unknown>) => {
    state.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({ default: (options: Record<string, unknown>) => ({ id: "microsoft-entra-id", options }) }));
vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: () => ({
    createUser: async (u: unknown) => (state.base.createUser.push(u), u),
    updateUser: async (u: unknown) => (state.base.updateUser.push(u), u),
    getUserByEmail: async () => {
      throw new Error("the exact-case lookup must not be used");
    },
    linkAccount: async (a: unknown) => a,
    getSessionAndUser: async () => null,
  }),
}));
vi.mock("@/lib/graph", () => ({
  sealGraphToken: (t: string | null | undefined) => t ?? null,
  getAppOnlyToken: async () => "app-token",
  getUserGraphToken: async () => null,
  listOrgUsers: async () => [
    { id: "g1", mail: "John.Doe@Firm.IN", displayName: "John Doe" },
    { id: "g2", mail: "new.person@firm.in", displayName: "New Person" },
  ],
}));
const ci = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: async ({ where }: { where: { email: { equals: string; mode: string } } }) => state.users.find((u) => (where.email.mode === "insensitive" ? ci(u.email, where.email.equals) : u.email === where.email.equals)) ?? null,
      findMany: async ({ where }: { where: { email?: { equals: string; mode: string }; active?: boolean } }) =>
        state.users.filter((u) => (where.email ? ci(u.email, where.email.equals) : true) && (where.active === undefined || u.active === where.active)),
      create: async ({ data }: { data: Record<string, unknown> }) => (state.created.push(data), data),
      update: async (a: Record<string, unknown>) => (state.updated.push(a), a),
      updateMany: async (a: Record<string, unknown>) => (state.updated.push(a), { count: 1 }),
    },
    session: { deleteMany: async () => ({ count: 0 }) },
    account: { updateMany: async () => ({ count: 0 }) },
  },
}));

beforeEach(() => {
  state.users = [{ id: "u-john", email: "John.Doe@Firm.in", active: true, name: "John Doe", role: "EMPLOYEE", createdAt: new Date("2026-01-01") }];
  state.created = [];
  state.updated = [];
  state.base = { createUser: [], updateUser: [] };
});

describe("NextAuth adapter e-mails (src/lib/auth.ts)", () => {
  it("getUserByEmail finds the row whatever the case; createUser / updateUser store lower case", async () => {
    vi.resetModules();
    vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ISSUER", `https://login.microsoftonline.com/${TID}/v2.0`);
    await import("@/lib/auth");
    const adapter = state.config!.adapter as {
      getUserByEmail: (e: string) => Promise<{ id: string } | null>;
      createUser: (u: { id: string; email: string; emailVerified: null }) => Promise<unknown>;
      updateUser: (u: { id: string; email?: string }) => Promise<unknown>;
    };
    expect((await adapter.getUserByEmail("JOHN.DOE@firm.IN"))?.id).toBe("u-john");
    await adapter.createUser({ id: "x", email: "Priya.S@Firm.in", emailVerified: null });
    await adapter.updateUser({ id: "x", email: " Priya.S@Firm.IN" });
    await adapter.updateUser({ id: "x" });
    expect(state.base.createUser).toEqual([{ id: "x", email: "priya.s@firm.in", emailVerified: null }]);
    expect(state.base.updateUser).toEqual([{ id: "x", email: "priya.s@firm.in" }, { id: "x" }]);
    vi.unstubAllEnvs();
  });
});

describe("org sync (src/lib/users-sync.ts)", () => {
  it("matches a mixed-case row instead of creating a duplicate, lower-cases it, and does not deactivate it", async () => {
    vi.resetModules();
    const { syncOrgUsers } = await import("@/lib/users-sync");
    const r = await syncOrgUsers();
    expect(state.created.map((c) => c.email)).toEqual(["new.person@firm.in"]); // John is not re-created
    expect(state.updated).toContainEqual({ where: { id: "u-john" }, data: { email: "john.doe@firm.in" } });
    expect(state.updated.some((u) => JSON.stringify(u).includes('"active":false'))).toBe(false); // not deactivated
    expect(r).toMatchObject({ added: 1, deactivated: 0 });
  });
});
