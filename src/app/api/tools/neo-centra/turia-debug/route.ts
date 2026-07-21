import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { rawTaskGet, fetchTuriaTaskList, rawTaskTimesheets } from "@/lib/neo-centra/turia";

// Diagnostics: dump Turia's raw task/get + the matching task/list ROW for one task, so we
// can see the exact field names/values (esp. billing status) when a bucket looks wrong.
// Directors only. e.g. /api/tools/neo-centra/turia-debug?taskId=<uuid or TSK…>
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user || !canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  const taskId = new URL(req.url).searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  const wantId = taskId.replace("#", "").toUpperCase();
  try {
    const task = (await rawTaskGet(taskId)) as Record<string, unknown> | null;
    // Surface just the numeric/money-ish keys first so it's easy to scan.
    const moneyKeys = task ? Object.keys(task).filter((k) => /amount|profit|cost|expense|revenue|budget|op|margin|billing|bill/i.test(k)) : [];
    const money = Object.fromEntries(moneyKeys.map((k) => [k, task?.[k]]));
    // The list row is what the second-pass (billable, un-invoiced) filter reads — find it
    // and surface any key whose name or value mentions billing, so we can pin the field.
    const list = await fetchTuriaTaskList(1, 2000).catch(() => []);
    const listRow = list.find((r) => String(r.id) === taskId || String(r.uniqueidentity ?? "").replace("#", "").toUpperCase() === wantId) ?? null;
    const listBilling = listRow ? Object.fromEntries(Object.entries(listRow).filter(([k, v]) => /bill/i.test(k) || /billable/i.test(String(v)))) : null;
    // First timesheet row raw — so we can see which field carries the work date.
    const tsRows = await rawTaskTimesheets(taskId).catch(() => []);
    const sampleTimesheet = tsRows[0] ?? null;
    return NextResponse.json({ taskId, moneyFields: money, listBillingFields: listBilling, listRow, timesheetCount: tsRows.length, sampleTimesheet, allKeys: task ? Object.keys(task) : [], raw: task });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
