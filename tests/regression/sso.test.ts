// LMS regression (Phase 12 §4): Microsoft Entra SSO is unchanged by Firm OS. The sign-in page
// offers only "Sign in with Microsoft"; src/lib/auth.ts still pins the tenant, uses database
// sessions, asks for identity scopes only, refuses other tenants (issuer and the token's tid claim,
// security audit #31), refuses deactivated people, and puts role / active /
// department / level on the session (Firm OS roles are derived from exactly these fields).
// NextAuth itself is replaced by a recorder so the real configuration object can be inspected.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Server renders and cold module imports are slow when the whole suite runs in parallel; 5 s flakes.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
import { SIGNIN_SCOPES } from "@/lib/graph-scopes";
import { activeSession, renderPage, textOf } from "./support/render";

const state = vi.hoisted(() => ({
  config: null as null | Record<string, unknown>,
  userRow: null as null | { active: boolean },
  stored: {} as Record<string, unknown>,
}));

vi.mock("next-auth", () => ({
  default: (config: Record<string, unknown>) => {
    state.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
}));
vi.mock("next-auth/providers/microsoft-entra-id", () => ({ default: (options: Record<string, unknown>) => ({ id: "microsoft-entra-id", type: "oidc", options }) }));
vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: () => ({
    linkAccount: async (a: unknown) => a,
    getSessionAndUser: async (token: string) => state.stored[token] ?? null,
  }),
}));
vi.mock("@/lib/graph", () => ({ sealGraphToken: (t: string | null | undefined) => t ?? null }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: async () => state.userRow, update: async () => ({}) },
    account: { updateMany: async () => ({ count: 0 }) },
  },
}));
vi.mock("next/navigation", async () => (await import("../unit/routes/harness")).navigationMock);

type Callbacks = {
  signIn: (a: { user: { email?: string }; account?: unknown; profile?: { tid?: string } }) => Promise<boolean>;
  session: (a: { session: { user: Record<string, unknown> }; user: Record<string, unknown> }) => Promise<{ user: Record<string, unknown> }>;
};
type Provider = { id: string; options: { authorization: { params: { scope: string } }; allowDangerousEmailAccountLinking: boolean; issuer?: string } };

async function loadAuth(issuer: string) {
  vi.resetModules();
  vi.stubEnv("AUTH_MICROSOFT_ENTRA_ID_ISSUER", issuer);
  await import("@/lib/auth");
  const config = state.config!;
  return {
    config,
    callbacks: config.callbacks as Callbacks,
    providers: config.providers as Provider[],
    adapter: config.adapter as { getSessionAndUser: (t: string) => Promise<unknown> },
  };
}

const TENANT_ID = "00000000-1111-2222-3333-444444444444";
const TENANT_ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;

beforeEach(() => {
  state.userRow = null;
  state.stored = {};
});
afterEach(() => vi.unstubAllEnvs());

describe("Entra SSO configuration (src/lib/auth.ts)", () => {
  it("one provider, Microsoft Entra ID, identity scopes only, database sessions, sign-in page at /", async () => {
    const { config, providers } = await loadAuth(TENANT_ISSUER);
    expect(providers.map((p) => p.id)).toEqual(["microsoft-entra-id"]);
    expect(providers[0].options.authorization.params.scope).toBe(SIGNIN_SCOPES);
    expect(SIGNIN_SCOPES).not.toMatch(/offline_access/);
    expect(providers[0].options.issuer).toBe(TENANT_ISSUER);
    expect(config.session).toEqual({ strategy: "database" });
    expect(config.pages).toEqual({ signIn: "/" });
  });

  it("refuses every sign-in when the issuer is multi-tenant or missing (tenant pinning)", async () => {
    for (const issuer of [
      "https://login.microsoftonline.com/common/v2.0",
      "https://login.microsoftonline.com/organizations/v2.0",
      "https://login.microsoftonline.com/organizations",
      "https://login.microsoftonline.com/common",
      "",
    ]) {
      const { callbacks } = await loadAuth(issuer);
      expect(await callbacks.signIn({ user: { email: "priya@indefine.in" }, profile: { tid: TENANT_ID } }), issuer || "(empty)").toBe(false);
    }
  });

  it("refuses an account whose id-token tenant (tid) is not the firm's, or carries none", async () => {
    const { callbacks } = await loadAuth(TENANT_ISSUER);
    state.userRow = { active: true };
    expect(await callbacks.signIn({ user: { email: "priya@indefine.in" }, profile: { tid: "99999999-8888-7777-6666-555555555555" } })).toBe(false);
    expect(await callbacks.signIn({ user: { email: "priya@indefine.in" }, profile: {} })).toBe(false);
    expect(await callbacks.signIn({ user: { email: "priya@indefine.in" } })).toBe(false);
  });

  it("lets an active firm member in and keeps a deactivated one out (sign-in and existing sessions)", async () => {
    const { callbacks, adapter } = await loadAuth(TENANT_ISSUER);
    state.userRow = { active: true };
    expect(await callbacks.signIn({ user: { email: "priya@indefine.in" }, profile: { tid: TENANT_ID } })).toBe(true);
    state.userRow = { active: false };
    expect(await callbacks.signIn({ user: { email: "gone@indefine.in" }, profile: { tid: TENANT_ID } })).toBe(false);
    state.stored = { live: { session: {}, user: { active: true } }, revoked: { session: {}, user: { active: false } } };
    expect(await adapter.getSessionAndUser("live")).toBeTruthy();
    expect(await adapter.getSessionAndUser("revoked")).toBeNull();
  });

  it("the session carries id, role, active, department and level (what the LMS and Firm OS gates read)", async () => {
    const { callbacks } = await loadAuth(TENANT_ISSUER);
    const s = await callbacks.session({ session: { user: { name: "Priya" } }, user: { id: "u-1", role: "ADMIN", active: true, department: "TAX", level: "PARTNER" } });
    expect(s.user).toEqual({ name: "Priya", id: "u-1", role: "ADMIN", active: true, department: "TAX", level: "PARTNER" });
    const d = await callbacks.session({ session: { user: {} }, user: { id: "u-2" } });
    expect(d.user).toMatchObject({ role: "EMPLOYEE", active: false, department: "GENERAL", level: "EXECUTIVE" }); // safe defaults
  });
});

/** The recorder's `auth` mock as the page imports it (fresh after loadAuth's resetModules). */
async function signedIn(session: unknown) {
  await loadAuth(TENANT_ISSUER);
  const { auth } = await import("@/lib/auth");
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(session);
}

describe("sign-in page (/)", () => {
  it("a signed-out visitor sees only the Microsoft sign-in", async () => {
    await signedIn(null);
    const html = await renderPage(await import("@/app/page"));
    const text = textOf(html);
    expect(text).toContain("Internal learning portal");
    expect(text).toContain("Sign in with Microsoft");
    expect(text).toContain("Sign in with your Microsoft 365 account to continue.");
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/type="password"|name="email"/); // no local credentials, ever
  });

  it("a signed-in person goes straight to the dashboard", async () => {
    await signedIn(activeSession());
    const { default: Home } = await import("@/app/page");
    // resetModules gave next/navigation a fresh harness instance, so match the sentinel by message.
    await expect(Home()).rejects.toThrow("NEXT_REDIRECT /dashboard");
  });
});
