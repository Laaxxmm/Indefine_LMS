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
  updateTeamsEvent,
  ensureFolder,
  uploadFileToFolder,
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
  listAttendanceRecords,
  deleteDriveItem,
  type RecordingCandidate,
} from "@/lib/graph";
import { syncOneDriveVideos } from "@/lib/sync";
import { autoQuizFromVideo } from "@/lib/auto-quiz";
import {
  FIRM_TZ_GRAPH,
  istLocalToUtc,
  utcToIstWall,
  istLocalInputValue,
} from "@/lib/live-format";

export interface ScheduleInput {
  title: string;
  description?: string | null;
  courseTitle: string;
  /** IST wall-clock "YYYY-MM-DDTHH:mm" from a datetime-local input. */
  startLocal: string;
  durationMin: number;
  attendeeUserIds: string[];
  /** Optional material files uploaded into the L&D/{course} folder. */
  materials?: { name: string; bytes: ArrayBuffer }[];
}

/**
 * Schedule one or more sessions. repeat "daily"/"weekly" creates `occurrences`
 * separate sessions (own Teams meeting + independent recording/ingest each) —
 * we deliberately DON'T use a Graph recurring event, since the whole
 * recording→transcript→quiz pipeline is built around one session = one meeting.
 * Materials upload once (they share the course folder). Returns the first.
 */
export async function scheduleRecurring(
  input: ScheduleInput,
  organizerUserId: string,
  repeat: "none" | "daily" | "weekly",
  occurrences: number
) {
  const intervalDays = repeat === "weekly" ? 7 : repeat === "daily" ? 1 : 0;
  const count = intervalDays ? Math.min(12, Math.max(1, occurrences)) : 1;
  const baseUtc = istLocalToUtc(input.startLocal);
  if (Number.isNaN(baseUtc.getTime())) throw new Error("Invalid start time.");

  let first: Awaited<ReturnType<typeof scheduleLiveSession>> | null = null;
  for (let k = 0; k < count; k++) {
    const occUtc = new Date(baseUtc.getTime() + k * intervalDays * 86_400_000);
    const s = await scheduleLiveSession(
      {
        ...input,
        // datetime-local shape ("YYYY-MM-DDTHH:mm") — scheduleLiveSession parses
        // this with istLocalToUtc, which appends ":00+05:30".
        startLocal: istLocalInputValue(occUtc),
        materials: k === 0 ? input.materials : undefined, // upload once
      },
      organizerUserId
    );
    if (k === 0) first = s;
  }
  return first;
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
  const courseFolder = input.courseTitle.trim();
  const targetFolderId = await ensureFolder(driveId, rootPath, courseFolder, token);

  // 1b) Upload any attached materials into that same folder (best-effort).
  if (input.materials?.length) {
    const folderPath = `${rootPath.replace(/^\/+|\/+$/g, "")}/${courseFolder}`;
    for (const m of input.materials) {
      await uploadFileToFolder(driveId, folderPath, m.name, m.bytes, token).catch(
        () => false
      );
    }
  }

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

export interface EditInput {
  title: string;
  courseTitle: string;
  startLocal: string; // IST wall-clock "YYYY-MM-DDTHH:mm"
  durationMin: number;
}

/**
 * Edit an upcoming session: new time, duration, title and/or folder. Reschedules
 * the Teams event (attendees get the update) and, if the folder changed, ensures
 * the new L&D/{course} folder so the recording lands there. Attendees aren't
 * editable here.
 */
export async function updateLiveSession(sessionId: string, input: EditInput) {
  const s = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!s) throw new Error("Session not found.");
  if (s.status !== "SCHEDULED") {
    throw new Error("Only upcoming sessions can be edited.");
  }
  const token = await getUserGraphToken(s.scheduledById);
  if (!token) throw new Error("Organizer's Microsoft token unavailable — they need to sign in.");

  const startAt = istLocalToUtc(input.startLocal);
  if (Number.isNaN(startAt.getTime())) throw new Error("Invalid start time.");
  const endAt = new Date(startAt.getTime() + input.durationMin * 60_000);

  const newCourse = input.courseTitle.trim();
  let targetFolderId = s.targetFolderId;
  if (newCourse && newCourse !== s.courseTitle) {
    const driveId = process.env.GRAPH_DRIVE_ID;
    const rootPath = process.env.GRAPH_VIDEOS_FOLDER_PATH;
    if (driveId && rootPath) {
      targetFolderId = await ensureFolder(driveId, rootPath, newCourse, token);
    }
  }

  if (s.graphEventId) {
    await updateTeamsEvent(token, s.graphEventId, {
      subject: input.title.trim(),
      startLocal: utcToIstWall(startAt),
      endLocal: utcToIstWall(endAt),
      timeZone: FIRM_TZ_GRAPH,
    });
  }

  await prisma.liveSession.update({
    where: { id: s.id },
    data: {
      title: input.title.trim(),
      courseTitle: newCourse || s.courseTitle,
      startAt,
      endAt,
      targetFolderId,
    },
  });
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

  return { processed: due.length, quizRetries: recentlyIngested.length, results };
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

  // Has the copied recording already landed in the course folder? Pick the
  // largest if several are present (e.g. after a false-start re-record).
  let newItemId: string | null = null;
  const inTarget = await listFolderVideos(driveId, s.targetFolderId, token);
  if (inTarget.length > 0) {
    newItemId =
      inTarget.reduce((best, cur) =>
        (cur.size ?? 0) > (best.size ?? 0) ? cur : best
      ).id;
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
