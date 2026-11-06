import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { onboardingService } from "@/lib/agents/onboarding/defaults";
import { answerBodyZ, errorResponse, guard, parseBody } from "@/lib/agents/onboarding/http";
import { recordAudit } from "@/lib/audit/record";
import { enforceRateLimit } from "@/lib/hardening/rate-limit";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

export const maxDuration = 60;

// Merge the short form's answers (and/or a follow-up sentence) and re-validate.
export async function POST(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const body = await parseBody(req, answerBodyZ);
  if (!body.ok) return body.res;
  const limited = await enforceRateLimit("onboard", g.user.id);
  if (limited) return limited;
  try {
    const { runId, answers, message } = body.data;
    const run = await onboardingService({ actorIsPartner: g.isPartner, viewer: g.user }).answer(runId, { answers, message });
    // Which fields were answered, never the values (they can be client personal data, ADR-006).
    await recordAudit({ actorId: g.user.id, action: "onboarding.answer", entity: "OnboardingRun", entityId: runId, meta: { fields: Object.keys(answers ?? {}), message: !!message } });
    return NextResponse.json({ run });
  } catch (e) {
    return errorResponse(e);
  }
}
