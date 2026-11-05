// /api/firm-os/comms/** (401 / 403 / 400 / 404 / 412 / 201) and the /comms pages (list, draft
// panel, draft view) over the in-memory comms world. Nothing on these screens is labelled "Send".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommsDeps } from "@/lib/agents/comms/defaults";
import { ENGLISH_DIVIDER } from "@/lib/agents/comms/compose";
import { CommsWorld, type MemJob } from "../../fakes/comms-world";
import { scriptedRouter } from "../../fakes/comms-router";
import { activeSession, redirectTarget, renderHtml, workspaceRow, NotFoundSignal } from "./harness";

// Firm OS switched on for these tests (FIRM_OS_ENABLED defaults off: src/lib/workspace/flag.ts).
beforeEach(() => {
  vi.stubEnv("FIRM_OS_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

let w: CommsWorld;
let deps: CommsDeps;
vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/agents/comms/defaults", () => ({ commsDeps: () => deps }));
// The comms world plus the workspace-settings reads (none saved: built-in role defaults).
const ws = vi.hoisted(() => ({ setting: null as unknown }));
vi.mock("@/lib/prisma", async () => {
  const { withWorkspace } = await import("./harness");
  return {
    get prisma() {
      return withWorkspace(w.db, { setting: () => ws.setting });
    },
  };
});
vi.mock("next/navigation", async () => (await import("./harness")).navigationMock);
// The comms-draft limiter fails closed without its bucket table (security audit #8); these tests are
// about drafting, so stand in an allowing limiter (rate-limit behaviour has its own tests).
vi.mock("@/lib/hardening/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/hardening/rate-limit")>()),
  enforceRateLimit: vi.fn(async () => null),
}));

const { auth } = await import("@/lib/auth");
const create = (await import("@/app/api/firm-os/comms/drafts/route")).POST;
const outlook = (await import("@/app/api/firm-os/comms/drafts/[id]/outlook/route")).POST;
const { default: CommsLayout } = await import("@/app/comms/layout");
const { default: CommsPage } = await import("@/app/comms/page");
const { default: NewDraftPage } = await import("@/app/comms/new/page");
const { default: DraftPage } = await import("@/app/comms/[id]/page");

const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const priya = () => activeSession({ id: "u-priya", name: "Priya Sharma" });
const req = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const sp = (q: Record<string, string> = {}) => ({ searchParams: Promise.resolve(q) });
const clean = (html: string) => html.replace(/<!-- -->/g, "");

let job: MemJob;
let token: string | null;
const created: unknown[] = [];
beforeEach(() => {
  w = new CommsWorld();
  const acme = w.addClient();
  job = w.addJob(acme);
  token = "tok";
  created.length = 0;
  deps = {
    db: w.db,
    router: scriptedRouter([], { available: false }).router,
    now: () => new Date("2026-11-05T06:00:00Z"),
    mailToken: async () => token,
    outlook: {
      create: async (_t, input) => {
        created.push(input);
        return { id: "AAMk-1", webLink: "https://outlook.office365.com/owa/?ItemID=AAMk-1" };
      },
      find: async () => null,
    },
  };
  ws.setting = null;
  signedIn(priya());
});

