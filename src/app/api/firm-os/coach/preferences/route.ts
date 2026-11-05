import { updatePreferences } from "@/lib/agents/coach/activity";
import { coachDb } from "@/lib/agents/coach/defaults";
import { parseBody, preferencesZ, requireOwnCoachUser, toJson } from "@/lib/agents/coach/http";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";

// The signed-in person's own coach preferences: break reminders on/off, snooze 30 / 60 minutes
// (0 ends a snooze), morning board on/off. Takes effect at once. The row written is always the
// person's own (canManageOwnCoachPrefs, src/lib/rbac/policy.ts).
export async function POST(req: Request) {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await requireOwnCoachUser();
  if (g.res) return g.res;
  const body = await parseBody(preferencesZ, req);
  if (body.res) return body.res;
  return toJson(await updatePreferences(g.ownerId, body.data, { db: coachDb() }));
}
