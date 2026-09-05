import { currentActor } from "@/lib/work/actor";
import { planZ } from "@/lib/work/core";
import { setWeekPlan } from "@/lib/work/db";
import { fromResult, notFoundJson, parseBody } from "@/lib/work/http";

// Replace my plan for the current IST week.
export async function PUT(req: Request) {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  const body = await parseBody(planZ, req);
  if (body.res) return body.res;
  return fromResult(await setWeekPlan(body.data.workIds, actor));
}
