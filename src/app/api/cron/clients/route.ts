// Nightly: create any SharePoint folders that failed at save time, then rebuild the
// Excel workbook. Same secret handshake as /api/cron/live/ingest.
import { NextRequest, NextResponse } from "next/server";
import { retryPendingFolders } from "@/lib/clients/storage";
import { rebuildClientWorkbook } from "@/lib/clients/workbook";
import { cronUnauthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const folders = await retryPendingFolders();
  const workbook = await rebuildClientWorkbook();
  return NextResponse.json({ folders, workbook });
}
