import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { computeKraScores, getCourseStatusForUser } from "@/lib/kra";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/access";

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from") ?? "";
  const toStr = url.searchParams.get("to") ?? "";
  const fromD = fromStr ? new Date(fromStr) : undefined;
  const toD = toStr ? new Date(toStr) : undefined;
  const toEnd = toD ? new Date(toD.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined;

  const summary = await computeKraScores({ from: fromD, to: toEnd });

  // Per-employee deadline rows for the detail sheet
  const detailRows: (string | number)[][] = [];
  for (const r of summary) {
    const courses = await getCourseStatusForUser(r.userId, { from: fromD, to: toEnd });
    for (const c of courses) {
      for (const d of c.deadlines) {
        detailRows.push([
          r.name,
          r.email,
          c.courseTitle,
          d.kind,
          d.dueAt.toISOString().slice(0, 10),
          d.state,
          d.pointsAwarded,
        ]);
      }
    }
  }

  // Best quiz attempts in window per user
  const quizDetail: (string | number)[][] = [];
  const attempts = await prisma.quizAttempt.findMany({
    where: {
      submittedAt: fromD || toEnd ? { gte: fromD, lte: toEnd } : { not: null },
    },
    include: { user: true, quiz: { include: { video: true } } },
  });
  const bestKey = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) {
    const k = `${a.userId}:${a.quizId}`;
    const cur = bestKey.get(k);
    if (!cur || a.percent > cur.percent) bestKey.set(k, a);
  }
  for (const a of bestKey.values()) {
    quizDetail.push([
      a.user.name ?? a.user.email,
      a.user.email,
      a.quiz.video.title,
      a.percent.toFixed(2),
      a.passed ? "passed" : "not_passed",
      a.submittedAt?.toISOString().slice(0, 10) ?? "",
    ]);
  }

  const lines: string[] = [];
  lines.push(`KRA Report,${fromStr || "all"} to ${toStr || "all"}`);
  lines.push("");
  lines.push("=== Summary ===");
  lines.push(
    toCsv([
      ["Name", "Email", "Videos completed", "Videos total", "Video pts", "Quiz pts", "Deadline pts", "Assignment pts", "Attendance pts", "Live attendance pts", "Total"],
      ...summary.map((r) => [
        r.name,
        r.email,
        r.videosCompleted,
        r.videosTotal,
        r.videosCompleted * 10,
        r.bestQuizPoints,
        r.deadlinePoints,
        r.assignmentPoints,
        r.attendancePoints,
        r.liveAttendancePoints,
        r.totalScore,
      ]),
    ])
  );
  lines.push("");
  lines.push("=== Deadlines ===");
  lines.push(
    toCsv([
      ["Name", "Email", "Course", "Kind", "Due", "State", "Points awarded"],
      ...detailRows,
    ])
  );
  lines.push("");
  lines.push("=== Best quiz scores in window ===");
  lines.push(
    toCsv([
      ["Name", "Email", "Video", "Best %", "Result", "Submitted"],
      ...quizDetail,
    ])
  );

  const csv = lines.join("\r\n");
  const filename = `kra-${fromStr || "all"}_to_${toStr || "all"}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
