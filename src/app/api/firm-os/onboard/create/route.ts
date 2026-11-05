import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { onboardingService } from "@/lib/agents/onboarding/defaults";
import { errorResponse, guard, parseBody, runBodyZ } from "@/lib/agents/onboarding/http";

export const maxDuration = 300; // SharePoint site creation polls until the site is ready

// The partner/manager clicked "Create": confirm the plan and run the onboarding saga.
export async function POST(req: Request) {
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const body = await parseBody(req, runBodyZ);
  if (!body.ok) return body.res;
  try {
    return NextResponse.json({ run: await onboardingService({ actorIsPartner: g.isPartner }).create(body.data.runId, g.user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
