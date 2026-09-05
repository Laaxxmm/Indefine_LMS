// Shared-secret handshake for every /api/cron/* route. GitHub Actions workflows send
// `Authorization: Bearer $CRON_SECRET`. The query-string form is not accepted: a secret
// in a URL ends up in HTTP logs on Railway and anything in between. The same CRON_SECRET
// must be set on Railway and as a repository Actions secret.
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/** The 401 response to send, or null when the caller holds the secret. */
export function cronUnauthorized(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !safeEqual(provided, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

/** Length check first, then a constant-time compare, so the response time leaks nothing. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
