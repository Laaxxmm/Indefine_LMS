// Shared-secret handshake for every /api/cron/* route. GitHub Actions workflows call
// these with `Authorization: Bearer $CRON_SECRET` (the older ingest workflow uses
// `?key=`); both are accepted. The same CRON_SECRET must be set on Railway and as a
// repository Actions secret.
import { NextRequest, NextResponse } from "next/server";

/** The 401 response to send, or null when the caller holds the secret. */
export function cronUnauthorized(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const provided = req.nextUrl.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}
