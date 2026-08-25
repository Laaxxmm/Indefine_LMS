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
  resolveFolderId,
  getItemParentId,
  moveDriveItem,
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
  /** Optional grouping folder; the course folder nests under L&D/{folderParent}. */
  folderParent?: string | null;
  /** IST wall-clock "YYYY-MM-DDTHH:mm" from a datetime-local input. */
  startLocal: string;
  durationMin: number;
  attendeeUserIds: string[];
  /** Optional material files uploaded into the course folder. */
  materials?: { name: string; bytes: ArrayBuffer }[];
}

/** The L&D-relative path a session's recording folder lives under (its parent). */
function sessionParentPath(rootPath: string, folderParent?: string | null): string {
  const root = rootPath.replace(/^\/+|\/+$/g, "");
  const parent = folderParent?.trim();
  return parent ? `${root}/${parent}` : root;
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

  // 1) Recording folder (named after the course/topic), nested under the
  // optional parent folder: L&D/{folderParent}/{course}.
  const courseFolder = input.courseTitle.trim();
  const parentPath = sessionParentPath(rootPath, input.folderParent);
  if (input.folderParent?.trim()) {
    await ensureFolder(driveId, rootPath, input.folderParent.trim(), token);
  }
  const targetFolderId = await ensureFolder(driveId, parentPath, courseFolder, token);

  // 1b) Upload any attached materials into that same folder (best-effort).
  if (input.materials?.length) {
    const folderPath = `${parentPath}/${courseFolder}`;
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
        folderParent: input.folderParent?.trim() || null,
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
  folderParent?: string | null;
  startLocal: string; // IST wall-clock "YYYY-MM-DDTHH:mm"
  durationMin: number;
}

/**
 * Ensure a session's recording folder sits at L&D/{folderParent}/{courseTitle},
 * returning its driveItem id. If the session already has a folder it is MOVED
 * (and renamed if the course changed) so its recordings come along; otherwise a
 * fresh folder is created. Requires a write scope.
 */
async function applySessionFolder(
  driveId: string,
  rootPath: string,
  tokens: string[],
  existingFolderId: string | null,
  existingCourse: string,
  courseTitle: string,
  folderParent: string | null | undefined
): Promise<string> {
  // Try each available token (app-only + organizer's delegated) — whichever has
  // write scope wins. The folder create/move needs Files.ReadWrite.All, which
  // may sit on one token and not the other.
  let lastErr = "unknown error";
  for (const token of tokens) {
    try {
      const parent = folderParent?.trim();
      const destParentId = parent
        ? await ensureFolder(driveId, rootPath, parent, token) // L&D/{parent}
        : await resolveFolderId(driveId, rootPath, token); // back to the L&D root
      if (!destParentId) {
        lastErr = "couldn't resolve the destination folder";
        continue;
      }
      if (existingFolderId) {
        const rename = courseTitle !== existingCourse ? courseTitle : undefined;
        const ok = await moveDriveItem(driveId, existingFolderId, destParentId, token, rename);
        if (ok) return existingFolderId; // id preserved across a move
        lastErr = "the move was rejected (write permission)";
        continue;
      }
      const parentPath = sessionParentPath(rootPath, folderParent);
      return await ensureFolder(driveId, parentPath, courseTitle, token);
    } catch (e) {
      lastErr = (e as Error).message;
    }
  }
  throw new Error(
    `Couldn't move the SharePoint folder (${lastErr}). Grant the app Files.ReadWrite.All (Application) admin consent in Entra, or have the organizer sign out and back in.`
  );
}

/**
 * Move a session's recording folder under a parent (e.g. group Isha Misty KT and
 * Shellkode KT under "Accounting"). Works for past sessions too — moving the
 * SharePoint folder keeps the recordings' item ids, so the lessons stay intact.
 */
export async function moveSessionFolder(
  sessionId: string,
  folderParent: string | null
) {
  const s = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!s) throw new Error("Session not found.");
  const driveId = process.env.GRAPH_DRIVE_ID;
  const rootPath = process.env.GRAPH_VIDEOS_FOLDER_PATH;
  if (!driveId || !rootPath) throw new Error("Drive not configured.");

  const tokens = (
    await Promise.all([getAppOnlyToken(), getUserGraphToken(s.scheduledById)])
  ).filter((t): t is string => !!t);
  if (tokens.length === 0) throw new Error("No Microsoft Graph token available for the move.");
  const readToken = tokens[0];

  // The folder to move = the one actually holding this session's recording. Use
  // the recording video's real parent (bulletproof against a stale stored id),
  // falling back to the stored targetFolderId or the known path.
  let currentFolderId: string | null = null;
  if (s.recordedVideoId) {
    const video = await prisma.video.findUnique({
      where: { id: s.recordedVideoId },
      select: { graphDriveId: true, graphItemId: true },
    });
    if (video) {
      currentFolderId = await getItemParentId(video.graphDriveId, video.graphItemId, readToken);
    }
  }
  if (!currentFolderId) currentFolderId = s.targetFolderId;
  if (!currentFolderId) {
    const currentPath = `${sessionParentPath(rootPath, s.folderParent)}/${s.courseTitle}`;
    currentFolderId = await resolveFolderId(driveId, currentPath, readToken);
  }

  const parent = folderParent?.trim() || null;
  const targetFolderId = await applySessionFolder(
    driveId,
    rootPath,
    tokens,
    currentFolderId,
    s.courseTitle,
    s.courseTitle,
    parent
  );
  await prisma.liveSession.update({
    where: { id: s.id },
    data: { folderParent: parent, targetFolderId },
  });
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

  const newCourse = input.courseTitle.trim() || s.courseTitle;
  const newParent = input.folderParent?.trim() || null;
  let targetFolderId = s.targetFolderId;
  // Re-home / rename the recording folder if the course name or parent changed.
  if (newCourse !== s.courseTitle || newParent !== (s.folderParent ?? null)) {
    const driveId = process.env.GRAPH_DRIVE_ID;
    const rootPath = process.env.GRAPH_VIDEOS_FOLDER_PATH;
    if (driveId && rootPath) {
      const appToken = await getAppOnlyToken();
      const tokens = [appToken, token].filter((t): t is string => !!t);
      targetFolderId = await applySessionFolder(
        driveId,
        rootPath,
        tokens,
        s.targetFolderId,
        s.courseTitle,
        newCourse,
        newParent
      );
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
      courseTitle: newCourse,
      folderParent: newParent,
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
function stripExt(n: string): string {
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
