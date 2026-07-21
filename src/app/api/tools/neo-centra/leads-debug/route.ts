import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { analyzeLeadsForPeriod } from "@/lib/neo-centra/incentive";
import { currentQuarter } from "@/lib/neo-centra/period";

// Diagnostics: per-lead Bucket 1 decision for a quarter, so we can see exactly which lead
// counts as "won" and why. Directors only. Defaults to the current quarter; override with
// ?from=<ms>&to=<ms>. e.g. /api/tools/neo-centra/leads-debug
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || !canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  const url = new URL(req.url);
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));
  const q = currentQuarter(Date.now());
  const fromMs = from > 0 ? from : q.fromMs;
  const toMs = to > from ? to : q.toMs;
  try {
    return NextResponse.json(await analyzeLeadsForPeriod(fromMs, toMs));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
