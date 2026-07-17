// KRA / appraisal scoring.
//
// A course is "completed" by a user when:
//   - every video in every module has VideoProgress.completed = true, AND
//   - every quiz attached to those videos has at least one QuizAttempt.passed = true.
// The completion timestamp is the latest of those events.
//
// For each Deadline on the course:
//   completedAt <= dueAt  → award pointsOnTime
//   completedAt >  dueAt  → award pointsLate
//   not completed yet, dueAt passed → 0 (and surface as "missed")
//   not completed yet, dueAt future → 0 for now (still pending)

import { prisma } from "@/lib/prisma";

export interface CourseStatus {
  courseId: string;
  courseTitle: string;
  totalVideos: number;
  videosCompleted: number;
  totalQuizzes: number;
  quizzesPassed: number;
  completed: boolean;
  completedAt: Date | null;
  deadlines: DeadlineStatus[];
}

export interface DeadlineStatus {
  id: string;
  kind: "MONTHLY" | "QUARTERLY" | "YEARLY" | "CUSTOM";
  dueAt: Date;
  pointsOnTime: number;
  pointsLate: number;
  pointsAwarded: number;
  state: "on-time" | "late" | "missed" | "pending";
}

export async function getCourseStatusForUser(
  userId: string,
  opts: { courseId?: string; from?: Date; to?: Date } = {}
): Promise<CourseStatus[]> {
  const courses = await prisma.course.findMany({
    where: opts.courseId ? { id: opts.courseId } : { published: true },
    include: {
      deadlines: {
        where:
          opts.from || opts.to
            ? { dueAt: { gte: opts.from, lte: opts.to } }
            : undefined,
      },
      modules: {
        include: {
          videos: {
            include: {
              progresses: { where: { userId } },
              quiz: {
                include: {
                  attempts: { where: { userId, passed: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { order: "asc" },
  });

  return courses.map((course) => {
    const videos = course.modules.flatMap((m) => m.videos);
    const totalVideos = videos.length;
    const totalQuizzes = videos.filter((v) => v.quiz).length;

    const videosCompleted = videos.filter((v) => v.progresses[0]?.completed).length;
    const quizzesPassed = videos.filter((v) => v.quiz && v.quiz.attempts.length > 0).length;

    const allDone =
      totalVideos > 0 &&
      videosCompleted === totalVideos &&
      quizzesPassed === totalQuizzes;

    let completedAt: Date | null = null;
    if (allDone) {
      const stamps: Date[] = [];
      for (const v of videos) {
        if (v.progresses[0]?.completedAt) stamps.push(v.progresses[0].completedAt);
        if (v.quiz) {
          const earliestPass = v.quiz.attempts
            .map((a) => a.submittedAt)
            .filter((d): d is Date => d != null)
            .sort((a, b) => a.getTime() - b.getTime())[0];
          if (earliestPass) stamps.push(earliestPass);
        }
      }
      if (stamps.length) {
        completedAt = stamps.reduce((a, b) => (a > b ? a : b));
      }
    }

    const now = new Date();
    const deadlines: DeadlineStatus[] = course.deadlines
      .slice()
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
      .map((d) => {
        let state: DeadlineStatus["state"];
        let pointsAwarded = 0;
        if (completedAt) {
          if (completedAt <= d.dueAt) {
            state = "on-time";
            pointsAwarded = d.pointsOnTime;
          } else {
            state = "late";
            pointsAwarded = d.pointsLate;
          }
        } else if (d.dueAt < now) {
          state = "missed";
        } else {
          state = "pending";
        }
        return {
          id: d.id,
          kind: d.kind,
          dueAt: d.dueAt,
          pointsOnTime: d.pointsOnTime,
          pointsLate: d.pointsLate,
          pointsAwarded,
          state,
        };
      });

    return {
      courseId: course.id,
      courseTitle: course.title,
      totalVideos,
      videosCompleted,
      totalQuizzes,
      quizzesPassed,
      completed: allDone,
      completedAt,
      deadlines,
    };
  });
}

export interface KraSummary {
  userId: string;
  name: string;
  email: string;
  videosCompleted: number;
  videosTotal: number;
  bestQuizPoints: number; // sum of best-attempt percent / 10 across quizzes
  deadlinePoints: number; // sum of pointsAwarded across all course deadlines
  assignmentPoints: number; // sum of points from completed assignments in window
  attendancePoints: number; // sum of monthly attendance points in window
  liveAttendancePoints: number; // sum of live-session attendance points in window
  totalScore: number;
}

export async function computeKraScores(
  opts: { from?: Date; to?: Date; includeInactive?: boolean } = {}
): Promise<KraSummary[]> {
  const users = await prisma.user.findMany({
    // Only current live users (active = licensed M365 members). Departed /
    // unlicensed / disabled accounts are excluded unless explicitly requested.
    where: opts.includeInactive ? undefined : { active: true },
    include: {
      attempts: {
        where: {
          submittedAt:
            opts.from || opts.to
              ? { gte: opts.from, lte: opts.to }
              : undefined,
        },
      },
    },
  });
  const totalVideos = await prisma.video.count();

  // Attendance points for the window, fetched once and grouped by user.
  const attendanceRows = await prisma.attendanceRecord.findMany({
    where: {
      periodMonth:
        opts.from || opts.to ? { gte: opts.from, lte: opts.to } : undefined,
    },
    select: { userId: true, points: true },
  });
  const attendanceByUser = new Map<string, number>();
  for (const r of attendanceRows) {
    attendanceByUser.set(r.userId, (attendanceByUser.get(r.userId) ?? 0) + r.points);
  }

  // Live-session attendance points for the window (by the session's start).
  const liveRows = await prisma.liveAttendance.findMany({
    where: {
      liveSession:
        opts.from || opts.to
          ? { startAt: { gte: opts.from, lte: opts.to } }
          : undefined,
    },
    select: { userId: true, points: true },
  });
  const liveByUser = new Map<string, number>();
  for (const r of liveRows) {
    liveByUser.set(r.userId, (liveByUser.get(r.userId) ?? 0) + r.points);
  }

  const out: KraSummary[] = [];
  for (const u of users) {
    const courseStatuses = await getCourseStatusForUser(u.id, {
      from: opts.from,
      to: opts.to,
    });

    let videosCompleted = 0;
    for (const c of courseStatuses) videosCompleted += c.videosCompleted;

    const bestByQuiz = new Map<string, number>();
    for (const a of u.attempts) {
      if (!a.passed && !bestByQuiz.has(a.quizId)) bestByQuiz.set(a.quizId, a.percent);
      const cur = bestByQuiz.get(a.quizId) ?? 0;
      if (a.percent > cur) bestByQuiz.set(a.quizId, a.percent);
    }
    const bestQuizPoints = Array.from(bestByQuiz.values()).reduce(
      (s, p) => s + p / 10,
      0
    );

    const deadlinePoints = courseStatuses.reduce(
      (s, c) => s + c.deadlines.reduce((ds, d) => ds + d.pointsAwarded, 0),
      0
    );

    const completedAssignments = await prisma.assignment.findMany({
      where: {
        userId: u.id,
        status: "COMPLETED",
        completedAt:
          opts.from || opts.to ? { gte: opts.from, lte: opts.to } : undefined,
      },
      select: { points: true },
    });
    const assignmentPoints = completedAssignments.reduce(
      (s, a) => s + a.points,
      0
    );

    const attendancePoints = attendanceByUser.get(u.id) ?? 0;
    const liveAttendancePoints = liveByUser.get(u.id) ?? 0;

    const videoPoints = videosCompleted * 10;
    const totalScore = Math.round(
      videoPoints +
        bestQuizPoints +
        deadlinePoints +
        assignmentPoints +
        attendancePoints +
        liveAttendancePoints
    );

    out.push({
      userId: u.id,
      name: u.name ?? u.email,
      email: u.email,
      videosCompleted,
      videosTotal: totalVideos,
      bestQuizPoints: Math.round(bestQuizPoints),
      deadlinePoints,
      assignmentPoints,
      attendancePoints,
      liveAttendancePoints,
      totalScore,
    });
  }
  return out.sort((a, b) => b.totalScore - a.totalScore);
}
