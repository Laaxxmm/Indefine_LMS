// Server-side Neo Centra incentive sync. Point a scheduler at this every 5 min:
//   GET /api/cron/neo-centra?key=$CRON_SECRET   (or Authorization: Bearer $CRON_SECRET)
// Recomputes the current quarter's snapshot from live Turia (needs a fresh cookie,
// kept alive by the browser extension). Independent of whether anyone has the page open.
import { NextRequest, NextResponse } from "next/server";
import { resolveDirectors, saveSnapshot } from "@/lib/neo-centra/incentive";
import { currentQuarter } from "@/lib/neo-centra/period";
import { TuriaSessionError } from "@/lib/neo-centra/turia";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.nextUrl.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
