// Daily coach cron (Phase 9). Same bearer handshake as every /api/cron/* route.
// .github/workflows/firm-os-coach.yml calls ?job=morning at 09:00 IST; each job checks its own IST
// window and returns 200 with `skipped` outside it.
import { NextRequest, NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron-auth";
import { COACH_JOBS, isCoachJob, runCoachJob } from "@/lib/agents/coach/cron";
import { coachDeps } from "@/lib/agents/coach/defaults";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const job = req.nextUrl.searchParams.get("job");
  if (!isCoachJob(job)) return NextResponse.json({ error: `job must be ${COACH_JOBS.join(", ")}` }, { status: 400 });
  return NextResponse.json(await runCoachJob(job, coachDeps()));
}
