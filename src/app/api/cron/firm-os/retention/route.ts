// DPDP retention cron (ADR-006, Phase 11): clears AgentRun.inputs past 30 days (rows kept), deletes
// break-nudge heartbeats older than 7 days, mirrors model escalations into AuditEvent, and records
// one `retention` AuditEvent. Same secret handshake as the other /api/cron/* routes;
// .github/workflows/firm-os-retention.yml calls it daily at 02:30 IST.
import { NextRequest, NextResponse } from "next/server";
import { cronUnauthorized } from "@/lib/cron-auth";
import { runRetention } from "@/lib/hardening/retention";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const { prisma } = await import("@/lib/prisma");
  return NextResponse.json(await runRetention(prisma));
}
