import { currentActor } from "@/lib/work/actor";
import { createTaskZ } from "@/lib/work/core";
import { createTask } from "@/lib/work/db";
import { fromResult, notFoundJson, parseBody } from "@/lib/work/http";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(createTaskZ, req);
  if (body.res) return body.res;
  const { id } = await params;
  return fromResult(await createTask(id, body.data, actor), 201);
}
