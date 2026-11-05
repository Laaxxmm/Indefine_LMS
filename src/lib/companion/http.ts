// HTTP edge of GET /api/firm-os/companion/next-task, the side panel's only call.
//
//   auth     `Authorization: Bearer <pairing token>`. No cookie is read or set, and no session.
//   CORS     answers only the configured extension origin (FIRM_OS_COMPANION_EXTENSION_ORIGIN),
//            never with Access-Control-Allow-Credentials. A request from any other browser origin
//            is refused with 403; one with no Origin header (not a browser page) is treated like
//            the extension, because the token is the gate.
//   limit    per token (by its hash), before any database work.
//   order    origin → token present → rate limit → token valid → person active → companion access
//            → provider.nextTask. Every refusal is one plain sentence in { error }.
//
// CORS lives here, in the route handler, not in next.config.ts (which belongs to hardening).
import { NextResponse } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { isActive } from "@/lib/access";
import { hasCompanionAccess, type CompanionUser } from "./access";
import { MSG } from "./messages";
import type { CompanionProvider } from "./provider";
import type { RateLimiter } from "./rate-limit";
import { hashToken, isTokenShape, readBearer, verifyPairing, type VerifyFailure } from "./tokens";

// ------------------------------------------------------------------ CORS

/** The Origin to echo back (allowed), or whether the request came from a browser origin we refuse. */
export function corsOrigin(req: Request, origins: readonly string[]): { allowed: string | null; rejected: boolean } {
  const origin = req.headers.get("origin");
  if (!origin) return { allowed: null, rejected: false };
  return origins.includes(origin) ? { allowed: origin, rejected: false } : { allowed: null, rejected: true };
}

function json(body: unknown, status: number, allowOrigin: string | null, extra: Record<string, string> = {}): Response {
  const headers: Record<string, string> = { "cache-control": "no-store", vary: "Origin", ...extra };
  if (allowOrigin) {
    headers["access-control-allow-origin"] = allowOrigin;
    headers["access-control-expose-headers"] = "Retry-After";
  }
  return NextResponse.json(body, { status, headers });
}

/** OPTIONS: 204 with the CORS grant for the extension origin; 403 (no grant) for anything else. */
export function handlePreflight(req: Request, origins: readonly string[]): Response {
  const { allowed } = corsOrigin(req, origins);
  if (!allowed) return new Response(null, { status: 403, headers: { vary: "Origin" } });
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": allowed,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Authorization",
      "access-control-max-age": "600",
      vary: "Origin",
    },
  });
}

// ------------------------------------------------------------------ next-task

export type NextTaskDb = Pick<PrismaClient, "companionToken" | "user" | "workspaceSetting">;

export type NextTaskDeps = {
  db: NextTaskDb;
  provider: CompanionProvider;
  limiter: RateLimiter;
  origins: readonly string[];
  now?: () => Date;
};

const REFUSED: Record<VerifyFailure, string> = {
  missing: MSG.tokenMissing,
  unknown: MSG.tokenUnknown,
  revoked: MSG.tokenRevoked,
  expired: MSG.tokenExpired,
};

/** The token owner as a session-shaped user (the access predicates take that shape). */
export async function loadCompanionUser(db: Pick<PrismaClient, "user">, userId: string): Promise<CompanionUser | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, image: true, role: true, level: true, department: true, active: true } });
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, image: u.image, role: u.role, level: u.level, department: u.department, active: u.active };
}

export async function handleNextTask(req: Request, deps: NextTaskDeps): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const cors = corsOrigin(req, deps.origins);
  if (cors.rejected) return json({ error: MSG.wrongOrigin }, 403, null);
  const send = (body: unknown, status: number, extra?: Record<string, string>) => json(body, status, cors.allowed, extra);

  const raw = readBearer(req.headers.get("authorization"));
  if (!raw) return send({ error: MSG.tokenMissing }, 401, { "www-authenticate": "Bearer" });
  // Malformed tokens never reach the database (verifyPairing refuses them without a query).
  if (isTokenShape(raw)) {
    const decision = await deps.limiter.hit(`companion:${hashToken(raw)}`, now);
    if (!decision.ok) return send({ error: MSG.rateLimited }, 429, { "retry-after": String(decision.retryAfterSec) });
  }
  try {
    const verified = await verifyPairing(deps.db, raw, now);
    if (!verified.ok) return send({ error: REFUSED[verified.reason] }, 401, { "www-authenticate": "Bearer" });
    const user = await loadCompanionUser(deps.db, verified.userId);
    if (!user || !isActive(user)) return send({ error: MSG.accountInactive }, 403);
    if (!(await hasCompanionAccess(deps.db, user))) return send({ error: MSG.noAccess }, 403);
    return send(await deps.provider.nextTask(user, now), 200);
  } catch (e) {
    console.error("[companion] next-task failed", e);
    return send({ error: MSG.serverError }, 500);
  }
}
