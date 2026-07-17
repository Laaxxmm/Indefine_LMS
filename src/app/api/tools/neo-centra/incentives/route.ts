import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { canUseNeoCentra, isNeoCentraAdmin } from "@/lib/neo-centra/access";
import { getSnapshotForPeriod, saveSnapshot, resolveDirectors, filterSummaryForViewer, type IncentiveSummary } from "@/lib/neo-centra/incentive";
import { TuriaSessionError } from "@/lib/neo-centra/turia";

export const maxDuration = 120;

function periodFrom(url: string): { from: number; to: number } | null {
  const p = new URL(url).searchParams;
  const from = Number(p.get("from")), to = Number(p.get("to"));
  return Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > from ? { from, to } : null;
}

// GET: latest cached snapshot for the period, filtered for the viewing director.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  const period = periodFrom(req.url);
  if (!period) return NextResponse.json({ error: "from/to required" }, { status: 400 });

  const snapshot = await getSnapshotForPeriod(period.from, period.to);
  if (!snapshot) return NextResponse.json({ snapshot: null });
  return NextResponse.json({ snapshot: filterForSession(snapshot, session.user) });
}

// POST: resolve directors + recompute against live Turia + cache a snapshot.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  const period = periodFrom(req.url);
  if (!period) return NextResponse.json({ error: "from/to required" }, { status: 400 });

  try {
    await resolveDirectors();
    const summary = await saveSnapshot(period.from, period.to);
    return NextResponse.json({ snapshot: filterForSession(summary, session.user) });
  } catch (e) {
    if (e instanceof TuriaSessionError) return NextResponse.json({ error: e.message, turiaExpired: true }, { status: 424 });
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

function filterForSession(summary: IncentiveSummary, user: Session["user"]) {
  return filterSummaryForViewer(summary, user.id, isNeoCentraAdmin(user), user.name ?? "");
}
