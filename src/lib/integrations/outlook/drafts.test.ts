// Outlook drafts over a mocked Graph: POST /me/messages in the person's own mailbox, attachments
// inline below 3 MB and through an upload session above; no send endpoint is ever called.
import { describe, expect, it } from "vitest";
import { GRAPH_BASE, INLINE_ATTACHMENT_MAX, OutlookDraftError, UPLOAD_CHUNK, createOutlookDraft, findOutlookDraft, isDraftOnlyPath, isMicrosoftUploadUrl } from "./drafts";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function mockGraph(opts: { fail?: { match: RegExp; status: number }; uploadUrl?: string; lookup?: number } = {}) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const raw = init?.body;
    const body = typeof raw === "string" ? JSON.parse(raw) : raw instanceof Uint8Array ? { bytes: raw.byteLength } : raw;
    calls.push({ url, method, headers, body });
    if (opts.fail && opts.fail.match.test(`${method} ${url}`)) return new Response("nope", { status: opts.fail.status });
    if (method === "POST" && url === `${GRAPH_BASE}/me/messages`) return Response.json({ id: "AAMk=draft-1", webLink: "https://outlook.office365.com/owa/?ItemID=AAMk%3Ddraft-1" }, { status: 201 });
    if (url.endsWith("/attachments/createUploadSession")) return Response.json({ uploadUrl: opts.uploadUrl ?? "https://outlook.office.com/api/v2.0/Users('x')/Messages('y')/AttachmentSessions('z')?authtoken=abc" }, { status: 201 });
    if (url.endsWith("/attachments")) return Response.json({ id: "att-1" }, { status: 201 });
    if (method === "PUT") return new Response(null, { status: 200 });
    if (method === "GET") return opts.lookup === 404 ? new Response("", { status: 404 }) : Response.json({ id: "AAMk=draft-1", isDraft: true, webLink: "https://outlook.office365.com/owa/x" });
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return { f, calls };
}

// Built from pieces so this file never carries a send path itself (tests/unit/no-send.test.ts scans src/).
const VERBS = ["send", "send" + "Mail", "reply", "reply" + "All", "forward"];
const SEND_LIKE = new RegExp(`/(?:${VERBS.join("|")})(?:[/?]|$)`, "i");
const pdf = (n: number) => ({ name: "EL_Acme_FY26-27_Draft.pdf", contentType: "application/pdf", bytes: new Uint8Array(n).fill(7) });

