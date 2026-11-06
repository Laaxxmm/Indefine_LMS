// /api/cron/firm-os/turia-pull, /api/firm-os/turia-sync/{run,people,clients,rules} and the
// /admin/firm-os/turia-sync page: the cron secret and IST window, sign-in and policy on the admin
// routes (session cookie + JSON body, like every Firm OS route), plain sentences, and an AuditEvent
// for every change. Turia is a fake behind Neo Centra's request function; the database is in memory.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { activeSession, redirectTarget, renderHtml } from "./harness";
import { createPullWorld, rawTask } from "../../fakes/turia-pull-world";

const state = vi.hoisted(() => ({
  w: null as unknown as ReturnType<typeof createPullWorld>,
  session: { present: true, encrypted: true, updatedAt: new Date() as Date | null, updatedByName: "Asha" as string | null },
  posts: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.w.db;
  },
}));
vi.mock("@/lib/neo-centra/turia", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    turiaStatus: async () => state.session,
    turiaPost: async (endpoint: string, action: string, data: Record<string, unknown> = {}) => {
      state.posts.push(`${endpoint}/${action}`);
      if (!state.session.present) throw new (real.TuriaSessionError as new (m: string) => Error)("Turia session not available.");
      if (endpoint === "task" && action === "list") return { tasks: { tasks: state.w.turia.pages[(data.page as number) - 1] ?? [] } };
      if (endpoint === "utilities") return { users: state.w.turia.users };
      return { tasktimesheets: [] };
    },
  };
});

const { auth } = await import("@/lib/auth");
const cron = (await import("@/app/api/cron/firm-os/turia-pull/route")).GET;
const runNow = (await import("@/app/api/firm-os/turia-sync/run/route")).POST;
const people = (await import("@/app/api/firm-os/turia-sync/people/route")).POST;
const clients = (await import("@/app/api/firm-os/turia-sync/clients/route")).POST;
const rules = (await import("@/app/api/firm-os/turia-sync/rules/route")).POST;
const { default: Page } = await import("@/app/admin/firm-os/turia-sync/page");
const { default: AdminLayout } = await import("@/app/admin/layout");
const { SESSION_MESSAGE, OUTSIDE_HOURS_MESSAGE, PULL_OFF_MESSAGE } = await import("@/lib/integrations/turia/pull/messages");
const { FIRM_OS_OFF_MESSAGE } = await import("@/lib/workspace/flag");
const { messageProblems } = await import("@/lib/errors/rules");

const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const adminSession = () => activeSession({ id: "u-admin", name: "Asha Admin", role: "ADMIN", level: "PARTNER" });
const json = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const cronReq = (secret = "s3cret") => new NextRequest("http://x/api/cron/firm-os/turia-pull", { headers: { authorization: `Bearer ${secret}` } });
const IN_WINDOW = new Date("2026-11-06T06:00:00Z"); // Friday 11:30 IST

