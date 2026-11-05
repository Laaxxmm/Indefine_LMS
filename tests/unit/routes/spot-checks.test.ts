// /agents/spot-checks (page + nav link) and POST /api/firm-os/spot-checks/[id]: partners only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { redirectTarget, renderHtml as renderRaw } from "./harness";
import { SpotCheckWorld } from "../../fakes/spot-check-world";

const state = vi.hoisted(() => ({ world: null as unknown as SpotCheckWorld }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("@/lib/prisma", () => ({ get prisma() { return state.world.db; } }));

const { auth } = await import("@/lib/auth");
const { default: Page } = await import("@/app/agents/spot-checks/page");
const { default: Layout } = await import("@/app/agents/layout");
const { POST } = await import("@/app/api/firm-os/spot-checks/[id]/route");
const { CHECK_CONSEQUENCE } = await import("@/app/agents/spot-checks/SpotCheckAction");

const person = (id: string, level = "EXECUTIVE", over: Partial<Session["user"]> = {}) =>
  ({ id, name: id, email: `${id}@x`, image: null, role: "EMPLOYEE", active: true, department: "GENERAL", level, ...over }) as Session["user"];
const PARTNER = person("u-partner", "PARTNER");
const as = (u: Session["user"] | null) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(u ? { user: u, expires: "2099-01-01" } : null);
const html = async (el: Parameters<typeof renderRaw>[0]) => (await renderRaw(el)).replace(/<!-- -->/g, "");
const post = (id: string, body: unknown) => POST(new Request("http://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  state.world = new SpotCheckWorld();
});

describe("/agents/spot-checks page", () => {
  it("renders the queue for a partner: job, client, Turia ref, minutes, who confirmed, and the Checked in Turia action", async () => {
    state.world.selected({ id: "sync-9" });
    as(PARTNER);
    const page = await html(await Page());
    expect(page).toContain("Turia spot checks");
    expect(page).toContain("To check (1)");
    expect(page).toMatch(/GSTR-3B/);
    expect(page).toContain("ACME01");
    expect(page).toContain("TT-4411");
    expect(page).toContain("90 min logged");
    expect(page).toContain("Priya Raman");
    expect(page).toContain('aria-label="Checked in Turia: GSTR-3B 2026-10 for ACME01"');
    expect(page).toContain("No spot checks recorded yet");
    expect(CHECK_CONSEQUENCE).toMatch(/cannot be undone; the job stays DONE/);
  });

  it("shows recorded checks with who, when and the note", async () => {
    state.world.selected({ id: "s1", spotChecked: true, spotCheckedById: "u-partner", spotCheckedAt: new Date("2026-11-05T06:30:00Z"), spotCheckNote: "Matches Turia" });
    as(PARTNER);
    const page = await html(await Page());
    expect(page).toContain("To check (0)");
    expect(page).toContain("Nothing to check");
    expect(page).toContain("Lakshmanan A");
    expect(page).toContain("05 Nov 2026 12:00");
    expect(page).toContain("Matches Turia");
    expect(page).not.toContain("Checked in Turia:");
  });

  it("everyone else is sent away: signed out → sign-in; staff, managers and IT admins → /agents", async () => {
    as(null);
    expect(await redirectTarget(() => Page())).toBe("/");
    for (const u of [person("u-priya"), person("u-mgr", "MANAGER"), person("u-it", "EXECUTIVE", { role: "ADMIN" })]) {
      as(u);
      expect(await redirectTarget(() => Page())).toBe("/agents");
    }
  });

  it("the Agents nav links to Spot checks for partners only", async () => {
    as(PARTNER);
    expect(await html(await Layout({ children: null }))).toContain('href="/agents/spot-checks"');
    for (const u of [person("u-priya"), person("u-mgr", "MANAGER"), person("u-it", "EXECUTIVE", { role: "ADMIN" })]) {
      as(u);
      expect(await html(await Layout({ children: null }))).not.toContain("/agents/spot-checks");
    }
  });
});

describe("POST /api/firm-os/spot-checks/[id]", () => {
  it("401 signed out; 403 for staff, managers, IT admins and deactivated users; nothing recorded", async () => {
    const id = state.world.selected();
    as(null);
    expect((await post(id, {})).status).toBe(401);
    for (const u of [person("u-priya"), person("u-mgr", "MANAGER"), person("u-it", "EXECUTIVE", { role: "ADMIN" })]) {
      as(u);
      const r = await post(id, { note: "x" });
      expect(r.status).toBe(403);
      expect((await r.json()).error).toMatch(/Only a partner/);
    }
    as(person("u-p2", "PARTNER", { active: false }));
    expect((await post(id, {})).status).toBe(403);
    expect(state.world.syncs[0].spotChecked).toBe(false);
    expect(state.world.audits.filter((a) => a.action === "spot-check")).toEqual([]);
  });

  it("a partner records it (200), a second time is 409; a bad body is 400", async () => {
    const id = state.world.selected();
    as(PARTNER);
    expect((await post(id, { note: "x".repeat(501) })).status).toBe(400);
    expect((await post(id, { note: "ok", extra: true })).status).toBe(400);
    const r = await post(id, { note: "Ref and minutes match" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ syncId: id });
    expect(state.world.syncs[0]).toMatchObject({ spotChecked: true, spotCheckedById: "u-partner", spotCheckNote: "Ref and minutes match" });
    expect(state.world.audits.at(-1)).toMatchObject({ action: "spot-check", actorId: "u-partner", entityId: id });
    expect((await post(id, {})).status).toBe(409);
    expect((await post("nope", {})).status).toBe(404);
  });
});
