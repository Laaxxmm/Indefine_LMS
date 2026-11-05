import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { onboardingService } from "@/lib/agents/onboarding/defaults";
import { errorResponse, guard, parseBody, runBodyZ } from "@/lib/agents/onboarding/http";

// Auto-create (FIRM_OS_ONBOARD_CONFIRM=false) runs the saga here, including SharePoint polling.
export const maxDuration = 300;

// Build the plan preview: exactly what will be created.
export async function POST(req: Request) {
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const body = await parseBody(req, runBodyZ);
  if (!body.ok) return body.res;
  try {
    return NextResponse.json({ run: await onboardingService({ actorIsPartner: g.isPartner }).plan(body.data.runId, g.user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
