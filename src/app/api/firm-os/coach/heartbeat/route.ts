import { NextResponse } from "next/server";
import { recordHeartbeat } from "@/lib/agents/coach/activity";
import { coachDb } from "@/lib/agents/coach/defaults";
import { refuseNonEmptyBody, requireCoachUser } from "@/lib/agents/coach/http";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// LMS activity heartbeat for break nudges (ADR-006). The browser sends one at most once a minute
// while the tab is visible and the person has interacted recently. No payload: who and when only.
// Stores nothing while FIRM_OS_BREAK_NUDGE is off or the person turned break reminders off.
export async function POST(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireCoachUser();
  if (g.res) return g.res;
  const refused = await refuseNonEmptyBody(req); // capped as it streams in: 413 past 1 KB, 400 for anything but {} or nothing
  if (refused) return refused;
  return NextResponse.json(await recordHeartbeat(g.user.id, { db: coachDb() }));
}
