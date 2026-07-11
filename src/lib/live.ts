// Live-session orchestration.
//
// Scheduling a session, as the signed-in admin (organizer):
//   1. Ensures a folder named after the course/topic under the L&D root.
//   2. Creates a Teams meeting as a calendar event — Graph emails the invite.
//   3. Best-effort switches on automatic cloud recording.
//   4. Persists a LiveSession row linking it all together.
//
// Ingesting a recording (Phase 2), acting as the organizer via their stored
// token (works headless in the cron):
//   find the recording in their OneDrive /Recordings → copy into the course
//   folder → sync it into the library as a Video → auto-generate its quiz.

import { prisma } from "@/lib/prisma";
import {
  getUserGraphToken,
  getAppOnlyToken,
  createTeamsEvent,
  ensureFolder,
  deleteEvent,
  resolveOnlineMeetingId,
  applyMeetingSettings,
  listMyRecordings,
  listUserRecordings,
  copyDriveItem,
  pollCopyStatus,
  listFolderVideos,
  fetchMeetingTranscript,
  meetingHasEnded,
  type RecordingCandidate,
} from "@/lib/graph";
import { syncOneDriveVideos } from "@/lib/sync";
import { autoQuizFromVideo } from "@/lib/auto-quiz";
import { FIRM_TZ_GRAPH, istLocalToUtc, utcToIstWall } from "@/lib/live-format";

export interface ScheduleInput {
  title: string;
  description?: string | null;
  courseTitle: string;
  /** IST wall-clock "YYYY-MM-DDTHH:mm" from a datetime-local input. */
  startLocal: string;
  durationMin: number;
  attendeeUserIds: string[];
}

export async function scheduleLiveSession(
  input: ScheduleInput,
  organizerUserId: string
) {
  const driveId = process.env.GRAPH_DRIVE_ID;
  const rootPath = process.env.GRAPH_VIDEOS_FOLDER_PATH;
  if (!driveId || !rootPath) {
    throw new Error(
      "GRAPH_DRIVE_ID and GRAPH_VIDEOS_FOLDER_PATH must be set to schedule live sessions."
    );
  }

  const token = await getUserGraphToken(organizerUserId);
  if (!token) {
    throw new Error(
      "No Microsoft token for the chosen organizer — they need to sign in to the LMS once (or sign out and back in), then try again."
    );
  }

  const startAt = istLocalToUtc(input.startLocal);
  if (Number.isNaN(startAt.getTime())) throw new Error("Invalid start time.");
  const endAt = new Date(startAt.getTime() + input.durationMin * 60_000);

  const attendees = await prisma.user.findMany({
    where: { id: { in: input.attendeeUserIds } },
    select: { email: true },
  });
  const attendeeEmails = attendees.map((a) => a.email).filter(Boolean);

  // 1) Recording folder (named after the course/topic).
  const targetFolderId = await ensureFolder(
    driveId,
    rootPath,
    input.courseTitle.trim(),
    token
  );

  // 2) Teams meeting — invites auto-send to attendees.
  const event = await createTeamsEvent(token, {
    subject: input.title.trim(),
    bodyHtml: input.description ? `<p>${escapeHtml(input.description)}</p>` : "",
    startLocal: utcToIstWall(startAt),
    endLocal: utcToIstWall(endAt),
    timeZone: FIRM_TZ_GRAPH,
    attendeeEmails,
  });

  // 3) Best-effort: resolve the Teams meeting and apply our defaults —
  // auto-recording + organizer-only presenter (scheduler is the host, everyone
  // else joins as attendee). Needs OnlineMeetings.ReadWrite; without that
  // scope this quietly no-ops and Teams defaults apply.
  let onlineMeetingId: string | null = null;
  if (event.joinUrl) {
    try {
      onlineMeetingId = await resolveOnlineMeetingId(token, event.joinUrl);
      if (onlineMeetingId) await applyMeetingSettings(token, onlineMeetingId);
    } catch {
      onlineMeetingId = null;
    }
  }

  // 4) Persist — roll back the calendar event if the DB write fails.
  try {
    return await prisma.liveSession.create({
      data: {
        title: input.title.trim(),
        description: input.description?.trim() || null,
        courseTitle: input.courseTitle.trim(),
        scheduledById: organizerUserId,
        startAt,
        endAt,
        attendeeIds: input.attendeeUserIds,
        graphEventId: event.eventId,
        onlineMeetingId,
        joinUrl: event.joinUrl,
        targetFolderId,
        status: "SCHEDULED",
      },
    });
  } catch (e) {
    await deleteEvent(token, event.eventId).catch(() => {});
    throw e;
  }
}

