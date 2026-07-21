import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { analyzeLeadsForPeriod } from "@/lib/neo-centra/incentive";
import { rawLeads } from "@/lib/neo-centra/turia";
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
    const analysis = await analyzeLeadsForPeriod(fromMs, toMs);
    // Raw date-ish fields of a converted lead created in a prior quarter (like Moneytree)
    // pinpoints which key/format carries the conversion date if the gate is still dropping it.
    const raw = await rawLeads().catch(() => [] as Array<Record<string, unknown>>);
    const sample = raw.find((l) => /convert/i.test(String(l.stagename ?? ""))) ?? raw[0] ?? null;
    const sampleDateFields = sample ? Object.fromEntries(Object.entries(sample).filter(([k]) => /date|on$|created|updated|modified|convert|won|stage/i.test(k))) : null;
    return NextResponse.json({ ...analysis, sampleConvertedLeadKeys: sample ? Object.keys(sample) : [], sampleDateFields });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
