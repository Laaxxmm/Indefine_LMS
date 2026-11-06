// Turia -> Firm OS read-only task pull (ADR-003 amendment). Same secret handshake as the other
// /api/cron/* routes. .github/workflows/firm-os-turia-pull.yml calls it every 15 minutes, Mon-Sat
// 09:00-20:00 IST; outside that window, or while FIRM_OS_ENABLED or FIRM_OS_TURIA_PULL is off, it
// answers 200 with `skipped` so the scheduler stays green. A missing or expired Turia sign-in also
// answers 200: the run records it (TuriaPullRun + AuditEvent) and the admin page says what to do.
import { NextRequest, NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron-auth";
import { firmOsEnabled, firmOsOffCronResponse } from "@/lib/workspace/flag";
import { inPullWindow, turiaPullMode } from "@/lib/integrations/turia/pull/config";
import { turiaPullDeps } from "@/lib/integrations/turia/pull/defaults";
import { OUTSIDE_HOURS_MESSAGE, PULL_OFF_MESSAGE } from "@/lib/integrations/turia/pull/messages";
import { runTuriaPull } from "@/lib/integrations/turia/pull/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  if (!firmOsEnabled()) return firmOsOffCronResponse();
  const { mode, valid } = turiaPullMode();
  if (valid && mode === "off") return NextResponse.json({ ok: true, skipped: PULL_OFF_MESSAGE });
  if (!inPullWindow(new Date())) return NextResponse.json({ ok: true, skipped: OUTSIDE_HOURS_MESSAGE });
  const r = await runTuriaPull(turiaPullDeps(), { trigger: "cron", actorId: null });
  return NextResponse.json({ ok: r.status !== "failed", status: r.status, mode: r.mode, runId: r.runId, notice: r.message, complete: r.complete, counts: r.counts });
}
