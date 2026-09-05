// Live sessions: bringing a finished session's Teams recording into the library.
// Acts as the organizer via their stored token (works headless in the cron):
//   find the recording in their OneDrive /Recordings → copy into the course
//   folder → sync it into the library as a Video → auto-generate its quiz from
//   the Teams transcript. Every function is idempotent and returns "pending"
//   while Teams has not produced the file yet, so the sweep can retry.

import { prisma } from "@/lib/prisma";
import {
  getUserGraphToken,
  getAppOnlyToken,
  listMyRecordings,
  listUserRecordings,
  copyDriveItem,
  pollCopyStatus,
  listFolderVideos,
  fetchMeetingTranscript,
  resolveOnlineMeetingId,
  deleteDriveItem,
  type RecordingCandidate,
} from "@/lib/graph";
import { syncOneDriveVideos } from "@/lib/sync";
import { autoQuizFromVideo } from "@/lib/auto-quiz";

export interface IngestResult {
  status: "ingested" | "pending" | "error";
  videoId?: string;
  message?: string;
}

/**
 * Bring a finished session's Teams recording into the library. Idempotent and
 * safe to re-run: returns "pending" while the recording isn't available yet or
 * the copy is still in flight, so the cron can simply try again next tick.
 */
export async function ingestRecording(sessionId: string): Promise<IngestResult> {
  const s = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!s) return { status: "error", message: "Session not found." };
  if (s.recordedVideoId) {
    // Already ingested — nudge the (cheap) transcript quiz in case it's still missing.
    ensureTranscriptQuiz(s.id).catch(() => {});
    return { status: "ingested", videoId: s.recordedVideoId };
  }

  const driveId = process.env.GRAPH_DRIVE_ID;
  if (!driveId || !s.targetFolderId) {
    return { status: "error", message: "Drive / target folder not configured." };
  }

  const token = await getUserGraphToken(s.scheduledById);
  if (!token) {
    return {
      status: "error",
      message: "Organizer's Microsoft token unavailable — they need to sign in.",
    };
  }

  // Has THIS session's recording already landed in the course folder? Match by
  // the file we copy it as ("<session title>.mp4") — several sessions can share
  // one folder (e.g. two ITR sessions both under "Tax Training 2026"), so we
  // must never grab another session's recording here.
  const wantBase = sanitizeName(s.title).toLowerCase();
  const pickMine = (files: { id: string; name: string }[]) =>
    files.find((v) => v.name.toLowerCase().startsWith(wantBase)) ?? null;

  let newItemId: string | null = null;
  const inTarget = await listFolderVideos(driveId, s.targetFolderId, token);
  const mine = pickMine(inTarget);
  if (mine) {
    newItemId = mine.id;
  } else if (s.recordingItemId) {
    // Copy was kicked off on a prior run but hasn't landed yet — wait, don't re-copy.
    return { status: "pending", message: "Recording copy still in progress." };
  } else {
    // Teams stores a meeting recording in the OneDrive /Recordings folder of
    // WHOEVER started the recording — organizer if auto-record engaged, but
    // any attendee who clicked Record otherwise. So: check the organizer's
    // OneDrive first (delegated token), then fall back to scanning every
    // invited attendee's OneDrive with the app-only token.
    const recs = await listMyRecordings(token);
    let match = matchRecording(recs, s.title, s.startAt, {
      requireTitleMatch: false, // organizer's own drive — time match is enough
    });
    let copyToken = token;
    let searchedOthers = false;

    if (!match) {
      const appToken = await getAppOnlyToken();
      if (appToken) {
        searchedOthers = true;
        const attendeeIds = Array.isArray(s.attendeeIds)
          ? (s.attendeeIds as string[])
          : [];
        const candidates = await prisma.user.findMany({
          where: { id: { in: attendeeIds.filter((id) => id !== s.scheduledById) } },
          select: { email: true },
        });
        for (const u of candidates) {
          if (!u.email) continue;
          const theirs = await listUserRecordings(appToken, u.email).catch(
            () => [] as RecordingCandidate[]
          );
          // Someone else's personal drive — insist the file name carries the
          // meeting title so we never grab an unrelated recording of theirs.
          const m = matchRecording(theirs, s.title, s.startAt, {
            requireTitleMatch: true,
          });
          if (m) {
            match = m;
            copyToken = appToken; // organizer's token can't read their drive
            break;
          }
        }
      }
    }

    if (!match || !match.driveId) {
      return {
        status: "pending",
        message: searchedOthers
          ? "Recording not found in the organizer's or attendees' OneDrive /Recordings yet."
          : "Recording not available yet in the organizer's OneDrive.",
      };
    }

    const monitor = await copyDriveItem(
      copyToken,
      match.driveId,
      match.id,
      driveId,
      s.targetFolderId,
      `${sanitizeName(s.title)}.mp4`
    );
    if (!monitor) {
      // Copy never started — most likely the token lacks write permission
      // (cross-drive copy with the app-only token needs Files.ReadWrite.All
      // APPLICATION consent). Don't mark anything; surface it and retry later.
      return {
        status: "error",
        message:
          "Found the recording but couldn't start the copy — check the app has Files.ReadWrite.All (application) admin consent in Entra.",
      };
    }
    // Record that we've started the copy so a retry doesn't duplicate it.
    await prisma.liveSession.update({
      where: { id: s.id },
      data: { recordingItemId: match.id, status: "RECORDING_READY" },
    });
    newItemId = await pollCopyStatus(monitor);
    if (!newItemId) {
      const landed = await listFolderVideos(driveId, s.targetFolderId, token);
      newItemId = pickMine(landed)?.id ?? null;
    }
    if (!newItemId) {
      return { status: "pending", message: "Recording copy in progress." };
    }
  }

  // Ingest into the library (idempotent) and find the resulting Video row.
  await syncOneDriveVideos({ fallbackUserId: s.scheduledById }).catch(() => {});
  const video = await prisma.video.findFirst({
    where: { graphItemId: newItemId, graphDriveId: driveId },
    select: { id: true },
  });
  if (!video) return { status: "pending", message: "Waiting for library sync." };

  // Give the lesson a clean title (the file name carries a .mp4 suffix) and
  // credit the organizer as the content creator (feeds the Initiative track).
  await prisma.video
    .update({ where: { id: video.id }, data: { title: s.title, createdById: s.scheduledById } })
    .catch(() => {});

  await prisma.liveSession.update({
    where: { id: s.id },
    data: {
      recordedVideoId: video.id,
      recordingItemId: s.recordingItemId ?? newItemId,
      status: "INGESTED",
    },
  });

  // Allot the lesson to everyone who was invited. Course visibility is
  // assignment-based, so this is what makes the recording (and its quiz)
  // appear on the attendees' dashboards. 0 points: watching it already earns
  // the normal video + quiz KRA points, no double credit.
  const invitees = Array.isArray(s.attendeeIds) ? (s.attendeeIds as string[]) : [];
  if (invitees.length > 0) {
    const already = await prisma.assignment.findMany({
      where: { videoId: video.id, userId: { in: invitees } },
      select: { userId: true },
    });
    const have = new Set(already.map((a) => a.userId));
    const data = invitees
      .filter((uid) => !have.has(uid))
      .map((uid) => ({
        userId: uid,
        assignedById: s.scheduledById,
        kind: "VIDEO" as const,
        videoId: video.id,
        title: s.title,
        points: 0,
        autoGenerated: true, // catch-up material — not a graded obligation
      }));
    if (data.length > 0) {
      await prisma.assignment.createMany({ data }).catch(() => {});
    }
  }

  // Generate the quiz from the Teams transcript (cheap) — never from the video.
  ensureTranscriptQuiz(s.id).catch(() => {});

  return { status: "ingested", videoId: video.id };
}

