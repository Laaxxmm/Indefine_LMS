import { NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/agents/coach/activity";
import { coachDb } from "@/lib/agents/coach/defaults";
import { emptyBody, requireCoachUser } from "@/lib/agents/coach/http";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// LMS activity heartbeat for break nudges (ADR-006). The browser sends one at most once a minute
// while the tab is visible and the person has interacted recently. No payload: who and when only.
// Stores nothing while FIRM_OS_BREAK_NUDGE is off or the person turned break reminders off.
export async function POST(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireCoachUser();
  if (g.res) return g.res;
  if (!(await emptyBody(req))) return NextResponse.json({ error: "The heartbeat takes no data" }, { status: 400 });
  return NextResponse.json(await recordHeartbeat(g.user.id, { db: coachDb() }));
}
