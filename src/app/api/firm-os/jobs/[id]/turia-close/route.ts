import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { confirmTuriaClose } from "@/lib/close-loop/actions";
import { closeLoopDeps } from "@/lib/close-loop/defaults";
import { errorResponse, guard, jobIdZ, parse, readJson, turiaCloseBodyZ } from "@/lib/close-loop/http";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// "Done in Turia" for the close step: the Turia task ref and the minutes logged are recorded
// (TuriaSync CLOSED through the manual bridge), then the close gate is tried. The response says
// whether the job is DONE or what is still missing.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const id = parse(jobIdZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(turiaCloseBodyZ, await readJson(req));
  if (!body.ok) return body.res;
  try {
    return NextResponse.json(await confirmTuriaClose(id.data, body.data, g.user, closeLoopDeps()));
  } catch (e) {
    return errorResponse(e);
  }
}