/**
 * Generate a session's quiz from its Teams transcript — the cheap path (no video
 * sent to Gemini). Safe to re-run: no-ops once a quiz exists, and returns quietly
 * while the transcript isn't ready yet, so the cron can simply retry next tick.
 */
export async function ensureTranscriptQuiz(sessionId: string): Promise<void> {
  const s = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!s || !s.recordedVideoId) return;

  const video = await prisma.video.findUnique({
    where: { id: s.recordedVideoId },
    select: {
      id: true,
      sourceText: true,
      quiz: { select: { _count: { select: { questions: true } } } },
    },
  });
  if (!video) return;
  if ((video.quiz?._count.questions ?? 0) > 0) return; // already has a quiz

  let sourceText = (video.sourceText ?? "").trim();
  if (sourceText.length < 200) {
    const token = await getUserGraphToken(s.scheduledById);
    if (token) {
      // Resolve the meeting id if it wasn't captured at schedule time.
      let meetingId = s.onlineMeetingId;
      if (!meetingId && s.joinUrl) {
        meetingId = await resolveOnlineMeetingId(token, s.joinUrl).catch(
          () => null
        );
        if (meetingId) {
          await prisma.liveSession
            .update({ where: { id: s.id }, data: { onlineMeetingId: meetingId } })
            .catch(() => {});
        }
      }
      if (meetingId) {
        const transcript = await fetchMeetingTranscript(token, meetingId).catch(
          () => null
        );
        if (transcript && transcript.trim().length >= 200) {
          sourceText = transcript.trim();
          await prisma.video
            .update({ where: { id: video.id }, data: { sourceText } })
            .catch(() => {});
        }
      }
    }
  }

  if (sourceText.length < 200) return; // transcript not ready yet — retry next tick

  // Live-session quizzes are HARD: attendees sat through the session, so the
  // quiz tests real understanding, not recall of throwaway lines. Log the
  // reason on failure (the cron retries next tick) instead of black-holing it.
  const res = await autoQuizFromVideo(video.id, {
    fallbackUserId: s.scheduledById,
    noVideoFallback: true,
    difficulty: "HARD",
  });
  if (!res.ok) {
    console.error(
      `ensureTranscriptQuiz: quiz generation failed for session ${s.id} / video ${video.id}: ${res.error ?? res.skipped}`
    );
  }
}

