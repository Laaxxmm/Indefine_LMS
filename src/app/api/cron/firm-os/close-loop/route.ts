// Close-loop reconciler cron (ADR-005). Same secret handshake as the other /api/cron/* routes.
// .github/workflows/firm-os-close-loop.yml calls it every 30 minutes; outside IST working hours
// (Mon–Sat 09:00–19:00) reconcile() is a no-op and this returns 200 with `skipped`.
// A run that changed anything (jobs moved or closed, nudges, alerts) is summarised in one
// AuditEvent; the gate's own close / close-refused events carry the per-job detail.
import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit/log";
import { cronUnauthorized } from "@/lib/cron-auth";
import { closeLoopDeps } from "@/lib/close-loop/defaults";
import { reconcile } from "@/lib/close-loop/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const deps = closeLoopDeps();
  const s = await reconcile(deps);
  const changed = s.movedToClosing.length + s.closed.length + s.reminders + s.escalations + s.alerts.length;
  if (changed > 0) {
    await logAudit(deps.db, {
      actorId: "system:close-loop-reconciler",
      action: "reconcile",
      entity: "JobTask",
      entityId: null,
      meta: { at: s.at, movedToClosing: s.movedToClosing, closed: s.closed, reminders: s.reminders, escalations: s.escalations, alerts: s.alerts, backstopViolations: s.backstopViolations },
    });
  }
  return NextResponse.json(s);
}
