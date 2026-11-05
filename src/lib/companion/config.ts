// Firm OS Companion (read-only Chrome side panel) — settings as data. Nothing here reads the
// database or the clock. The extension lives in firm-os-companion-extension/; this module and the
// routes under src/app/api/firm-os/companion/ are its whole server side.
//
// The companion never files, signs, pays, enters OTPs or sends anything (orchestrator
// NON-NEGOTIABLE 1). Its pairing tokens are accepted by exactly one route, the read-only
// GET /api/firm-os/companion/next-task; no route that writes accepts them. That is the token's
// scope: there is no scope column, because there is nothing else a token could be allowed to do.

/** Prefix that makes a pasted companion token recognisable (and greppable in a leak report). */
export const COMPANION_TOKEN_PREFIX = "fosc_";
/** Random bytes per token (256 bits), base64url-encoded to 43 characters after the prefix. */
export const COMPANION_TOKEN_BYTES = 32;
/** A pairing stops working this many days after it was created. */
export const COMPANION_TOKEN_TTL_DAYS = 90;
/** Active (not revoked, not expired) pairings a person may hold at once. */
export const COMPANION_MAX_ACTIVE_TOKENS = 5;
/** Longest label a person can give a pairing ("Office desktop — Chrome"). */
export const COMPANION_LABEL_MAX = 60;

/**
 * Requests per token per window for GET next-task. The side panel polls once a minute while it is
 * visible, plus manual refreshes, so 20 a minute is generous for a person and tight for a script.
 * In-process only (each server instance counts on its own); Phase 11's database limiter
 * (RateLimitBucket) plugs into the RateLimiter interface in rate-limit.ts.
 */
export const COMPANION_RATE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

/** Most jobs listed under "Later" in the side panel. */
export const COMPANION_QUEUE_MAX = 5;
/** Most amounts copied from an approved pack. */
export const COMPANION_FIGURES_MAX = 24;

/**
 * Env var holding the extension origin(s) allowed by CORS, comma-separated:
 * `chrome-extension://<32-letter id>`. The id is shown on chrome://extensions after loading the
 * extension unpacked; a packed (store or policy-installed) build has a fixed id.
 */
export const COMPANION_ORIGIN_ENV = "FIRM_OS_COMPANION_EXTENSION_ORIGIN";

const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;

/** The configured extension origins; malformed entries are ignored, never loosened to "*". */
export function allowedExtensionOrigins(env: Record<string, string | undefined> = process.env): string[] {
  return (env[COMPANION_ORIGIN_ENV] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter((s) => EXTENSION_ORIGIN_RE.test(s));
}
