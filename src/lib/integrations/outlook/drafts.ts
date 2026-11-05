// Outlook drafts in the signed-in staff member's OWN mailbox (Microsoft Graph, delegated token with
// Mail.ReadWrite from getUserGraphToken(userId, MAIL_SCOPES)). Draft only (non-negotiable 1):
//
//   POST /me/messages                                           create the draft (lands in Drafts)
//   POST /me/messages/{id}/attachments                          attach a file under 3 MB
//   POST /me/messages/{id}/attachments/createUploadSession      larger file: upload session, then
//                                                               PUT the bytes in 320 KiB-multiple chunks
//   GET  /me/messages/{id}?$select=id,isDraft,webLink           find an existing draft again
//
// Nothing else. There is no send, reply or forward call in this module (or anywhere in src/:
// tests/unit/no-send.test.ts scans for them), and graphCall() refuses any other path at run time.
// The person opens the draft in Outlook, checks it and sends it themselves.

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
/** Graph takes a file attachment inline only below 3 MB; above that it must use an upload session. */
export const INLINE_ATTACHMENT_MAX = 3 * 1024 * 1024;
/** Upload-session chunk: a multiple of 320 KiB, below Graph's 4 MB per request. */
export const UPLOAD_CHUNK = 320 * 1024 * 10;

export type DraftAttachment = { name: string; contentType: string; bytes: Uint8Array };
export type OutlookDraftInput = {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  bodyType?: "Text" | "HTML";
  attachments?: DraftAttachment[];
};
export type OutlookDraft = { id: string; webLink: string | null };
export type OutlookDeps = { fetch?: typeof fetch };

export class OutlookDraftError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OutlookDraftError";
  }
}

/** The only Graph paths this module calls (draft create, attachments, upload session, draft lookup). */
const DRAFT_PATH = /^\/me\/messages(?:\/[A-Za-z0-9%=_-]+(?:\/attachments(?:\/createUploadSession)?)?)?(?:\?\$select=[A-Za-z,]+)?$/;

export function isDraftOnlyPath(path: string): boolean {
  return DRAFT_PATH.test(path);
}

const isEmail = (s: string) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(s);

/** Upload URLs come back from Graph; only Microsoft's own HTTPS hosts are accepted. */
export function isMicrosoftUploadUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(?:^|\.)(?:graph\.microsoft\.com|outlook\.office\.com|outlook\.office365\.com|office\.com|office365\.com)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

async function graphCall<T>(token: string, method: "GET" | "POST", path: string, body: unknown, deps: OutlookDeps): Promise<{ status: number; data: T | null }> {
  if (!isDraftOnlyPath(path)) throw new OutlookDraftError(`Refused Graph path ${path}: this module only creates Outlook drafts`);
  const f = deps.fetch ?? fetch;
  const res = await f(`${GRAPH_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (method === "GET" && res.status === 404) return { status: 404, data: null };
  if (!res.ok) throw new OutlookDraftError(`Graph ${method} ${path.replace(/\/me\/messages\/[^/?]+/, "/me/messages/{id}")} failed: ${res.status} ${(await res.text()).slice(0, 300)}`, res.status);
  return { status: res.status, data: (await res.json().catch(() => null)) as T | null };
}

const recipients = (list: string[] | undefined) => (list ?? []).map((address) => ({ emailAddress: { address } }));

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}

async function uploadLarge(token: string, messageId: string, a: DraftAttachment, deps: OutlookDeps): Promise<void> {
  const session = await graphCall<{ uploadUrl?: string }>(
    token,
    "POST",
    `/me/messages/${encodeURIComponent(messageId)}/attachments/createUploadSession`,
    { AttachmentItem: { attachmentType: "file", name: a.name, size: a.bytes.byteLength, contentType: a.contentType } },
    deps,
  );
  const url = session.data?.uploadUrl;
  if (!url || !isMicrosoftUploadUrl(url)) throw new OutlookDraftError("Graph returned no usable upload URL for the attachment");
  const f = deps.fetch ?? fetch;
  const total = a.bytes.byteLength;
  for (let start = 0; start < total; start += UPLOAD_CHUNK) {
    const end = Math.min(start + UPLOAD_CHUNK, total);
    // The upload URL carries its own short-lived credential: Graph asks for no Authorization header here.
    const res = await f(url, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "Content-Range": `bytes ${start}-${end - 1}/${total}` },
      body: a.bytes.slice(start, end),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new OutlookDraftError(`Attachment upload failed at bytes ${start}-${end - 1}: ${res.status}`, res.status);
  }
}

/**
 * Create a draft message in the token owner's mailbox (Drafts folder), with attachments. Returns
 * the draft's id and its Outlook web link. Never sends.
 */
export async function createOutlookDraft(token: string, input: OutlookDraftInput, deps: OutlookDeps = {}): Promise<OutlookDraft> {
  const bad = [...input.to, ...(input.cc ?? [])].find((e) => !isEmail(e));
  if (bad) throw new OutlookDraftError(`Not an email address: ${bad}`, 400);
  if (!input.subject.trim()) throw new OutlookDraftError("A draft needs a subject", 400);
  const created = await graphCall<{ id?: string; webLink?: string }>(
    token,
    "POST",
    "/me/messages",
    { subject: input.subject, body: { contentType: input.bodyType ?? "Text", content: input.body }, toRecipients: recipients(input.to), ccRecipients: recipients(input.cc) },
    deps,
  );
  const id = created.data?.id;
  if (!id) throw new OutlookDraftError("Graph created no draft id");
  for (const a of input.attachments ?? []) {
    if (a.bytes.byteLength < INLINE_ATTACHMENT_MAX) {
      await graphCall(token, "POST", `/me/messages/${encodeURIComponent(id)}/attachments`, { "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.contentType, contentBytes: toBase64(a.bytes) }, deps);
    } else {
      await uploadLarge(token, id, a, deps);
    }
  }
  return { id, webLink: created.data?.webLink ?? null };
}

/** An existing message in the token owner's mailbox, or null when it is gone (sent, moved or deleted by the person). */
export async function findOutlookDraft(token: string, id: string, deps: OutlookDeps = {}): Promise<{ id: string; isDraft: boolean; webLink: string | null } | null> {
  const r = await graphCall<{ id?: string; isDraft?: boolean; webLink?: string }>(token, "GET", `/me/messages/${encodeURIComponent(id)}?$select=id,isDraft,webLink`, undefined, deps);
  if (!r.data?.id) return null;
  return { id: r.data.id, isDraft: r.data.isDraft === true, webLink: r.data.webLink ?? null };
}
