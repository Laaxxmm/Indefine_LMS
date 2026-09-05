// Work-tracker cron. Same secret handshake as /api/cron/clients.
//   ?job=morning  09:00 IST Mon–Fri  name whoever has open tasks and no pick today
//   ?job=friday   16:00 IST Fri      name whoever has not finished the week review
//   ?job=close    20:00 IST daily    carry unfinished picks, auto-pause quiet works
import { NextRequest, NextResponse } from "next/server";
import { isWeekend } from "@/lib/ist";
import { closeDay, usersMissingPick, usersMissingReview } from "@/lib/work/db";
import { postTechWorkMessage } from "@/lib/work/teams";
import { cronUnauthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const APP_URL = (process.env.AUTH_URL ?? "https://lms.indefine.in").replace(/\/$/, "");
const firstNames = (users: { name: string }[]) => users.map((u) => u.name.split(" ")[0]).join(" and ");

export async function GET(req: NextRequest) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const job = req.nextUrl.searchParams.get("job");
  const now = new Date();

  if (job === "close") return NextResponse.json(await closeDay(now));

  if (job === "morning") {
    if (isWeekend(now)) return NextResponse.json({ skipped: "weekend" });
    const missing = await usersMissingPick(now);
    if (missing.length === 0) return NextResponse.json({ sent: false, missing: [] });
    const r = await postTechWorkMessage(`Good morning. No pick for today yet: ${firstNames(missing)}. ${APP_URL}/work`);
    return NextResponse.json({ sent: r.ok, missing: missing.map((u) => u.email), error: r.error });
  }

  if (job === "friday") {
    const missing = await usersMissingReview(now);
    if (missing.length === 0) return NextResponse.json({ sent: false, missing: [] });
    const r = await postTechWorkMessage(`Week review still pending: ${firstNames(missing)}. ${APP_URL}/work/week`);
    return NextResponse.json({ sent: r.ok, missing: missing.map((u) => u.email), error: r.error });
  }

  return NextResponse.json({ error: "job must be morning, friday or close" }, { status: 400 });
}
