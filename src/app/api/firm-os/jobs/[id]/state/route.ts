import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setJobState } from "@/lib/close-loop/actions";
import { closeLoopDeps } from "@/lib/close-loop/defaults";
import { errorResponse, guard, jobIdZ, parse, readJson, stateBodyZ } from "@/lib/close-loop/http";

// Generic JobTask edge through the state machine (hooks run after APPROVED). A target of DONE is
// refused with 403: DONE is set only by the close gate (ADR-005). FILED_BY_HUMAN goes through /filed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const id = parse(jobIdZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(stateBodyZ, await readJson(req));
  if (!body.ok) return body.res;
  try {
    return NextResponse.json(await setJobState(id.data, body.data, g.user, closeLoopDeps()));
  } catch (e) {
    return errorResponse(e);
  }
}
