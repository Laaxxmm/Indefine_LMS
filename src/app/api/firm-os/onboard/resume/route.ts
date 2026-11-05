import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { onboardingService } from "@/lib/agents/onboarding/defaults";
import { errorResponse, guard, parseBody, runBodyZ } from "@/lib/agents/onboarding/http";
import { recordAudit } from "@/lib/audit/record";
import { enforceRateLimit } from "@/lib/hardening/rate-limit";

export const maxDuration = 300; // SharePoint site creation polls until the site is ready

// Continue a failed or blocked onboarding from the first step that is not done.
export async function POST(req: Request) {
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const body = await parseBody(req, runBodyZ);
  if (!body.ok) return body.res;
  const limited = await enforceRateLimit("onboard", g.user.id);
  if (limited) return limited;
  try {
    const run = await onboardingService({ actorIsPartner: g.isPartner }).resume(body.data.runId, g.user.id);
    await recordAudit({ actorId: g.user.id, action: "onboarding.resume", entity: "OnboardingRun", entityId: body.data.runId, meta: { status: run.status } });
    return NextResponse.json({ run });
  } catch (e) {
    return errorResponse(e);
  }
}
