// Live-session orchestration.
//
// Scheduling a session does three things as the signed-in admin (organizer):
//   1. Ensures a folder named after the course/topic exists under the L&D root
//      (this is where the recording will land and get ingested in Phase 2).
//   2. Creates a Teams meeting as a calendar event — Graph emails the invite
//      to every attendee automatically.
//   3. Persists a LiveSession row linking the two.
//
// The firm operates in India, so all times are entered/shown in IST. IST is a
// fixed UTC+05:30 (no DST), so a constant offset is always correct.

import { prisma } from "@/lib/prisma";
import {
  getUserGraphToken,
  createTeamsEvent,
  ensureFolder,
  deleteEvent,
} from "@/lib/graph";

/** Time-zone name Microsoft Graph recognises for the event payload. */
export const FIRM_TZ_GRAPH = "India Standard Time";
const IST_OFFSET_MIN = 5 * 60 + 30;

/** Parse a datetime-local wall-clock string ("YYYY-MM-DDTHH:mm") as IST → UTC Date. */
export function istLocalToUtc(local: string): Date {
  return new Date(`${local}:00+05:30`);
}

/** Format a UTC Date as an IST wall-clock string "YYYY-MM-DDTHH:mm:ss" (Graph payload). */
export function utcToIstWall(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 19);
}

/** datetime-local default value ("YYYY-MM-DDTHH:mm") for a UTC instant, in IST. */
export function istLocalInputValue(d: Date): string {
  return utcToIstWall(d).slice(0, 16);
}

/** Human display, e.g. "Tue, 15 Jul 2026, 3:00 pm IST". */
export function formatIst(d: Date): string {
  const s = d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${s} IST`;
}

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
      "No Microsoft token for your account — sign out and back in, then try again."
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

  // 3) Persist — roll back the calendar event if the DB write fails.
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

export async function cancelLiveSession(
  sessionId: string,
  organizerUserId: string
) {
  const s = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!s) return;
  const token = await getUserGraphToken(organizerUserId);
  if (token && s.graphEventId) {
    await deleteEvent(token, s.graphEventId).catch(() => {});
  }
  await prisma.liveSession.update({
    where: { id: sessionId },
    data: { status: "CANCELLED" },
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
