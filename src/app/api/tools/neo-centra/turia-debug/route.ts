import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { rawTaskGet } from "@/lib/neo-centra/turia";

// Diagnostics: dump Turia's raw task/get for one task so we can see the exact field
// names/values when a bucket looks wrong. Directors only. e.g.
//   /api/tools/neo-centra/turia-debug?taskId=TSK03683
export async function GET(req: Request) {
  // Diagnostics stay off in production unless NEO_CENTRA_DEBUG=1 is set on the host.
  if (process.env.NEO_CENTRA_DEBUG !== "1") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await auth();
  if (!session?.user || !canUseNeoCentra(session.user)) return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  const taskId = new URL(req.url).searchParams.get("taskId");
  if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
  try {
    const task = (await rawTaskGet(taskId)) as Record<string, unknown> | null;
    // Surface just the numeric/money-ish keys first so it's easy to scan.
    const moneyKeys = task ? Object.keys(task).filter((k) => /amount|profit|cost|expense|revenue|budget|op|margin|billing/i.test(k)) : [];
    const money = Object.fromEntries(moneyKeys.map((k) => [k, task?.[k]]));
    return NextResponse.json({ taskId, moneyFields: money, allKeys: task ? Object.keys(task) : [], raw: task });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
