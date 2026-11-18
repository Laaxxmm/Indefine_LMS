// /admin/firm-os/workspace and /api/firm-os/workspace/{roles,users}: admin-only page renders the
// role defaults and people views; saves write the row + an AuditEvent; non-admins get 403 / are
// redirected; error texts are plain sentences.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession, redirectTarget, renderHtml as renderRaw } from "./harness";
import { createWorkspaceDb } from "../../fakes/workspace-db";

const state = vi.hoisted(() => ({ w: null as unknown as ReturnType<typeof createWorkspaceDb> }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.w.db;
  },
}));

const { auth } = await import("@/lib/auth");
const { default: Page } = await import("@/app/admin/firm-os/workspace/page");
const { default: AdminLayout } = await import("@/app/admin/layout");
const saveRole = (await import("@/app/api/firm-os/workspace/roles/[role]/route")).POST;
const saveUser = (await import("@/app/api/firm-os/workspace/users/[userId]/route")).POST;

const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const adminSession = () => activeSession({ id: "u-admin", name: "Asha Admin", role: "ADMIN" });
const renderHtml = async (el: Parameters<typeof renderRaw>[0]) => (await renderRaw(el)).replace(/<!-- -->/g, "");
const page = async (sp: Record<string, string> = {}) => renderHtml(await Page({ searchParams: Promise.resolve(sp) }));
const req = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  state.w = createWorkspaceDb();
  signedIn(adminSession());
});

describe("page", () => {
  it("role defaults: one role at a time, built-in until saved, module toggles and one primary action", async () => {
    const html = await page();
    expect(html).toContain(">Workspace settings</h1>");
    expect(html).toContain("Admin · Firm OS");
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/firm-os\/workspace">Role defaults/);
    expect(html).toMatch(/aria-current="true"[^>]*href="\/admin\/firm-os\/workspace\?role=staff">Staff</); // the selected role, inside the current page
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toContain("Applies to everyone in the Staff role who has no setting of their own.");
    expect(html).toContain("Staff default");
    expect(html).toContain("Built-in default; nothing saved for this role yet.");
    for (const label of ["Learning", "Clients", "Agents", "Daily Coach", "Admin"]) expect(html).toContain(`>${label}</span>`);
    expect(html).toContain("Staff members cannot use this, so switching it on has no effect.");
    expect(html).toContain("Focus mode");
    expect(html).toContain(">Review changes</button>");
    expect(html).toContain(">Use built-in defaults</button>");
    expect(html.match(/bg-brand-500/g)?.length).toBe(1); // one primary button
    expect(html).toContain('href="/admin"');
    expect(html).not.toMatch(/delete|remove/i);
  });

  it("the admin role keeps the Admin module (checked and locked)", async () => {
    const html = await page({ role: "admin" });
    expect(html).toContain("Admin default");
    expect(html).toContain("Always on for admins.");
    expect(html).toMatch(/id="[^"]*-admin" type="checkbox"[^>]*disabled="" checked=""/);
  });

  it("a saved role default shows when it was saved (DD MMM YYYY HH:mm IST)", async () => {
    state.w = createWorkspaceDb({ roles: [{ role: "manager", modules: ["agents", "clients"], focusMode: true, updatedAt: new Date("2026-09-03T05:00:00Z") }] });
    const html = await page({ role: "manager" });
    expect(html).toContain("Saved on 03 Sep 2026 10:30 IST.");
    expect(html).toContain("Now on: Clients, Agents.");
    expect(html).not.toContain("Sept");
  });

  it("people: empty state, search results with Edit links, and one person's form", async () => {
    expect(await page({ view: "people" })).toContain("Everyone follows their role default.");
    const found = await page({ view: "people", q: "priya" });
    expect(found).toContain("Priya S");
    expect(found).toContain("priya@indefine.test · Staff · Staff default modules · focus off");
    expect(found).toContain('href="/admin/firm-os/workspace?view=people&amp;q=priya&amp;user=u-priya"');
    expect(await page({ view: "people", q: "zzz" })).toContain("No one matches");
    const edit = await page({ view: "people", q: "priya", user: "u-priya" });
    expect(edit).toContain("Give Priya S their own list of modules");
    expect(edit).toContain("Follow the Staff default (off)");
    expect(edit).toContain("Allow the companion extension");
    expect(edit).toContain(">Reset to role default</button>");
    expect(edit).toContain(">Review changes</button>");
    expect(edit).toContain("can open now: Learning, Leaderboard and Trajectory, Tools, Agents, Daily Coach, Search");
    expect(await page({ view: "people", user: "nobody" })).toContain("That person was not found.");
  });

  it("people with their own settings are listed without a search", async () => {
    state.w = createWorkspaceDb({ settings: [{ userId: "u-meera", modules: ["agents"], focusMode: true, companionEnabled: true, updatedAt: new Date() }] });
    const html = await page({ view: "people" });
    expect(html).toContain("People with their own settings");
    expect(html).toContain("Meera K");
    expect(html).toContain("own modules · focus on · companion allowed");
  });

  it("non-admins go to the dashboard, signed-out visitors to sign-in", async () => {
    signedIn(activeSession({ level: "PARTNER" }));
    expect(await redirectTarget(() => Page({ searchParams: Promise.resolve({}) }))).toBe("/dashboard");
    signedIn(null);
    expect(await redirectTarget(() => Page({ searchParams: Promise.resolve({}) }))).toBe("/");
  });

  it("the admin sidebar lists it in the Firm OS group, labelled with the page title", async () => {
    const html = await renderHtml(await AdminLayout({ children: null }));
    expect(html.split('href="/admin/firm-os/workspace"').length - 1).toBe(2); // sidebar + small-screen menu
    expect(html).toContain("Workspace settings</a>");
  });
});

