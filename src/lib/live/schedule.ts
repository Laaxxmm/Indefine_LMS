// Live sessions: scheduling and editing, as the signed-in admin (organizer).
//   1. Ensures a folder named after the course/topic under the L&D root.
//   2. Creates a Teams meeting as a calendar event — Graph emails the invite.
//   3. Best-effort switches on automatic cloud recording.
//   4. Persists a LiveSession row linking it all together.
// Recording ingest lives in ./ingest.ts, attendance in ./attendance.ts, and the
// cron-driven pass that ties them together in ./sweep.ts.

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
  meetingHasEnded,
} from "@/lib/graph";
import { FIRM_TZ_GRAPH, istLocalToUtc, utcToIstWall, istLocalInputValue } from "@/lib/ist";

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
      "The chosen organizer has not connected Microsoft 365 — ask them to open /connect in the LMS once, then try again."
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
  if (!token) throw new Error("Organizer's Microsoft 365 connection is missing — they need to open /connect once.");

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
