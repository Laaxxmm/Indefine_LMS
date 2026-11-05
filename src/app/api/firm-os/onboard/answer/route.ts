import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { onboardingService } from "@/lib/agents/onboarding/defaults";
import { answerBodyZ, errorResponse, guard, parseBody } from "@/lib/agents/onboarding/http";

export const maxDuration = 60;

// Merge the short form's answers (and/or a follow-up sentence) and re-validate.
export async function POST(req: Request) {
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const body = await parseBody(req, answerBodyZ);
  if (!body.ok) return body.res;
  try {
    const { runId, answers, message } = body.data;
    return NextResponse.json({ run: await onboardingService({ actorIsPartner: g.isPartner }).answer(runId, { answers, message }) });
  } catch (e) {
    return errorResponse(e);
  }
}