/**
 * Pick the session's recording out of a /Recordings listing. Prefers the
 * LARGEST file — if someone false-starts recording (stop, then re-record), the
 * short throwaway clip and the full session both sit in /Recordings; the full
 * one is always bigger.
 * Time filter: created no earlier than 10 min before the scheduled start.
 * Title filter: Teams names recordings "<subject>-YYYYMMDD_HHMMSS-Meeting
 * Recording.mp4", so the meeting title appears in the file name. Optional for
 * the organizer's own drive, mandatory when scanning other people's drives.
 */
function matchRecording(
  recs: RecordingCandidate[],
  title: string,
  startAt: Date,
  opts: { requireTitleMatch: boolean }
): RecordingCandidate | null {
  const floor = startAt.getTime() - 10 * 60 * 1000; // 10-min grace pre-start
  const titleKey = normaliseTitle(title);
  const timely = recs.filter(
    (r) => new Date(r.createdDateTime).getTime() >= floor
  );
  const titled = timely.filter((r) => normaliseTitle(r.name).includes(titleKey));
  const pool = titled.length > 0 ? titled : opts.requireTitleMatch ? [] : timely;
  return largestBySize(pool);
}

function largestBySize<T extends { size: number }>(items: T[]): T | null {
  return items.reduce<T | null>(
    (best, cur) => (best === null || cur.size > best.size ? cur : best),
    null
  );
}

/**
 * Re-ingest a session's recording, dropping whatever was ingested before. Fixes
 * the false-start case: the wrong (short) clip was already copied in and
 * published, so we delete that copied file + its Video row, reset the session,
 * and run ingest again — which now picks the largest recording. Transcript and
 * quiz regenerate from Teams automatically.
 */
