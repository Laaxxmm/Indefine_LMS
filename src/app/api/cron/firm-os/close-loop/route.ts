// Close-loop reconciler cron (ADR-005). Same secret handshake as the other /api/cron/* routes.
// .github/workflows/firm-os-close-loop.yml calls it every 30 minutes; outside IST working hours
// (Mon–Sat 09:00–19:00) reconcile() is a no-op and this returns 200 with `skipped`.
import { NextRequest, NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron-auth";
import { closeLoopDeps } from "@/lib/close-loop/defaults";
import { reconcile } from "@/lib/close-loop/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  return NextResponse.json(await reconcile(closeLoopDeps()));
}
