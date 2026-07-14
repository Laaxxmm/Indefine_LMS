// Hands-off recording ingestion.
//
// Hit this on a schedule (e.g. every 15 min) with the shared secret:
//   GET /api/cron/live/ingest?key=$CRON_SECRET
//   (or Authorization: Bearer $CRON_SECRET)
//
// It finds finished sessions whose recording hasn't been ingested yet and runs
// the ingest pipeline (find recording → copy into the course folder → sync as a
// Video → auto-quiz). ingestRecording is idempotent and returns "pending" while
// a recording isn't ready, so unprocessed sessions are simply retried next tick.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  ingestRecording,
  ensureTranscriptQuiz,
  confirmSessionEnded,
  ensureMeetingSettings,
} from "@/lib/live";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.nextUrl.searchParams.get("key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Upcoming sessions: keep re-applying auto-record + organizer-only presenter
  // until they stick. Teams provisions the online meeting some time after the
  // calendar event is created, so the attempt made at schedule time often
  // no-ops — without this retry the recording is attributed to whoever clicks
  // Record and lands in THEIR OneDrive instead of the organizer's.
  const upcoming = await prisma.liveSession.findMany({
    where: { status: "SCHEDULED", startAt: { gt: now, lt: weekAhead } },
    select: { id: true },
    take: 20,
  });
  for (const s of upcoming) {
    await ensureMeetingSettings(s.id).catch(() => {});
  }

  // Finished, not-yet-ingested, not cancelled, within the last week.
  const due = await prisma.liveSession.findMany({
    where: {
      endAt: { lt: now, gte: weekAgo },
      recordedVideoId: null,
      NOT: [{ status: "INGESTED" }, { status: "CANCELLED" }],
    },
    orderBy: { endAt: "asc" },
    take: 10,
  });

  const results: {
    id: string;
    title: string;
    status: string;
    message?: string;
  }[] = [];

  for (const s of due) {
    // Confirm the meeting actually ended (attendance report exists) — with a
    // 4h cap fallback so unconfirmable sessions don't stay "In progress".
    if (s.status === "SCHEDULED") {
      const confirmed = await confirmSessionEnded(s.id).catch(() => false);
      if (
        !confirmed &&
        now.getTime() > s.endAt.getTime() + 4 * 60 * 60 * 1000
      ) {
        await prisma.liveSession
          .update({ where: { id: s.id }, data: { status: "ENDED" } })
          .catch(() => {});
      }
    }
    try {
      const r = await ingestRecording(s.id);
      results.push({ id: s.id, title: s.title, status: r.status, message: r.message });
    } catch (e) {
      results.push({
        id: s.id,
        title: s.title,
        status: "error",
        message: (e as Error).message,
      });
    }
  }

  // Retry transcript-based quiz generation for ingested sessions whose quiz
  // isn't there yet. Uses the same week window as ingestion (not 24h) so a
  // saved transcript that failed generation once keeps getting retried instead
  // of being stranded. ensureTranscriptQuiz no-ops once a quiz exists.
  const recentlyIngested = await prisma.liveSession.findMany({
    where: {
      status: "INGESTED",
      recordedVideoId: { not: null },
      endAt: { gte: weekAgo },
    },
    select: { id: true },
    take: 20,
  });
  for (const s of recentlyIngested) {
    await ensureTranscriptQuiz(s.id).catch(() => {});
  }

  return NextResponse.json({
    processed: due.length,
    quizRetries: recentlyIngested.length,
    results,
  });
}
