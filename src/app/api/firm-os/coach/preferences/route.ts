import { updatePreferences } from "@/lib/agents/coach/activity";
import { coachDb } from "@/lib/agents/coach/defaults";
import { parseBody, preferencesZ, requireCoachUser, toJson } from "@/lib/agents/coach/http";

// The signed-in person's own coach preferences: break reminders on/off, snooze 30 / 60 minutes
// (0 ends a snooze), morning board on/off. Takes effect at once.
export async function POST(req: Request) {
  const g = await requireCoachUser();
  if (g.res) return g.res;
  const body = await parseBody(preferencesZ, req);
  if (body.res) return body.res;
  return toJson(await updatePreferences(g.user.id, body.data, { db: coachDb() }));
}
