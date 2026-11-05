// Engagement letters: "Create Outlook draft" (owner decision 2026-11-05) puts the email with the
// letter PDF into the staff member's own mailbox as a draft — Graph POST /me/messages + attachment —
// and never sends it. The letter moves to the closest existing stage (SENT_FOR_APPROVAL / SENT).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession } from "./harness";

type Letter = { id: string; clientName: string; fy: string; status: string; graphDriveId: string | null; draftItemId: string | null; signedItemId: string | null; [k: string]: unknown };
const db = { letters: [] as Letter[], events: [] as Record<string, unknown>[] };

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    engagementLetter: {
      findUnique: async (a: { where: { id: string } }) => db.letters.find((l) => l.id === a.where.id) ?? null,
      update: async (a: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(db.letters.find((l) => l.id === a.where.id)!, a.data),
    },
    engagementLetterEvent: { create: async (a: { data: Record<string, unknown> }) => void db.events.push(a.data) },
  },
}));
vi.mock("@/lib/graph", () => ({ getUserGraphToken: vi.fn(), getAppOnlyToken: vi.fn(), downloadDriveItem: vi.fn() }));

const { auth } = await import("@/lib/auth");
const graph = await import("@/lib/graph");
const { MAIL_SCOPES } = await import("@/lib/graph-scopes");
const { POST } = await import("@/app/api/tools/engagement-letters/[id]/outlook-draft/route");

const signedIn = (s: unknown) => (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(s);
const mocked = <T extends (...a: never[]) => unknown>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const req = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const mail = (over: Record<string, unknown> = {}) => ({ kind: "draft", to: "ceo@acme.test, ravi@acme.test", cc: "", subject: "Draft Engagement Letter for your approval - Acme - FY 2026-27", text: "Dear Mr. Ravi Kumar,\n\nPlease find attached the draft.", ...over });

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let graphFails = false;
beforeEach(() => {
  db.letters = [{ id: "el-1", clientName: "Acme", fy: "26-27", status: "DRAFT_UPLOADED", graphDriveId: "drive-1", draftItemId: "item-draft", signedItemId: null }];
  db.events = [];
  calls = [];
  graphFails = false;
  signedIn(activeSession({ id: "u-priya", name: "Priya Sharma" }));
  mocked(graph.getUserGraphToken).mockResolvedValue("mail-token");
  mocked(graph.getAppOnlyToken).mockResolvedValue("app-token");
  mocked(graph.downloadDriveItem).mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    if (graphFails) return new Response("denied", { status: 403 });
    if (url.endsWith("/me/messages")) return Response.json({ id: "AAMk-el", webLink: "https://outlook.office365.com/owa/?ItemID=AAMk-el" }, { status: 201 });
    return Response.json({ id: "att-1" }, { status: 201 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const SEND_VERBS = new RegExp(`/(?:${["send", "send" + "Mail", "reply", "forward"].join("|")})(?:[/?]|$)`, "i");

describe("POST /api/tools/engagement-letters/[id]/outlook-draft", () => {
  it("creates the approval email as a draft in the person's own mailbox, with the PDF attached; never sends", async () => {
    const r = await POST(req(mail()), ctx("el-1"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, webLink: "https://outlook.office365.com/owa/?ItemID=AAMk-el" });
    expect(mocked(graph.getUserGraphToken)).toHaveBeenCalledWith("u-priya", MAIL_SCOPES);
    expect(MAIL_SCOPES.split(" ")).toContain("Mail.ReadWrite");
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /v1.0/me/messages", "POST /v1.0/me/messages/AAMk-el/attachments"]);
    expect(calls[0].body).toMatchObject({
      subject: "Draft Engagement Letter for your approval - Acme - FY 2026-27",
      body: { contentType: "Text", content: "Dear Mr. Ravi Kumar,\n\nPlease find attached the draft." },
      toRecipients: [{ emailAddress: { address: "ceo@acme.test" } }, { emailAddress: { address: "ravi@acme.test" } }],
      ccRecipients: [],
    });
    expect(calls[1].body).toMatchObject({ name: "EL_Acme_FY26-27_Draft.pdf", contentType: "application/pdf", contentBytes: "JVBERg==" });
    expect(calls.some((c) => SEND_VERBS.test(new URL(c.url).pathname))).toBe(false);
    expect(db.letters[0]).toMatchObject({ status: "SENT_FOR_APPROVAL", updatedByName: "Priya Sharma" });
    expect(db.letters[0].draftSentAt).toBeInstanceOf(Date);
    expect(db.events).toEqual([{ letterId: "el-1", action: "draft-outlook-draft", detail: "Outlook draft for ceo@acme.test, ravi@acme.test, to be sent by Priya Sharma from Outlook", byId: "u-priya", byName: "Priya Sharma" }]);
  });

  it("the signed letter: draft with the signed PDF; the letter moves to SENT with the recipients", async () => {
    db.letters[0] = { ...db.letters[0], status: "SIGNED", signedItemId: "item-signed" };
    const r = await POST(req(mail({ kind: "signed", cc: "cfo@acme.test" })), ctx("el-1"));
    expect(r.status).toBe(200);
    expect(calls[1].body).toMatchObject({ name: "EL_Acme_FY26-27.pdf" });
    expect(db.letters[0]).toMatchObject({ status: "SENT", sentTo: "ceo@acme.test, ravi@acme.test, cfo@acme.test" });
    expect(db.events[0]).toMatchObject({ action: "signed-outlook-draft" });
  });

  it("401 / 403 / 404 / 409 / 400, and nothing reaches Graph", async () => {
    signedIn(null);
    expect((await POST(req(mail()), ctx("el-1"))).status).toBe(401);
    signedIn(activeSession({ active: false }));
    expect((await POST(req(mail()), ctx("el-1"))).status).toBe(403);
    signedIn(activeSession());
    expect((await POST(req(mail()), ctx("missing"))).status).toBe(404);
    expect((await POST(req(mail({ kind: "signed" })), ctx("el-1"))).status).toBe(409); // not signed yet
    expect((await POST(req(mail({ to: "" })), ctx("el-1"))).status).toBe(400);
    const bad = await POST(req(mail({ to: "ceo@acme.test, nope" })), ctx("el-1"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("Not an email address: nope");
    expect((await POST(req(mail({ subject: " " })), ctx("el-1"))).status).toBe(400);
    expect(calls).toEqual([]);
    expect(db.letters[0].status).toBe("DRAFT_UPLOADED");
  });

  it("412 with the connect link when the mailbox is not connected; 502 when SharePoint or Outlook fails", async () => {
    mocked(graph.getUserGraphToken).mockResolvedValueOnce(null);
    const nt = await POST(req(mail()), ctx("el-1"));
    expect(nt.status).toBe(412);
    expect(await nt.json()).toMatchObject({ connect: "/connect?mail=1" });
    mocked(graph.getAppOnlyToken).mockResolvedValueOnce(null);
    expect((await POST(req(mail()), ctx("el-1"))).status).toBe(502);
    graphFails = true;
    const failed = await POST(req(mail()), ctx("el-1"));
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toMatch(/Outlook could not create the draft/);
    expect(db.letters[0].status).toBe("DRAFT_UPLOADED");
    expect(db.events).toEqual([]);
  });
});
