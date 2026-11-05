import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { auditClientWorkbookDownload } from "@/lib/audit/reads";
import { canViewClients } from "@/lib/clients/core";
import { rebuildClientWorkbook } from "@/lib/clients/workbook";

export const maxDuration = 60;

// "Rebuild database workbook" button. The all-clients workbook leaves the database as a file, so
// a successful rebuild is a read audit (action "export", every time; no client data in meta).
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });
  const r = await rebuildClientWorkbook();
  if (r.ok) await auditClientWorkbookDownload(session.user);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
