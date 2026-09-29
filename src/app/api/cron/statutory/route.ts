// Daily statutory-updates collection for the portals the server can reach, then Gemini
// summaries for anything new (including what the statutory-extension pushed in).
//   GET /api/cron/statutory[?from=YYYY-MM-DD&to=YYYY-MM-DD]   Authorization: Bearer $CRON_SECRET
// Default window is the last 7 IST days: re-collecting overlaps is free (posts upsert by
// key) and catches items a portal uploads late. Runs in the background and answers at
// once — collection takes minutes; results show on /tools/statutory-updates.
import { NextRequest, NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron-auth";
import { collectCloud } from "@/lib/statutory/cloud";
import { saveItems, saveStatus, summarisePending } from "@/lib/statutory/digest";
import { istDay } from "@/lib/statutory/portals";

export const dynamic = "force-dynamic";

let busy = false;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  const from = q.get("from") ?? istDay(-6);
  const to = q.get("to") ?? istDay(0);
  if (!DAY.test(from) || !DAY.test(to) || from > to) return NextResponse.json({ error: "from/to must be YYYY-MM-DD, from <= to" }, { status: 400 });
  if (busy) return NextResponse.json({ ok: true, started: false, reason: "already running" });

  busy = true;
  void (async () => {
    try {
      for (const r of await collectCloud(from, to)) {
        await saveItems(r.items);
        await saveStatus({ ...r, inRange: r.items.length }, "server");
      }
      console.log(`[statutory] collected ${from}..${to}; summarised ${await summarisePending(20 * 60_000)}`);
    } catch (e) {
      console.error("[statutory] run failed", e);
    } finally {
      busy = false;
    }
  })();
  return NextResponse.json({ ok: true, started: true, from, to });
}
