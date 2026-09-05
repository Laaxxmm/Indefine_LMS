// Hands-off recording ingestion.
//
// Hit this on a schedule (e.g. every 15 min) with the shared secret:
//   GET /api/cron/live/ingest?key=$CRON_SECRET
//   (or Authorization: Bearer $CRON_SECRET)
//
// Runs one runIngestSweep() pass (also triggered when an admin opens the Live
// sessions page, so ingestion still happens if this cron isn't configured).

import { NextRequest, NextResponse } from "next/server";
import { runIngestSweep } from "@/lib/live";
import { cronUnauthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  return NextResponse.json(await runIngestSweep());
}
