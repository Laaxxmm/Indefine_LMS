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
// check it, so a forged cookie only buys the 2 MB tier, or a large tier on the listed upload routes,
// where the route still checks the session itself and reads the body with a running byte count.
// Re-audit NEW-6: the two admin uploads (course handouts, live-session materials) are route
// handlers now, so experimental.serverActions.bodySizeLimit in next.config.ts is 2 MB like the tier.
//
// A body sent with Transfer-Encoding (no Content-Length) cannot be measured here. Re-audit NEW-6:
// it is refused (411) on every route except the listed upload routes, whoever sends it (browsers
// always send a length for form and fetch bodies); the upload routes count the bytes as they arrive
// (readUploadForm / readMultipartUpload / readFormDataCapped), and every JSON reader is capped too
// (src/lib/hardening/json-body.ts).
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
  { pattern: /^\/api\/admin\/video\/[^/]+\/materials\/?$/, maxBytes: 51 * MB, auth: "session", why: "course handout upload: 50 MB per file (MATERIAL_MAX_BYTES) + multipart framing" },
  { pattern: /^\/api\/admin\/live\/schedule\/?$/, maxBytes: 51 * MB, auth: "session", why: "live-session materials: 50 MB in all (MATERIAL_MAX_BYTES) + multipart framing" },
  { pattern: /^\/api\/tools\/statutory\/ingest\/?$/, maxBytes: 24 * MB, auth: "bearer", why: "statutory extension: 3 items per post, PDFs up to 4 MB each as base64" },
];

/** The largest body any route accepts. */
export const MAX_LARGE_BODY = Math.max(...LARGE_BODY_ROUTES.map((r) => r.maxBytes));

/** experimental.serverActions.bodySizeLimit in next.config.ts: server actions take no uploads, so the signed-in tier. */
export const SERVER_ACTION_BODY_LIMIT = "2mb";

/** The listed upload route for this path, when the caller presents the credential it needs. */
function largeRouteFor(r: Pick<BodyRequest, "pathname" | "hasSession" | "hasBearer">): LargeBodyRoute | undefined {
  const large = LARGE_BODY_ROUTES.find((x) => x.pattern.test(r.pathname));
  return large && ((large.auth === "session" && r.hasSession) || (large.auth === "bearer" && r.hasBearer)) ? large : undefined;
}

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
  const large = largeRouteFor(r);
  return large ? Math.max(tier, large.maxBytes) : tier;
}

/** Allow, or refuse with 400 (bad length) / 411 (anonymous body with no length) / 413 (too large). */
export function checkBody(r: BodyRequest): BodyVerdict {
  const limit = bodyLimitFor(r);
  if (limit === null) return { ok: true, limit: null };
  const raw = r.contentLength?.trim() ?? "";
  if (raw === "") {
    const streamed = !!r.transferEncoding && r.transferEncoding.trim().toLowerCase() !== "identity";
    // Re-audit NEW-6: a body with no length is refused everywhere but the listed upload routes (which count the bytes as they arrive).
    if (streamed && !largeRouteFor(r)) return { ok: false, status: 411, limit, message: "This request could not be read. Send it again from the Firm OS page." };
    return { ok: true, limit };
  }
  if (!/^\d{1,15}$/.test(raw)) return { ok: false, status: 400, limit, message: "This request could not be read. Send it again from the Firm OS page." };
  const size = Number(raw);
  if (size > limit) return { ok: false, status: 413, limit, message: `This is too large to send (${mb(size)}). The limit here is ${mb(limit)} — send a smaller file or fewer files at a time.` };
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
