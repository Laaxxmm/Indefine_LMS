import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { onboardingService } from "@/lib/agents/onboarding/defaults";
import { errorResponse, guard, parseBody, runBodyZ } from "@/lib/agents/onboarding/http";
import { enforceRateLimit } from "@/lib/hardening/rate-limit";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

export const maxDuration = 300; // SharePoint site creation polls until the site is ready

// The partner/manager clicked "Create": confirm the plan and run the onboarding saga.
export async function POST(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const body = await parseBody(req, runBodyZ);
  if (!body.ok) return body.res;
  const limited = await enforceRateLimit("onboard", g.user.id);
  if (limited) return limited;
  try {
    return NextResponse.json({ run: await onboardingService({ actorIsPartner: g.isPartner, viewer: g.user }).create(body.data.runId, g.user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
