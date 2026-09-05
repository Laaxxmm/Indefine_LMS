// Admin-triggered ingest sweep. Called from the Live sessions page on load so
// recordings pull + quizzes generate without relying on the external cron.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runIngestSweep } from "@/lib/live/sweep";
import { isAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runIngestSweep());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 200 });
  }
}
