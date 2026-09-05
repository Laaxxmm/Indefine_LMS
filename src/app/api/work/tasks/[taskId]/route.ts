import { currentActor } from "@/lib/work/actor";
import { taskActionZ } from "@/lib/work/core";
import { taskAction } from "@/lib/work/db";
import { fromResult, notFoundJson, parseBody } from "@/lib/work/http";

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(taskActionZ, req);
  if (body.res) return body.res;
  const { taskId } = await params;
  return fromResult(await taskAction(taskId, body.data.action, actor));
}
