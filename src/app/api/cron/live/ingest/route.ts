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

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.nextUrl.searchParams.get("key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runIngestSweep());
}
