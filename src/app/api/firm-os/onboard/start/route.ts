import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { onboardingService } from "@/lib/agents/onboarding/defaults";
import { errorResponse, guard, parseBody, startBodyZ } from "@/lib/agents/onboarding/http";

export const maxDuration = 60;

// One plain-English sentence → DRAFT run with the extracted spec and the clarifier's questions.
export async function POST(req: Request) {
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const body = await parseBody(req, startBodyZ);
  if (!body.ok) return body.res;
  try {
    return NextResponse.json({ run: await onboardingService({ actorIsPartner: g.isPartner }).start(body.data.prompt, g.user.id) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
