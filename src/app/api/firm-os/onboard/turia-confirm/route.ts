import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { onboardingService } from "@/lib/agents/onboarding/defaults";
import { errorResponse, guard, parseBody, turiaConfirmBodyZ } from "@/lib/agents/onboarding/http";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// "Done in Turia" for one ManualBridge checklist: records the Turia reference (and minutes).
export async function POST(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const body = await parseBody(req, turiaConfirmBodyZ);
  if (!body.ok) return body.res;
  try {
    const { runId, syncId, turiaRef, minutes } = body.data;
    return NextResponse.json({ run: await onboardingService({ actorIsPartner: g.isPartner, viewer: g.user }).turiaConfirm(runId, { syncId, turiaRef, minutes }, g.user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
