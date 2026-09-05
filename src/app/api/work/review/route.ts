import { currentActor } from "@/lib/work/actor";
import { completeReview } from "@/lib/work/db";
import { fromResult, notFoundJson } from "@/lib/work/http";

// "Review done" for the current week. Refused while stale works await a decision.
export async function POST() {
  const actor = await currentActor();
  if (!actor) return notFoundJson();
  return fromResult(await completeReview(actor));
}
