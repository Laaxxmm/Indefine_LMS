// Request body size limits, enforced by src/middleware.ts BEFORE Next reads a body (security audit #9).
//
// Next decodes a server-action POST (any page path, the public sign-in page included) before it
// checks the action id, up to experimental.serverActions.bodySizeLimit; route handlers read
// req.json() / req.formData() with no limit at all. The middleware refuses by the declared
// Content-Length first, so an oversized body is never buffered:
//
//   no session cookie and no Authorization header (anonymous) ......  64 KB
//   bearer-token callers (cron, companion, Turia relay) .............   1 MB
//   signed-in (session cookie) ......................................   2 MB
//   the few routes that legitimately take large bodies (LARGE_BODY_ROUTES) get their own limit,
//   and only when the caller presents the credential the route needs.
//
// "Signed in" here means a session cookie is present: the middleware cannot open the database to
// check it, so a forged cookie only buys the 2 MB tier, or a large tier on the listed paths, where
// the route / action still checks the session itself. experimental.serverActions.bodySizeLimit in
// next.config.ts is the ceiling for the two admin upload actions; drop it to 2 MB once those
// uploads move to route handlers (they can then use readUploadForm()).
//
// A body sent with Transfer-Encoding (no Content-Length) cannot be measured here. Anonymous callers
// get 411 Length Required (browsers always send a length for form and fetch bodies); signed-in and
// bearer callers pass, bounded by bodySizeLimit for actions and by readFormDataCapped() /
// readUploadForm() in upload routes.
//
// Pure and edge-safe (no Node imports): the middleware runs in the edge runtime.

const KB = 1024;
const MB = 1024 * KB;

export const BODY_LIMITS = {
  anonymous: 64 * KB,
  bearer: 1 * MB,
  session: 2 * MB,
} as const;

export type BodyAuth = "session" | "bearer";

export type LargeBodyRoute = { pattern: RegExp; maxBytes: number; auth: BodyAuth; why: string };

/** Paths allowed a larger body than their tier. Keep in step with the route's own limit. */
export const LARGE_BODY_ROUTES: readonly LargeBodyRoute[] = [
  { pattern: /^\/api\/clients\/[^/]+\/documents\/?$/, maxBytes: 51 * MB, auth: "session", why: "client document upload: 50 MB per file (MAX_UPLOAD_BYTES) + multipart framing" },
  { pattern: /^\/api\/tools\/office-tools\/tax\/[^/]+\/?$/, maxBytes: 50 * MB, auth: "session", why: "return PDFs for the tax tools (~100 KB each, several at once)" },
  { pattern: /^\/api\/tools\/engagement-letters\/[^/]+\/file\/?$/, maxBytes: 4 * MB, auth: "session", why: "engagement-letter PDF (3 MB limit in the route)" },
  { pattern: /^\/admin\/video\/[^/]+\/?$/, maxBytes: 51 * MB, auth: "session", why: "course handout server action: up to 50 MB per file" },
  { pattern: /^\/admin\/live\/?$/, maxBytes: 51 * MB, auth: "session", why: "live-session materials server action" },
  { pattern: /^\/api\/tools\/statutory\/ingest\/?$/, maxBytes: 24 * MB, auth: "bearer", why: "statutory extension: 3 items per post, PDFs up to 4 MB each as base64" },
];

/** The largest body any route accepts; next.config.ts sizes serverActions.bodySizeLimit to the admin actions above. */
export const MAX_LARGE_BODY = Math.max(...LARGE_BODY_ROUTES.map((r) => r.maxBytes));

/** NextAuth v5 (and v4) session cookie names, plain and __Secure- prefixed. */
export const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token", "next-auth.session-token", "__Secure-next-auth.session-token"] as const;

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type BodyRequest = {
  method: string;
  pathname: string;
  /** The Content-Length header as sent (null when absent). */
  contentLength: string | null;
  /** The Transfer-Encoding header as sent (null when absent). */
  transferEncoding: string | null;
  hasSession: boolean;
  hasBearer: boolean;
};

export type BodyVerdict = { ok: true; limit: number | null } | { ok: false; status: 400 | 411 | 413; limit: number; message: string };

const mb = (n: number) => (n >= MB ? `${(n / MB).toFixed(n % MB === 0 ? 0 : 1)} MB` : `${Math.round(n / KB)} KB`);

/** The limit for this request (null: the method carries no body we limit, e.g. GET). */
export function bodyLimitFor(r: Pick<BodyRequest, "method" | "pathname" | "hasSession" | "hasBearer">): number | null {
  if (!BODY_METHODS.has(r.method.toUpperCase())) return null;
  const tier = r.hasSession ? BODY_LIMITS.session : r.hasBearer ? BODY_LIMITS.bearer : BODY_LIMITS.anonymous;
  const large = LARGE_BODY_ROUTES.find((x) => x.pattern.test(r.pathname));
  if (large && ((large.auth === "session" && r.hasSession) || (large.auth === "bearer" && r.hasBearer))) return Math.max(tier, large.maxBytes);
  return tier;
}

/** Allow, or refuse with 400 (bad length) / 411 (anonymous body with no length) / 413 (too large). */
export function checkBody(r: BodyRequest): BodyVerdict {
  const limit = bodyLimitFor(r);
  if (limit === null) return { ok: true, limit: null };
  const raw = r.contentLength?.trim() ?? "";
  if (raw === "") {
    const streamed = !!r.transferEncoding && r.transferEncoding.trim().toLowerCase() !== "identity";
    if (streamed && !r.hasSession && !r.hasBearer) return { ok: false, status: 411, limit, message: "Send this request with a Content-Length header." };
    return { ok: true, limit };
  }
  if (!/^\d{1,15}$/.test(raw)) return { ok: false, status: 400, limit, message: "The Content-Length header is not a number." };
  const size = Number(raw);
  if (size > limit) return { ok: false, status: 413, limit, message: `This request is too large (${mb(size)}). The limit here is ${mb(limit)}.` };
  return { ok: true, limit };
}

/** Is a NextAuth session cookie present in this Cookie header? (Presence only; the route checks it.) */
export function hasSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return false;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    // NextAuth may split a large cookie into name.0, name.1, ...
    const base = name.replace(/\.\d+$/, "");
    return (SESSION_COOKIES as readonly string[]).includes(base) && value.length >= 16;
  });
}

/** Does the request carry an `Authorization: Bearer <token>` header? */
export function hasBearerToken(authorization: string | null): boolean {
  return !!authorization && /^Bearer\s+\S{16,}$/i.test(authorization.trim());
}
