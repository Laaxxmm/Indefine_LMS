import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canViewClients } from "@/lib/clients/core";
import { rebuildClientWorkbook } from "@/lib/clients/workbook";

export const maxDuration = 60;

// "Rebuild database workbook" button.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });
  const r = await rebuildClientWorkbook();
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
