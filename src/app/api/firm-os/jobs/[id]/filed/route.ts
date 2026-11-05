import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { markFiled } from "@/lib/close-loop/actions";
import { closeLoopDeps } from "@/lib/close-loop/defaults";
import { errorResponse, filedBodyZ, guard, jobIdZ, parse, readJson } from "@/lib/close-loop/http";

// "Mark filed": the person who filed on the portal confirms it, with the ARN / SRN / ack no. where
// the service has one (stored, never checked against a portal). The hook then issues the Turia close
// step and moves the job to CLOSING.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = guard(await auth());
  if (!g.ok) return g.res;
  const id = parse(jobIdZ, (await params).id);
  if (!id.ok) return id.res;
  const body = parse(filedBodyZ, await readJson(req));
  if (!body.ok) return body.res;
  try {
    return NextResponse.json(await markFiled(id.data, body.data, g.user, closeLoopDeps()));
  } catch (e) {
    return errorResponse(e);
  }
}