beforeEach(() => {
  state.w = createPullWorld(IN_WINDOW);
  state.w.seedFirm();
  state.w.turia.pages = [[rawTask({ id: "101" })]];
  state.session = { present: true, encrypted: true, updatedAt: new Date(), updatedByName: "Asha" };
  state.posts = [];
  vi.stubEnv("FIRM_OS_ENABLED", "true");
  vi.stubEnv("FIRM_OS_TURIA_PULL", "dry-run");
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(IN_WINDOW);
  signedIn(adminSession());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("cron", () => {
  it("refuses a wrong secret", async () => {
    expect((await cron(cronReq("wrong"))).status).toBe(401);
    expect(state.posts).toEqual([]);
  });

  it("skips with 200 while Firm OS or the pull is off, and outside Mon-Sat 09:00-20:00 IST", async () => {
    vi.stubEnv("FIRM_OS_ENABLED", "");
    expect(await (await cron(cronReq())).json()).toEqual({ ok: true, skipped: FIRM_OS_OFF_MESSAGE });
    vi.stubEnv("FIRM_OS_ENABLED", "true");
    vi.stubEnv("FIRM_OS_TURIA_PULL", "off");
    expect(await (await cron(cronReq())).json()).toEqual({ ok: true, skipped: PULL_OFF_MESSAGE });
    vi.stubEnv("FIRM_OS_TURIA_PULL", "on");
    vi.setSystemTime(new Date("2026-11-08T06:00:00Z")); // Sunday
    expect(await (await cron(cronReq())).json()).toEqual({ ok: true, skipped: OUTSIDE_HOURS_MESSAGE });
    expect(state.posts).toEqual([]);
    expect(state.w.db.auditEvent.rows).toEqual([]);
  });

  it("runs a dry run through Neo Centra's connection, read only, and audits it", async () => {
    const res = await cron(cronReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "ok", mode: "dry-run", complete: true, counts: { fetched: 1, create: 1 } });
    expect(state.posts).toEqual(["utilities/organizationUserListNew", "task/list"]);
    expect(state.w.db.jobTask.rows).toEqual([]);
    expect(state.w.db.auditEvent.rows).toHaveLength(1);
    expect(state.w.db.auditEvent.rows[0]).toMatchObject({ action: "turia-pull.run", actorId: "system:turia-pull" });
  });

  it("in on mode creates the job", async () => {
    vi.stubEnv("FIRM_OS_TURIA_PULL", "on");
    expect((await (await cron(cronReq())).json()).counts.create).toBe(1);
    expect(state.w.db.jobTask.rows[0]).toMatchObject({ turiaTaskId: "101", assigneeId: "u-priya" });
  });

  it("a missing Turia sign-in answers 200, recorded, with the plain sentence", async () => {
    state.session = { present: false, encrypted: false, updatedAt: null, updatedByName: null };
    const res = await cron(cronReq());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "session", notice: SESSION_MESSAGE });
    expect(state.w.db.turiaPullRun.rows[0]).toMatchObject({ status: "session" });
    expect(state.w.db.auditEvent.rows).toHaveLength(1);
  });
});

describe("Sync now", () => {
  it("signed out 401, staff 403, Firm OS off 404", async () => {
    signedIn(null);
    expect((await runNow()).status).toBe(401);
    signedIn(activeSession({ role: "EMPLOYEE", level: "EXECUTIVE" }));
    expect((await runNow()).status).toBe(403);
    vi.stubEnv("FIRM_OS_ENABLED", "");
    expect((await runNow()).status).toBe(404);
    expect(state.posts).toEqual([]);
  });

  it("an admin runs it and reads the result sentence; a missing sign-in is a plain 409", async () => {
    const ok = await runNow();
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.notice).toMatch(/^Read the whole task list from Turia/);
    expect(messageProblems(body.notice)).toEqual([]);
    expect(state.w.db.turiaPullRun.rows[0]).toMatchObject({ trigger: "manual", startedById: "u-admin" });
    expect(state.w.db.auditEvent.rows[0]).toMatchObject({ actorId: "u-admin", action: "turia-pull.run" });
    state.session = { present: false, encrypted: false, updatedAt: null, updatedByName: null };
    const refused = await runNow();
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: SESSION_MESSAGE, status: "session" });
  });
});

