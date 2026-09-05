// Live sessions: the hands-off pass that the cron (/api/cron/live/ingest) and the
// admin page both run. Keeps meeting settings applied, ingests recordings, captures
// attendance and (re)generates transcript quizzes. Idempotent.

import { prisma } from "@/lib/prisma";
import { confirmSessionEnded, ensureMeetingSettings } from "./schedule";
import { ensureTranscriptQuiz, ingestRecording, normaliseTitle, stripExt } from "./ingest";
import { captureAttendance, creditLiveAttendees } from "./attendance";

/**
 * One pass of the hands-off pipeline: keep auto-record settings applied to
 * upcoming sessions, ingest finished recordings, capture attendance, and
 * (re)generate transcript quizzes. Shared by the scheduled cron and the admin
 * Live-sessions page so it happens even without the external cron. Idempotent.
 */
export async function runIngestSweep(): Promise<{
  processed: number;
  quizRetries: number;
  results: { id: string; title: string; status: string; message?: string }[];
}> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const upcoming = await prisma.liveSession.findMany({
    where: { status: "SCHEDULED", startAt: { gt: now, lt: weekAhead } },
    select: { id: true },
    take: 20,
  });
  for (const s of upcoming) await ensureMeetingSettings(s.id).catch(() => {});

  // Self-heal shared-folder collisions: a session's recorded video is wrong if
  // it no longer exists, OR its title isn't this session's (two sessions ended
  // up pointing at the same recording). Reset those so the ingest below re-pulls
  // each session's OWN recording and regenerates its quiz. No manual repull.
  const ingestedWithVideo = await prisma.liveSession.findMany({
    where: { status: "INGESTED", recordedVideoId: { not: null }, endAt: { gte: weekAgo } },
    select: { id: true, title: true, recordedVideoId: true },
  });
  for (const s of ingestedWithVideo) {
    const v = await prisma.video.findUnique({
      where: { id: s.recordedVideoId! },
      select: { title: true },
    });
    // Compare loosely — ignore a stray ".mp4" or punctuation drift so a
    // cosmetic title difference never triggers a reset (which wipes progress).
    // Only a genuinely different recording (another session's file) resets.
    if (!v || normaliseTitle(stripExt(v.title)) !== normaliseTitle(stripExt(s.title))) {
      await prisma.liveSession
        .update({
          where: { id: s.id },
          data: { recordedVideoId: null, recordingItemId: null, status: "ENDED" },
        })
        .catch(() => {});
    }
  }

  const due = await prisma.liveSession.findMany({
    where: {
      endAt: { lt: now, gte: weekAgo },
      recordedVideoId: null,
      NOT: [{ status: "INGESTED" }, { status: "CANCELLED" }],
    },
    orderBy: { endAt: "asc" },
    take: 10,
  });

  const results: { id: string; title: string; status: string; message?: string }[] = [];
  for (const s of due) {
    if (s.status === "SCHEDULED") {
      const confirmed = await confirmSessionEnded(s.id).catch(() => false);
      if (!confirmed && now.getTime() > s.endAt.getTime() + 4 * 60 * 60 * 1000) {
        await prisma.liveSession
          .update({ where: { id: s.id }, data: { status: "ENDED" } })
          .catch(() => {});
      }
    }
    try {
      const r = await ingestRecording(s.id);
      results.push({ id: s.id, title: s.title, status: r.status, message: r.message });
    } catch (e) {
      results.push({ id: s.id, title: s.title, status: "error", message: (e as Error).message });
    }
  }

  const recentlyIngested = await prisma.liveSession.findMany({
    where: { status: "INGESTED", recordedVideoId: { not: null }, endAt: { gte: weekAgo } },
    select: { id: true },
    take: 20,
  });
  for (const s of recentlyIngested) await ensureTranscriptQuiz(s.id).catch(() => {});

  // Capture attendance for any ended session that doesn't have it yet.
  const needAttendance = await prisma.liveSession.findMany({
    where: {
      endAt: { lt: now, gte: weekAgo },
      status: { not: "CANCELLED" },
      attendances: { none: {} },
    },
    select: { id: true },
    take: 20,
  });
  for (const s of needAttendance) await captureAttendance(s.id).catch(() => {});

  // Give attendees credit for the recording (video complete + quiz passed) now
  // that attendance and the quiz are in place — attending the live training
  // counts as doing it.
  for (const s of recentlyIngested) await creditLiveAttendees(s.id).catch(() => {});

  return { processed: due.length, quizRetries: recentlyIngested.length, results };
}