describe("POST /api/firm-os/comms/drafts", () => {
  it("401 signed out, 403 inactive, 400 bad body, 403 not on the job, 404 unknown job", async () => {
    signedIn(null);
    expect((await create(req({ kind: "status", jobId: job.id }))).status).toBe(401);
    signedIn(activeSession({ id: "u-priya", active: false }));
    expect((await create(req({ kind: "status", jobId: job.id }))).status).toBe(403);
    signedIn(priya());
    expect((await create(req("not json"))).status).toBe(400);
    const bad = await create(req({ kind: "send-now" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Pick what the message is for");
    signedIn(activeSession({ id: "u-other" }));
    expect((await create(req({ kind: "status", jobId: job.id }))).status).toBe(403);
    signedIn(priya());
    expect((await create(req({ kind: "status", jobId: "missing" }))).status).toBe(404);
    expect(w.drafts).toEqual([]);
  });

  it("201 with the draft's link; 409 when the filing is not recorded", async () => {
    const r = await create(req({ kind: "status", jobId: job.id }));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ id: w.drafts[0].id, href: `/comms/${w.drafts[0].id}` });
    expect((await create(req({ kind: "filing-completed", jobId: job.id }))).status).toBe(409);
  });
});

describe("POST /api/firm-os/comms/drafts/[id]/outlook", () => {
  it("401 / 403 / 400 / 404; 412 without a mailbox token; 200 with the Outlook link", async () => {
    await create(req({ kind: "status", jobId: job.id }));
    const id = w.drafts[0].id;
    signedIn(null);
    expect((await outlook(req({}), ctx(id))).status).toBe(401);
    signedIn(activeSession({ id: "u-priya", active: false }));
    expect((await outlook(req({}), ctx(id))).status).toBe(403);
    signedIn(priya());
    expect((await outlook(req({}), ctx("../etc"))).status).toBe(400);
    expect((await outlook(req({}), ctx("missing"))).status).toBe(404);
    signedIn(activeSession({ id: "u-other" }));
    expect((await outlook(req({}), ctx(id))).status).toBe(403);
    signedIn(priya());
    token = null;
    const nt = await outlook(req({}), ctx(id));
    expect(nt.status).toBe(412);
    expect(await nt.json()).toMatchObject({ connect: "/connect?mail=1" });
    token = "tok";
    const ok = await outlook(req({}), ctx(id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ webLink: "https://outlook.office365.com/owa/?ItemID=AAMk-1", created: true });
    expect(created).toHaveLength(1);
    expect(w.drafts[0].outlookDraftId).toBe("AAMk-1");
  });
});

describe("/comms pages", () => {
  it("layout: signed out → /, inactive → /dashboard; nav for an active person", async () => {
    signedIn(null);
    expect(await redirectTarget(() => CommsLayout({ children: null }))).toBe("/");
    signedIn(activeSession({ active: false }));
    expect(await redirectTarget(() => CommsLayout({ children: null }))).toBe("/dashboard");
    // Staff do not get Client comms drafts by default; a manager does, and so does staff it is switched on for.
    signedIn(priya());
    expect(await redirectTarget(() => CommsLayout({ children: null }))).toBe("/dashboard?module-off=comms");
    ws.setting = workspaceRow(["comms", "agents"]);
    expect(await renderHtml(await CommsLayout({ children: null }))).toContain('href="/comms"');
    ws.setting = null;
    signedIn(activeSession({ id: "u-meena", level: "MANAGER" }));
    const html = clean(await renderHtml(await CommsLayout({ children: null })));
    expect(html).toContain('href="/comms"');
    expect(html).toContain("Client messages");
    expect(html).toContain('href="/agents"');
  });

  it("/comms lists the person's drafts with one primary action, New draft", async () => {
    const empty = clean(await renderHtml(await CommsPage(sp())));
    expect(empty).toContain("No drafts yet");
    await create(req({ kind: "status", jobId: job.id }));
    const html = clean(await renderHtml(await CommsPage(sp({ client: "ACME01" }))));
    expect(html).toContain("GSTR-3B for October 2026 (Acme Traders Private Limited): status update");
    expect(html).toContain(`href="/comms/${w.drafts[0].id}"`);
    expect(html).toContain('href="/comms/new?client=ACME01"');
    expect(html).toContain("New draft");
    expect(html).toContain("Status update");
    expect(html).not.toMatch(/\bSend\b/);
  });

  it("/comms/new: from a run (documents suggested), from a client, or asks for the client; 404 / 403", async () => {
    w.runs.push({ id: "run-1", agent: "tax", jobTaskId: job.id, checklist: [{ ruleId: "tax.missing-docs", status: "fail", message: "Ask the client / staff for: Form 26AS; Prior-year ITR", evidence: null }] });
    const fromRun = clean(await renderHtml(await NewDraftPage(sp({ run: "run-1" }))));
    expect(fromRun).toContain("Acme Traders Private Limited");
    expect(fromRun).toContain('value="Form 26AS"');
    expect(fromRun).toContain('value="Prior-year ITR"');
    expect(fromRun).toContain("Prepare draft");
    expect(fromRun).not.toMatch(/\bSend\b/);
    const fromClient = clean(await renderHtml(await NewDraftPage(sp({ client: "ACME01" }))));
    expect(fromClient).toContain("Your answer");
    const picker = clean(await renderHtml(await NewDraftPage(sp())));
    expect(picker).toContain("Which client is the message for?");
    expect(picker).toContain("ACME01 · Acme Traders Private Limited");
    await expect(NewDraftPage(sp({ run: "missing" }))).rejects.toBeInstanceOf(NotFoundSignal);
    signedIn(activeSession({ id: "u-other" }));
    expect(clean(await renderHtml(await NewDraftPage(sp({ job: job.id }))))).toContain("only for jobs you prepare or review");
  });

  it("/comms/[id]: a bilingual draft side by side, notes to check, Open in Outlook draft + Copy; 404", async () => {
    await create(req({ kind: "status", jobId: job.id }));
    const d = w.drafts[0];
    d.language = "kn";
    d.body = `ಆತ್ಮೀಯ Ravi Kumar,\n\n${ENGLISH_DIVIDER}\n\n${d.body}`;
    const html = clean(await renderHtml(await DraftPage(ctx(d.id))));
    expect(html).toContain("Kannada");
    expect(html).toContain("ಆತ್ಮೀಯ Ravi Kumar,");
    expect(html).toContain("English (sent below the Kannada)");
    expect(html).toContain("Check before you send");
    expect(html).toContain("Template wording: the drafting model is not available");
    expect(html).toContain("Open in Outlook draft");
    expect(html).toContain(">Copy<");
    expect(html).toContain("To: ravi@acme.test");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>[\s\S]*?History<\/button>/); // the draft's correction history
    expect(html).not.toMatch(/\bSend\b/);
    await expect(DraftPage(ctx("missing"))).rejects.toBeInstanceOf(NotFoundSignal);
    signedIn(activeSession({ id: "u-other" }));
    expect(clean(await renderHtml(await DraftPage(ctx(d.id))))).toContain("You can open a draft only if you wrote it");
  });
});