export async function repullRecording(sessionId: string): Promise<IngestResult> {
  const s = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!s) return { status: "error", message: "Session not found." };

  if (s.recordedVideoId) {
    const driveId = process.env.GRAPH_DRIVE_ID;
    const video = await prisma.video.findUnique({
      where: { id: s.recordedVideoId },
      select: { graphDriveId: true, graphItemId: true },
    });
    // Remove the wrongly-copied file from the course folder so ingest doesn't
    // just re-grab it from there instead of re-scanning /Recordings.
    if (video && driveId) {
      const token = await getUserGraphToken(s.scheduledById);
      if (token) {
        await deleteDriveItem(video.graphDriveId, video.graphItemId, token);
      }
    }
    // Drop the wrong Video (and its auto-assignments); quiz + progress cascade.
    await prisma.assignment
      .deleteMany({ where: { videoId: s.recordedVideoId } })
      .catch(() => {});
    await prisma.video.delete({ where: { id: s.recordedVideoId } }).catch(() => {});
    await prisma.liveSession.update({
      where: { id: s.id },
      data: { recordedVideoId: null, recordingItemId: null, status: "ENDED" },
    });
  }

  return ingestRecording(sessionId);
}

/** Drop a trailing file extension (".mp4", ".mov") before title comparison. */
export function stripExt(n: string): string {
  return n.replace(/\.[a-z0-9]{2,4}$/i, "");
}

/**
 * Pull the driveId + driveItemId out of a Teams "meetingrecap" share link.
 * Those two query params point straight at the recording's OneDrive item.
 */
function parseRecapLink(url: string): { srcDriveId: string | null; srcItemId: string | null } {
  try {
    const q = new URL(url).searchParams;
    return { srcDriveId: q.get("driveId"), srcItemId: q.get("driveItemId") };
  } catch {
    return { srcDriveId: null, srcItemId: null };
  }
}

/**
 * Ingest a recording from a Teams recap/share link — for when the recording
 * lives in someone OTHER than the organizer's OneDrive (whoever clicked Record),
 * so the normal /Recordings scan can't find it. Copies the file (by the driveId
 * + driveItemId in the link) into the session's course folder, then hands off to
 * the normal ingest, which links it, allots it to attendees and builds the quiz.
 */
export async function ingestFromRecapLink(
  sessionId: string,
  url: string
): Promise<IngestResult> {
  const s = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!s) return { status: "error", message: "Session not found." };
  if (s.recordedVideoId) return { status: "ingested", videoId: s.recordedVideoId };

  const driveId = process.env.GRAPH_DRIVE_ID;
  if (!driveId || !s.targetFolderId) {
    return { status: "error", message: "Drive / target folder not configured." };
  }

  const { srcDriveId, srcItemId } = parseRecapLink(url);
  if (!srcDriveId || !srcItemId) {
    return {
      status: "error",
      message:
        "Couldn't read driveId/driveItemId from that link — paste the Teams 'meetingrecap' share link for the recording.",
    };
  }

  // Reading another person's OneDrive needs the app-only token (Files.ReadWrite.All
  // Application). Fall back to the organizer's delegated token (works only if the
  // recording is in their own drive).
  const tokens = (
    await Promise.all([getAppOnlyToken(), getUserGraphToken(s.scheduledById)])
  ).filter((t): t is string => !!t);
  if (tokens.length === 0) {
    return { status: "error", message: "No Microsoft Graph token available for the copy." };
  }

  let monitor: string | null = null;
  for (const t of tokens) {
    monitor = await copyDriveItem(
      t,
      srcDriveId,
      srcItemId,
      driveId,
      s.targetFolderId,
      `${sanitizeName(s.title)}.mp4`
    ).catch(() => null);
    if (monitor) break;
  }
  if (!monitor) {
    return {
      status: "error",
      message:
        "Found the link but couldn't start the copy — grant the app Files.ReadWrite.All (Application) admin consent in Entra so it can read the recorder's OneDrive.",
    };
  }
  await pollCopyStatus(monitor);

  // The file now sits in the session folder named after the title — the normal
  // ingest matches it there and does the rest (link + assign + transcript quiz).
  return ingestRecording(sessionId);
}

/** Loose key for comparing a meeting title against a recording file name. */
export function normaliseTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip characters SharePoint / OneDrive disallow in file names. */
function sanitizeName(s: string): string {
  return (
    s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) ||
    "Recording"
  );
}
