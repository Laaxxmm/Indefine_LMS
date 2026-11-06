// /admin/settings shows the Graph token storage notice (graphTokenStorageStatus, src/lib/graph.ts —
// its production/key logic is tested in src/lib/secret-box.test.ts) when GRAPH_TOKEN_KEY is
// missing, and nothing when token storage works.
import { describe, expect, it, vi } from "vitest";
import { activeSession, renderHtml } from "./harness";

const state = vi.hoisted(() => ({ ok: false }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("./harness")).prismaMock }));
vi.mock("@/lib/settings", () => ({ getSettings: async () => ({ quizTimeLimitSec: 600, quizPassPercent: 70, quizUnlockAtPercent: 90 }) }));
vi.mock("@/lib/graph", async (orig) => {
  const real = await orig<typeof import("@/lib/graph")>();
  return { ...real, graphTokenStorageStatus: () => (state.ok ? { ok: true, message: null } : { ok: false, message: real.GRAPH_TOKEN_KEY_MISSING_MESSAGE }) };
});

const { auth } = await import("@/lib/auth");
const { default: Page } = await import("@/app/admin/settings/page");
const render = async () => (await renderHtml(await Page())).replace(/<!-- -->/g, "");

describe("/admin/settings — Graph token storage notice", () => {
  it("GRAPH_TOKEN_KEY missing: a warning that says what is off and what to do", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(activeSession({ id: "u-admin", role: "ADMIN" }));
    state.ok = false;
    const html = await render();
    expect(html).toContain("Microsoft 365 sign-in tokens are not being saved");
    expect(html).toContain("Ask IT to add the key that protects saved Microsoft 365 connections, then redeploy.");
    // Plain-language rule: no setting names or commands in what people see.
    expect(html).not.toContain("GRAPH_TOKEN_KEY");
  });

  it("token storage works: no notice", async () => {
    (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(activeSession({ id: "u-admin", role: "ADMIN" }));
    state.ok = true;
    const html = await render();
    expect(html).not.toContain("GRAPH_TOKEN_KEY is not set");
    expect(html).not.toContain("tokens are not being saved");
  });
});
