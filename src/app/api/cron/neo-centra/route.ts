// Server-side Neo Centra incentive sync. Point a scheduler at this every 5 min:
//   GET /api/cron/neo-centra   with Authorization: Bearer $CRON_SECRET
// Recomputes the current quarter's snapshot from live Turia (needs a fresh cookie,
// kept alive by the browser extension). Independent of whether anyone has the page open.
import { NextRequest, NextResponse } from "next/server";
import { resolveDirectors, saveSnapshot } from "@/lib/neo-centra/incentive";
import { currentQuarter } from "@/lib/neo-centra/period";
import { TuriaSessionError } from "@/lib/neo-centra/turia";
import { cronUnauthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const q = currentQuarter(Date.now());
  try {
    await resolveDirectors();
    const summary = await saveSnapshot(q.fromMs, q.toMs);
    return NextResponse.json({ ok: true, quarter: q.label, directors: summary.directors.length, generatedAt: summary.generatedAt });
  } catch (e) {
    if (e instanceof TuriaSessionError) return NextResponse.json({ ok: false, reason: "turia-cookie-expired", error: e.message }, { status: 200 });
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
