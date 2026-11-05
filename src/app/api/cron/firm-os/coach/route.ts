// Daily coach cron (Phase 9). Same bearer handshake as every /api/cron/* route.
// .github/workflows/firm-os-coach.yml calls ?job=morning at 09:00 IST and ?job=reminders every 30
// minutes 09:00–19:00 IST Mon–Sat, and ?job=summary on Fridays at 16:00 IST. Each job checks its
// own IST window and returns 200 with `skipped` outside it.
import { NextRequest, NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron-auth";
import { firmOsEnabled, firmOsOffCronResponse } from "@/lib/workspace/flag";
import { COACH_JOBS, isCoachJob, runCoachJob } from "@/lib/agents/coach/cron";
import { coachDeps } from "@/lib/agents/coach/defaults";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  if (!firmOsEnabled()) return firmOsOffCronResponse(); // master switch off: nothing to do, 200 so the scheduler stays green
  const job = req.nextUrl.searchParams.get("job");
  if (!isCoachJob(job)) return NextResponse.json({ error: `job must be ${COACH_JOBS.join(", ")}` }, { status: 400 });
  return NextResponse.json(await runCoachJob(job, coachDeps()));
}
