import { NextResponse } from "next/server";
import { dismissEvent } from "@/lib/agents/coach/activity";
import { coachDb } from "@/lib/agents/coach/defaults";
import { eventIdZ, requireCoachUser, toJson } from "@/lib/agents/coach/http";

// Dismiss one of the signed-in person's own coach notices (board, reminder, escalation, break
// nudge). Anyone else's notice answers 404.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireCoachUser();
  if (g.res) return g.res;
  const id = eventIdZ.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: id.error.issues[0]?.message ?? "Invalid notice id" }, { status: 400 });
  return toJson(await dismissEvent(g.user.id, id.data, { db: coachDb() }));
}