describe("API", () => {
  it("POST roles/[role]: saves the default and an AuditEvent; returns the change list", async () => {
    const res = await saveRole(req({ modules: ["agents", "search"], focusMode: true }), { params: Promise.resolve({ role: "staff" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { changes: string[] };
    expect(body.changes).toContain("Focus mode for Staff: on (was off).");
    expect(state.w.t.roles[0]).toMatchObject({ role: "staff", focusMode: true });
    expect(state.w.t.audit).toHaveLength(1);
    expect(state.w.t.audit[0]).toMatchObject({ actorId: "u-admin", action: "workspace-role-default", entityId: "staff" });
  });

  it("POST users/[userId]: saves, audits; reset to role default saves nulls", async () => {
    let res = await saveUser(req({ modules: ["agents"], focusMode: true, companionEnabled: true }), { params: Promise.resolve({ userId: "u-priya" }) });
    expect(res.status).toBe(200);
    res = await saveUser(req({ modules: null, focusMode: null, companionEnabled: false }), { params: Promise.resolve({ userId: "u-priya" }) });
    expect(res.status).toBe(200);
    expect(state.w.t.settings).toEqual([expect.objectContaining({ userId: "u-priya", modules: null, focusMode: null, companionEnabled: false })]);
    expect(state.w.t.audit.map((a) => a.action)).toEqual(["workspace-user-setting", "workspace-user-setting"]);
  });

  it("403 for non-admins and 401 when signed out, with plain sentences; nothing written", async () => {
    signedIn(activeSession({ level: "PARTNER" }));
    let res = await saveRole(req({ modules: [], focusMode: false }), { params: Promise.resolve({ role: "staff" }) });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only an admin can change workspace settings." });
    res = await saveUser(req({ modules: null, focusMode: null, companionEnabled: false }), { params: Promise.resolve({ userId: "u-priya" }) });
    expect(res.status).toBe(403);
    signedIn(null);
    res = await saveRole(req({ modules: [], focusMode: false }), { params: Promise.resolve({ role: "staff" }) });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("Your session has ended. Sign in again to continue.");
    expect(state.w.t.roles).toEqual([]);
    expect(state.w.t.settings).toEqual([]);
    expect(state.w.t.audit).toEqual([]);
  });

  it("400 for an unreadable body or an unknown module, and for a save that changes nothing", async () => {
    let res = await saveRole(req("not json"), { params: Promise.resolve({ role: "staff" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "The settings could not be read. Reload the page and try again." });
    res = await saveRole(req({ modules: ["agents", "teleport"], focusMode: false }), { params: Promise.resolve({ role: "staff" }) });
    expect(res.status).toBe(400);
    res = await saveUser(req({ modules: null, focusMode: null, companionEnabled: false }), { params: Promise.resolve({ userId: "u-priya" }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nothing has changed. Change a setting, then save." });
    res = await saveRole(req({ modules: [], focusMode: false }), { params: Promise.resolve({ role: "owner" }) });
    expect(res.status).toBe(404);
    for (const r of [res]) expect(JSON.stringify(await r.json().catch(() => ({})))).not.toMatch(/\b(4\d\d|code)\b/);
  });
});
