// Nightly: re-read registry (RDAP) and certificate (TLS) expiry for every tracked service.
// Same secret handshake as the other /api/cron/* routes.
import { NextRequest, NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runChecks } from "@/lib/client-ops/refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const summary = await runChecks();
  return NextResponse.json(summary);
}