export async function cancelLiveSession(sessionId: string) {
  const s = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!s) return;
  // The calendar event lives on the ORGANIZER's calendar (who may not be the
  // admin clicking Cancel), so the delete must run with their token.
  const token = await getUserGraphToken(s.scheduledById);
  if (token && s.graphEventId) {
    await deleteEvent(token, s.graphEventId).catch(() => {});
  }
  await prisma.liveSession.update({
    where: { id: sessionId },
    data: { status: "CANCELLED" },
  });
}

/**
 * Confirm a session that's past its slot has ACTUALLY ended, using the Teams
 * attendance report as the signal (generated the moment the meeting session
 * ends — much faster than waiting for the recording file). Marks the DB
 * status ENDED so the UI stops showing "In progress". Returns true once the
 * session is confirmed over. No-ops while the scheduled slot is still open.
 */
export async function confirmSessionEnded(sessionId: string): Promise<boolean> {
  const s = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!s) return false;
  if (s.status !== "SCHEDULED") return s.status !== "LIVE";
  if (Date.now() <= s.endAt.getTime()) return false; // slot still open

  const token = await getUserGraphToken(s.scheduledById);
  if (!token) return false;

  let meetingId = s.onlineMeetingId;
  if (!meetingId && s.joinUrl) {
    meetingId = await resolveOnlineMeetingId(token, s.joinUrl).catch(() => null);
    if (meetingId) {
      await prisma.liveSession
        .update({ where: { id: s.id }, data: { onlineMeetingId: meetingId } })
        .catch(() => {});
    }
  }
  if (!meetingId) return false;

  const ended = await meetingHasEnded(token, meetingId).catch(() => null);
  if (ended === true) {
    await prisma.liveSession.update({
      where: { id: s.id },
      data: { status: "ENDED" },
    });
    return true;
  }
  return false;
}

/**
 * Make sure the session's Teams meeting has our defaults applied — automatic
 * cloud recording + organizer-only presenter. Auto-record is what guarantees
 * the recording is attributed to (and stored in the OneDrive of) the ORGANIZER
 * rather than whoever happened to click Record.
 *
 * scheduleLiveSession() already tries this once, but Teams often hasn't
 * provisioned the online meeting yet at that moment, so the settings silently
 * don't apply. The cron calls this for every upcoming session until it sticks.
 * Idempotent and cheap.
 */
export async function ensureMeetingSettings(sessionId: string): Promise<boolean> {
  const s = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!s || s.status !== "SCHEDULED" || !s.joinUrl) return false;

  const token = await getUserGraphToken(s.scheduledById);
  if (!token) return false;

  let meetingId = s.onlineMeetingId;
  if (!meetingId) {
    meetingId = await resolveOnlineMeetingId(token, s.joinUrl).catch(() => null);
    if (!meetingId) return false;
    await prisma.liveSession
      .update({ where: { id: s.id }, data: { onlineMeetingId: meetingId } })
      .catch(() => {});
  }
  return applyMeetingSettings(token, meetingId).catch(() => false);
}

// -------------------- Recording ingestion (Phase 2) --------------------

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

  // Has the copied recording already landed in the course folder?
  let newItemId: string | null = null;
  const inTarget = await listFolderVideos(driveId, s.targetFolderId, token);
  if (inTarget.length > 0) {
    newItemId = inTarget[0].id;
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
      if (landed.length > 0) newItemId = landed[0].id;
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

  // Give the lesson a clean title (the file name carries a .mp4 suffix).
  await prisma.video
    .update({ where: { id: video.id }, data: { title: s.title } })
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
  // quiz tests real understanding, not recall of throwaway lines.
  await autoQuizFromVideo(video.id, {
    fallbackUserId: s.scheduledById,
    noVideoFallback: true,
    difficulty: "HARD",
  });
}

/**
 * Pick the session's recording out of a /Recordings listing (newest first).
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
  const byTitle = timely.find((r) => normaliseTitle(r.name).includes(titleKey));
  if (byTitle) return byTitle;
  return opts.requireTitleMatch ? null : timely[0] ?? null;
}

/** Loose key for comparing a meeting title against a recording file name. */
function normaliseTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Strip characters SharePoint / OneDrive disallow in file names. */
function sanitizeName(s: string): string {
  return (
    s.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) ||
    "Recording"
  );
}
