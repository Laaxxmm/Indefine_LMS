import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { auth } from "@/lib/auth";
import { departmentLabel } from "@/lib/ca-firm";
import { canViewClients, ENTITY_TYPES, GROWTH_GOALS, JOB_STATUSES, TURNOVER_BANDS } from "@/lib/clients/core";
import { loadJobRows, parseFilters } from "@/lib/clients/reports";
import { istDate } from "@/lib/clients/workbook";
import { addSheet, workbookBytes } from "@/lib/office-tools/xlsx";

export const runtime = "nodejs";

// Download the currently filtered job list as Excel.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewClients(session.user)) return NextResponse.json({ error: "No access" }, { status: 403 });

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await loadJobRows(parseFilters(sp));
  const columns = ["Client", "FY", "Month", "Department", "Service", "Handler", "Status", "Due on", "Fees (₹)", "Turnover (₹)", "Turnover band", "Growth goal", "Entity type", "City", "Created on"];
  const wb = new ExcelJS.Workbook();
  addSheet(wb, "Jobs", columns, rows.map((r) => ({
    Client: r.client, FY: r.fy, Month: r.month, Department: departmentLabel(r.department), Service: r.service, Handler: r.handler,
    Status: JOB_STATUSES[r.status], "Due on": r.dueOn ? istDate(r.dueOn) : "", "Fees (₹)": r.fees ?? "", "Turnover (₹)": r.turnover,
    "Turnover band": TURNOVER_BANDS[r.turnoverBand], "Growth goal": GROWTH_GOALS[r.growthGoal], "Entity type": ENTITY_TYPES[r.entityType],
    City: r.city ?? "", "Created on": istDate(r.createdAt),
  })));
  return new NextResponse(new Uint8Array(await workbookBytes(wb)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="client-jobs-${istDate(new Date())}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
