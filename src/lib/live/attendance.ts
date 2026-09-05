// Live sessions: attendance capture and the credit attendees earn for it.
// Runs from ./sweep.ts once a session has ended.

import { prisma } from "@/lib/prisma";
import { getUserGraphToken, resolveOnlineMeetingId, listAttendanceRecords } from "@/lib/graph";

/**
 * Points for attending a live session, tiered on the % of the (scheduled)
 * session attended: >=75% full, >=40% half, else 0.
 */
const LIVE_FULL_POINTS = 10;
export function liveAttendancePoints(attendedPct: number): number {
  if (attendedPct >= 75) return LIVE_FULL_POINTS;
  if (attendedPct >= 40) return Math.round(LIVE_FULL_POINTS / 2);
  return 0;
}

/**
 * Pull the Teams attendance report for a finished session and record per-attendee
 * points. Idempotent: skips once attendance rows exist; returns quietly while the
 * report isn't ready yet (Teams generates it minutes after the meeting), so the
 * sweep can retry. Only invited/known users (matched by email) are scored.
 */
export async function captureAttendance(sessionId: string): Promise<void> {
  const s = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    include: { _count: { select: { attendances: true } } },
  });
  if (!s || s.status === "CANCELLED") return;
  if (Date.now() <= s.endAt.getTime()) return; // not over yet
  if (s._count.attendances > 0) return; // already captured

  const token = await getUserGraphToken(s.scheduledById);
  if (!token) return;

  let meetingId = s.onlineMeetingId;
  if (!meetingId && s.joinUrl) {
    meetingId = await resolveOnlineMeetingId(token, s.joinUrl).catch(() => null);
    if (meetingId) {
      await prisma.liveSession
        .update({ where: { id: s.id }, data: { onlineMeetingId: meetingId } })
        .catch(() => {});
    }
  }
  if (!meetingId) return;

  const records = await listAttendanceRecords(token, meetingId).catch(() => []);
  if (records.length === 0) return; // report not ready — retry next sweep

  const durSec = Math.max(1, Math.round((s.endAt.getTime() - s.startAt.getTime()) / 1000));
  const users = await prisma.user.findMany({
    where: { email: { in: records.map((r) => r.email) } },
    select: { id: true, email: true },
  });
  const idByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

  for (const rec of records) {
    const userId = idByEmail.get(rec.email);
    if (!userId) continue; // external / non-LMS attendee
    const pct = Math.min(100, (rec.seconds / durSec) * 100);
    const points = liveAttendancePoints(pct);
    await prisma.liveAttendance
      .upsert({
        where: { liveSessionId_userId: { liveSessionId: s.id, userId } },
        create: { liveSessionId: s.id, userId, secondsAttended: rec.seconds, attendedPct: pct, points },
        update: { secondsAttended: rec.seconds, attendedPct: pct, points },
      })
      .catch(() => {});
  }
}

/**
 * Give live-session attendees credit for the RECORDING (not the quiz): attending
 * the live training counts as watching, so each attendee is marked as having
 * completed the recording video — no re-watch nag. The quiz is deliberately NOT
 * auto-passed: these sessions are HARD by design, so employees take the quiz
 * themselves (video-complete unlocks it). Idempotent.
 */
export async function creditLiveAttendees(sessionId: string): Promise<void> {
  const s = await prisma.liveSession.findUnique({
    where: { id: sessionId },
    select: { recordedVideoId: true },
  });
  if (!s?.recordedVideoId) return;

  const video = await prisma.video.findUnique({
    where: { id: s.recordedVideoId },
    select: {
      id: true,
      durationSeconds: true,
      quiz: { select: { id: true } },
    },
  });
  if (!video) return;

  // Only meaningful attendance earns credit — same tier as the attendance
  // points (>=40% of the session), not anyone who showed up for a second.
  const attendees = await prisma.liveAttendance.findMany({
    where: { liveSessionId: sessionId, points: { gt: 0 } },
    select: { userId: true },
  });
  const now = new Date();
  const dur = video.durationSeconds ?? 0;

  for (const a of attendees) {
    await prisma.videoProgress
      .upsert({
        where: { userId_videoId: { userId: a.userId, videoId: video.id } },
        create: {
          userId: a.userId,
          videoId: video.id,
          percent: 100,
          completed: true,
          completedAt: now,
          lastPosition: dur,
          watchedSeconds: dur,
        },
        update: { percent: 100, completed: true, completedAt: now },
      })
      .catch(() => {});
  }

  // Clean up the fabricated "auto-pass" attempts an earlier version created: a
  // passed attempt with no stored answers whose start == submit instant (a real
  // sitting always has time elapse and an answer map). Scoped to this quiz.
  if (video.quiz) {
    const rows = await prisma.quizAttempt.findMany({
      where: { quizId: video.quiz.id, passed: true },
      select: { id: true, answers: true, startedAt: true, submittedAt: true },
    });
    const fakeIds = rows
      .filter(
        (q) =>
          q.answers == null &&
          q.submittedAt != null &&
          q.startedAt.getTime() === q.submittedAt.getTime()
      )
      .map((q) => q.id);
    if (fakeIds.length > 0) {
      await prisma.quizAttempt.deleteMany({ where: { id: { in: fakeIds } } }).catch(() => {});
    }
  }
}
