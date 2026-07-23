import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { analyzeDirectorHours } from "@/lib/neo-centra/incentive";

export const maxDuration = 300;

// Diagnostics: per-task hour attribution for a director, so the gap vs Turia's total-hours
// view can be pinned to the tasks the buckets drop. Directors only.
// e.g. /api/tools/neo-centra/hours-debug?director=Rajkumar
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || !canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  const director = new URL(req.url).searchParams.get("director");
  if (!director) return NextResponse.json({ error: "director required" }, { status: 400 });
  try {
    return NextResponse.json(await analyzeDirectorHours(director));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
