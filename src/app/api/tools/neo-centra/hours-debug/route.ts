import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { analyzeDirectorHours } from "@/lib/neo-centra/incentive";
import { failureSentence } from "@/lib/errors";

export const maxDuration = 300;

// Diagnostics: per-task hour attribution for a director, so the gap vs Turia's total-hours
// view can be pinned to the tasks the buckets drop. Directors only.
// e.g. /api/tools/neo-centra/hours-debug?director=Rajkumar
export async function GET(req: Request) {
  // Diagnostics stay off in production unless NEO_CENTRA_DEBUG=1 is set on the host.
  if (process.env.NEO_CENTRA_DEBUG !== "1") return NextResponse.json({ error: "This page is not available." }, { status: 404 });
  const session = await auth();
  if (!session?.user || !canUseNeoCentra(session.user)) return NextResponse.json({ error: "You don't have access to Neo Centra. Ask an admin to give you access." }, { status: 403 });
  const director = new URL(req.url).searchParams.get("director");
  if (!director) return NextResponse.json({ error: "Choose a director first." }, { status: 400 });
  try {
    return NextResponse.json(await analyzeDirectorHours(director));
  } catch (e) {
    return NextResponse.json({ error: failureSentence(e, "Turia could not be read.", "Try again in a minute.") }, { status: 502 });
  }
}
