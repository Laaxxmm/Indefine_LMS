import { currentActor } from "@/lib/work/actor";
import { workActionZ } from "@/lib/work/core";
import { changeWorkStatus } from "@/lib/work/db";
import { fromResult, notFoundJson, parseBody } from "@/lib/work/http";

// Start / Resume / Pause / Finish / Obsolete / Reopen. Owner or lead.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(workActionZ, req);
  if (body.res) return body.res;
  const { id } = await params;
  return fromResult(await changeWorkStatus(id, body.data.action, actor, body.data.reason));
}