describe("mapping routes", () => {
  beforeEach(async () => {
    await runNow(); // a dry run fills the people, client and rule tables
    state.w.db.auditEvent.rows.length = 0;
  });

  it("signed out 401, staff 403, Firm OS off 404, nothing written", async () => {
    for (const [handler, body] of [
      [people, { turiaUserId: "t-ravi", userId: "u-priya" }],
      [clients, { key: "acme traders private limited", action: "ignore" }],
      [rules, { position: 1, label: "x", department: null, namePattern: "x", service: "GST", title: "x", frequency: "MONTHLY", useAgent: true, calendarRuleId: null, active: true }],
    ] as const) {
      signedIn(null);
      expect((await handler(json(body))).status).toBe(401);
      signedIn(activeSession({ role: "EMPLOYEE", level: "MANAGER" }));
      expect((await handler(json(body))).status).toBe(403);
      vi.stubEnv("FIRM_OS_ENABLED", "");
      expect((await handler(json(body))).status).toBe(404);
      vi.stubEnv("FIRM_OS_ENABLED", "true");
    }
    expect(state.w.db.auditEvent.rows).toEqual([]);
  });

  it("each save by an admin is written and audited", async () => {
    signedIn(adminSession());
    expect((await people(json({ turiaUserId: "t-ravi", userId: "u-priya" }))).status).toBe(200);
    expect((await clients(json({ key: "acme traders private limited", action: "ignore" }))).status).toBe(200);
    const added = await rules(json({ position: 5, label: "Payroll", department: null, namePattern: "payroll", service: "Books", title: "Payroll", frequency: "MONTHLY", useAgent: false, calendarRuleId: null, active: true }));
    expect(added.status).toBe(200);
    expect(state.w.db.auditEvent.rows.map((a) => a.action)).toEqual(["turia-pull.person-link", "turia-pull.client-link", "turia-pull.rule-add"]);
  });

  it("a bad body gets a plain sentence, the field's own when it has one", async () => {
    const bad = await people(json("{not json"));
    expect(bad.status).toBe(400);
    const msg = (await bad.json()).error as string;
    expect(messageProblems(msg)).toEqual([]);
    const noName = await rules(json({ position: 5, label: "", department: null, namePattern: "x", service: "GST", title: "x", frequency: "MONTHLY", useAgent: true, calendarRuleId: null, active: true }));
    expect(await noName.json()).toEqual({ error: "Give the rule a name." });
    const unknown = await people(json({ turiaUserId: "nobody", userId: null }));
    expect(unknown.status).toBe(404);
    expect(messageProblems((await unknown.json()).error)).toEqual([]);
  });
});

describe("page", () => {
  it("admin only", async () => {
    signedIn(activeSession({ role: "EMPLOYEE", level: "PARTNER" }));
    expect(await redirectTarget(() => Page())).toBe("/dashboard");
    signedIn(null);
    expect(await redirectTarget(() => Page())).toBe("/");
  });

  it("shows the mode, the sign-in, the last run, its preview and the three mappings", async () => {
    await runNow();
    const html = (await renderHtml(await Page())).replace(/<!-- -->/g, "");
    expect(html).toContain(">Turia sync</h1>");
    expect(html).toContain("Admin · Firm OS");
    expect(html).toContain("Dry run.");
    expect(html).toContain(">Sync now</button>");
    expect(html).toContain("Preview: what would happen");
    expect(html).toMatch(/Would create GST · GSTR-3B · 2026-10 FY 2026-27/);
    for (const section of [">People</h2>", ">Clients</h2>", ">Task rules</h2>", ">Recent runs</h2>"]) expect(html).toContain(section);
    expect(html).toContain("Priya Subramanian");
    expect(html).toContain("GSTR-3B under QRMP");
    expect(html.match(/bg-brand-500/g)?.length).toBe(1); // one primary button
  });

  it("says when the sign-in is missing or the sync is off", async () => {
    state.session = { present: false, encrypted: false, updatedAt: null, updatedByName: null };
    vi.stubEnv("FIRM_OS_TURIA_PULL", "");
    const html = (await renderHtml(await Page())).replace(/<!-- -->/g, "");
    expect(html).toContain("No Turia sign-in is stored.");
    expect(html).toContain("The sync is off.");
    expect(html).toContain("No sync has run yet.");
  });

  it("is in the Firm OS group of the admin menu", async () => {
    const html = await renderHtml(await AdminLayout({ children: null }));
    expect(html.split('href="/admin/firm-os/turia-sync"').length - 1).toBe(2);
  });
});
