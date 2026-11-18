// Refuses oversized request bodies before Next reads them (security audit #9). The limits and the
// reasoning live in src/lib/hardening/body-limits.ts. Nothing else happens here: no auth decisions,
// no rewrites, and GET / HEAD requests pass straight through.
import { NextResponse, type NextRequest } from "next/server";
import { checkBody, hasBearerToken, hasSessionCookie } from "@/lib/hardening/body-limits";

export function middleware(req: NextRequest) {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return NextResponse.next();
  const verdict = checkBody({
    method,
    pathname: req.nextUrl.pathname,
    contentLength: req.headers.get("content-length"),
    transferEncoding: req.headers.get("transfer-encoding"),
    hasSession: hasSessionCookie(req.headers.get("cookie")),
    hasBearer: hasBearerToken(req.headers.get("authorization")),
  });
  if (verdict.ok) return NextResponse.next();
  return NextResponse.json(
    { error: verdict.message, limit: verdict.limit },
    { status: verdict.status, headers: { "Cache-Control": "no-store" } },
  );
}

export const config = {
  // Everything except static assets and image optimisation (they take no body).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|css|js|map)$).*)"],
};
