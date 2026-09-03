// Nightly: create any SharePoint folders that failed at save time, then rebuild the
// Excel workbook. Same secret handshake as /api/cron/live/ingest.
import { NextRequest, NextResponse } from "next/server";
import { retryPendingFolders } from "@/lib/clients/storage";
import { rebuildClientWorkbook } from "@/lib/clients/workbook";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.nextUrl.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const folders = await retryPendingFolders();
  const workbook = await rebuildClientWorkbook();
  return NextResponse.json({ folders, workbook });
}
