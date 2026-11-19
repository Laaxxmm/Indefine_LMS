import { NextResponse } from "next/server";
import { firmOsEnabled, firmOsOffResponse } from "@/lib/workspace/flag";
import { turiaPullDeps } from "@/lib/integrations/turia/pull/defaults";
import { turiaSyncManager } from "@/lib/integrations/turia/pull/http";
import { runTuriaPull } from "@/lib/integrations/turia/pull/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// "Sync now" on /admin/firm-os/turia-sync: one read-only Turia pull in the current mode (dry run
// or on). Admins and partners. The run writes its TuriaPullRun row and one AuditEvent (counts only).
export async function POST() {
  if (!firmOsEnabled()) return firmOsOffResponse();
  const g = await turiaSyncManager();
  if (g.res) return g.res;
  const r = await runTuriaPull(turiaPullDeps(), { trigger: "manual", actorId: g.user.id });
  // Sign-in missing, switched off, already running or stopped: the sentence says what to do.
  if (r.status !== "ok" && r.status !== "partial") return NextResponse.json({ error: r.message, status: r.status, runId: r.runId }, { status: 409 });
  return NextResponse.json({ status: r.status, mode: r.mode, runId: r.runId, notice: r.message, complete: r.complete, counts: r.counts });
}
