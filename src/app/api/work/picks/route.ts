import { currentActor } from "@/lib/work/actor";
import { picksZ } from "@/lib/work/core";
import { addPicks } from "@/lib/work/db";
import { fromResult, notFoundJson, parseBody } from "@/lib/work/http";

// Promise up to PICK_CAP tasks for today. Picks are never removed.
export async function POST(req: Request) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(picksZ, req);
  if (body.res) return body.res;
  return fromResult(await addPicks(body.data.taskIds, actor), 201);
}