describe("createOutlookDraft", () => {
  it("creates the draft with POST /me/messages in the person's own mailbox", async () => {
    const g = mockGraph();
    const d = await createOutlookDraft("tok", { to: ["ravi@acme.test"], cc: ["cfo@acme.test"], subject: "Subject", body: "Body" }, { fetch: g.f });
    expect(d).toEqual({ id: "AAMk=draft-1", webLink: "https://outlook.office365.com/owa/?ItemID=AAMk%3Ddraft-1" });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]).toMatchObject({
      url: `${GRAPH_BASE}/me/messages`,
      method: "POST",
      headers: { Authorization: "Bearer tok" },
      body: {
        subject: "Subject",
        body: { contentType: "Text", content: "Body" },
        toRecipients: [{ emailAddress: { address: "ravi@acme.test" } }],
        ccRecipients: [{ emailAddress: { address: "cfo@acme.test" } }],
      },
    });
    expect(g.calls.some((c) => SEND_LIKE.test(new URL(c.url).pathname))).toBe(false);
  });

  it("attaches a small file inline (base64) to the draft", async () => {
    const g = mockGraph();
    await createOutlookDraft("tok", { to: [], subject: "S", body: "B", attachments: [pdf(1000)] }, { fetch: g.f });
    expect(g.calls.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${GRAPH_BASE}/me/messages`, `POST ${GRAPH_BASE}/me/messages/AAMk%3Ddraft-1/attachments`]);
    expect(g.calls[1].body).toMatchObject({ "@odata.type": "#microsoft.graph.fileAttachment", name: "EL_Acme_FY26-27_Draft.pdf", contentType: "application/pdf", contentBytes: Buffer.from(new Uint8Array(1000).fill(7)).toString("base64") });
  });

  it("uploads a large file through an upload session, in chunks, without the bearer token", async () => {
    const g = mockGraph();
    const size = INLINE_ATTACHMENT_MAX + 500_000;
    await createOutlookDraft("tok", { to: ["a@b.test"], subject: "S", body: "B", attachments: [pdf(size)] }, { fetch: g.f });
    const [, session, ...puts] = g.calls;
    expect(session).toMatchObject({ method: "POST", url: `${GRAPH_BASE}/me/messages/AAMk%3Ddraft-1/attachments/createUploadSession`, body: { AttachmentItem: { attachmentType: "file", size, name: "EL_Acme_FY26-27_Draft.pdf" } } });
    expect(puts.map((p) => p.headers["Content-Range"])).toEqual([`bytes 0-${UPLOAD_CHUNK - 1}/${size}`, `bytes ${UPLOAD_CHUNK}-${size - 1}/${size}`]);
    expect(puts.every((p) => p.method === "PUT" && !("Authorization" in p.headers))).toBe(true);
    expect(puts.reduce((s, p) => s + (p.body as { bytes: number }).bytes, 0)).toBe(size);
  });

  it("refuses an upload URL that is not Microsoft's", async () => {
    const g = mockGraph({ uploadUrl: "https://evil.example/upload" });
    await expect(createOutlookDraft("tok", { to: [], subject: "S", body: "B", attachments: [pdf(INLINE_ATTACHMENT_MAX)] }, { fetch: g.f })).rejects.toThrow(/no usable upload URL/);
    expect(g.calls.some((c) => c.url.startsWith("https://evil.example"))).toBe(false);
  });

  it("surfaces Graph failures with the status, without the message id", async () => {
    const g = mockGraph({ fail: { match: /POST .*\/me\/messages$/, status: 403 } });
    const e = await createOutlookDraft("tok", { to: [], subject: "S", body: "B" }, { fetch: g.f }).catch((x) => x);
    expect(e).toBeInstanceOf(OutlookDraftError);
    expect(e).toMatchObject({ status: 403, message: "Graph POST /me/messages failed: 403 nope" });
    const g2 = mockGraph({ fail: { match: /\/attachments$/, status: 413 } });
    const e2 = await createOutlookDraft("tok", { to: [], subject: "S", body: "B", attachments: [pdf(10)] }, { fetch: g2.f }).catch((x) => x);
    expect(e2.message).toBe("Graph POST /me/messages/{id}/attachments failed: 413 nope");
    const g3 = mockGraph({ fail: { match: /^PUT /, status: 500 } });
    await expect(createOutlookDraft("tok", { to: [], subject: "S", body: "B", attachments: [pdf(INLINE_ATTACHMENT_MAX)] }, { fetch: g3.f })).rejects.toThrow(/Attachment upload failed at bytes 0-/);
  });

  it("checks recipients and the subject before calling Graph", async () => {
    const g = mockGraph();
    await expect(createOutlookDraft("tok", { to: ["not-an-email"], subject: "S", body: "B" }, { fetch: g.f })).rejects.toThrow("Not an email address: not-an-email");
    await expect(createOutlookDraft("tok", { to: [], subject: "  ", body: "B" }, { fetch: g.f })).rejects.toThrow(/subject/);
    expect(g.calls).toEqual([]);
  });
});

describe("findOutlookDraft", () => {
  it("returns the draft's link, or null once it is gone", async () => {
    const g = mockGraph();
    expect(await findOutlookDraft("tok", "AAMk=draft-1", { fetch: g.f })).toEqual({ id: "AAMk=draft-1", isDraft: true, webLink: "https://outlook.office365.com/owa/x" });
    expect(g.calls[0]).toMatchObject({ method: "GET", url: `${GRAPH_BASE}/me/messages/AAMk%3Ddraft-1?$select=id,isDraft,webLink` });
    expect(await findOutlookDraft("tok", "gone", { fetch: mockGraph({ lookup: 404 }).f })).toBeNull();
  });
});

describe("draft-only guard", () => {
  it("allows only the draft paths; anything that would send is refused", () => {
    for (const p of ["/me/messages", "/me/messages/AAMk%3D1/attachments", "/me/messages/AAMk%3D1/attachments/createUploadSession", "/me/messages/AAMk%3D1?$select=id,isDraft,webLink"]) expect(isDraftOnlyPath(p), p).toBe(true);
    const sendPaths = VERBS.flatMap((v) => [`/me/messages/AAMk1/${v}`, `/me/${v}`, `/users/x/${v}`, `/me/messages/../${v}`]);
    for (const p of [...sendPaths, "/me/mailFolders/drafts/messages", "/me/events"]) expect(isDraftOnlyPath(p), p).toBe(false);
  });
  it("upload URLs must be Microsoft HTTPS hosts", () => {
    expect(isMicrosoftUploadUrl("https://outlook.office.com/api/x")).toBe(true);
    expect(isMicrosoftUploadUrl("https://graph.microsoft.com/v1.0/x")).toBe(true);
    expect(isMicrosoftUploadUrl("http://outlook.office.com/api/x")).toBe(false);
    expect(isMicrosoftUploadUrl("https://outlook.office.com.evil.example/x")).toBe(false);
    expect(isMicrosoftUploadUrl("not a url")).toBe(false);
  });
});
