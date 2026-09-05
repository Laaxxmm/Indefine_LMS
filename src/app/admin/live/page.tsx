import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  Radio,
  Video,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Users as UsersIcon,
  CalendarClock,
  Info,
  PlayCircle,
  Download,
  Pencil,
  FolderInput,
} from "lucide-react";
import {
  scheduleRecurring,
  updateLiveSession,
  moveSessionFolder,
  cancelLiveSession,
  confirmSessionEnded,
} from "@/lib/live/schedule";
import { ingestRecording, repullRecording, ingestFromRecapLink } from "@/lib/live/ingest";
import { istLocalInputValue, formatIst, istLocalToUtc, istDate } from "@/lib/ist";
import {
  getAppOnlyToken,
  getUserGraphToken,
  listSubfolderNames,
  ensureFolder,
} from "@/lib/graph";
import { JoinMeetingButton } from "@/components/JoinMeetingButton";
import ScheduleLiveForm from "./ScheduleLiveForm";
import AddPastSessionForm from "./AddPastSessionForm";
import { AutoIngest } from "./AutoIngest";
import { isAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");
  return session;
}

async function scheduleSession(formData: FormData) {
  "use server";
  const session = await requireAdmin();
  const title = String(formData.get("title") || "").trim();
  const courseTitle = String(formData.get("courseTitle") || "").trim();
  const folderParent = String(formData.get("folderParent") || "").trim() || null;
  const description = String(formData.get("description") || "").trim() || null;
  const startLocal = String(formData.get("startLocal") || "");
  const durationMin = Number(formData.get("durationMin") || 60);
  const attendeeUserIds = formData
    .getAll("attendeeIds")
    .map(String)
    .filter(Boolean);
  const repeat = String(formData.get("repeat") || "none") as
    | "none"
    | "daily"
    | "weekly";
  const occurrences = Number(formData.get("occurrences") || 1);

  // Attached material files → { name, bytes } for upload into the course folder.
  const materials: { name: string; bytes: ArrayBuffer }[] = [];
  for (const f of formData.getAll("materials")) {
    if (f instanceof File && f.size > 0) {
      materials.push({ name: f.name, bytes: await f.arrayBuffer() });
    }
  }

  if (!title || !courseTitle || !startLocal) return;

  // Organizer = the Teams meeting host. The meeting is created with THEIR
  // delegated token (on their calendar), so they must have signed in to the
  // LMS at least once. Falls back to the scheduling admin.
  let organizerId = String(formData.get("organizerId") || "") || session.user.id;
  if (organizerId !== session.user.id) {
    const ok = await prisma.account.findFirst({
      where: { userId: organizerId, provider: "microsoft-entra-id" },
      select: { id: true },
    });
    if (!ok) organizerId = session.user.id;
  }

  // redirect() throws internally, so keep it OUT of the try/catch.
  let errMsg: string | null = null;
  try {
    await scheduleRecurring(
      {
        title,
        courseTitle,
        folderParent,
        description,
        startLocal,
        durationMin: Number.isFinite(durationMin) ? durationMin : 60,
        attendeeUserIds,
        materials,
      },
      organizerId,
      repeat,
      Number.isFinite(occurrences) ? occurrences : 1
    );
  } catch (e) {
    errMsg = (e as Error).message;
  }

  if (errMsg) {
    redirect(`/admin/live?error=${encodeURIComponent(errMsg)}`);
  }
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
  redirect("/admin/live?tab=sessions&scheduled=1");
}

async function editSession(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const title = String(formData.get("title") || "").trim();
  const courseTitle = String(formData.get("courseTitle") || "").trim();
  const folderParent = String(formData.get("folderParent") || "").trim() || null;
  const startLocal = String(formData.get("startLocal") || "");
  const durationMin = Number(formData.get("durationMin") || 60);
  if (!id || !title || !courseTitle || !startLocal) return;

  let errMsg: string | null = null;
  try {
    await updateLiveSession(id, {
      title,
      courseTitle,
      folderParent,
      startLocal,
      durationMin: Number.isFinite(durationMin) ? durationMin : 60,
    });
  } catch (e) {
    errMsg = (e as Error).message;
  }
  if (errMsg) {
    redirect(`/admin/live?tab=sessions&error=${encodeURIComponent(errMsg)}`);
  }
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
  redirect("/admin/live?tab=sessions&edited=1");
}

// Move a session's recording folder under a parent (works for past sessions —
// used to group existing recordings, e.g. under "Accounting").
async function moveFolderAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const folderParent = String(formData.get("folderParent") || "").trim() || null;
  let errMsg: string | null = null;
  try {
    await moveSessionFolder(id, folderParent);
  } catch (e) {
    errMsg = (e as Error).message;
  }
  revalidatePath("/admin/live");
  redirect(
    errMsg
      ? `/admin/live?tab=sessions&error=${encodeURIComponent(errMsg)}`
      : "/admin/live?tab=sessions&edited=1"
  );
}

async function cancelSession(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  await cancelLiveSession(id);
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
}

async function markCompleted(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  // Prefer the real signal (attendance report); fall back to trusting the
  // admin — they're telling us the meeting is over.
  const confirmed = await confirmSessionEnded(id).catch(() => false);
  if (!confirmed) {
    await prisma.liveSession
      .update({ where: { id }, data: { status: "ENDED" } })
      .catch(() => {});
  }
  // Kick an ingest attempt right away (no-op "pending" if the recording
  // hasn't finished processing yet — the cron keeps retrying).
  await ingestRecording(id).catch(() => {});
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
  redirect("/admin/live?tab=sessions");
}

async function pullRecording(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const result = await ingestRecording(id);
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
  const q =
    result.status === "ingested"
      ? "pulled=1"
      : `pullinfo=${encodeURIComponent(result.message ?? result.status)}`;
  redirect(`/admin/live?${q}`);
}

// Record a session that happened WITHOUT being scheduled in the LMS, and pull
// its recording in from a link. Deliberately creates NO Teams meeting and sends
// NO invite (graphEventId/joinUrl stay null) — the meeting is already over; this
// only files the recording, allots it, and lets a quiz be added after.
async function addPastSession(formData: FormData) {
  "use server";
  const session = await requireAdmin();
  const title = String(formData.get("title") || "").trim();
  const courseTitle = String(formData.get("courseTitle") || "").trim();
  const folderParent = String(formData.get("folderParent") || "").trim() || null;
  const heldOn = String(formData.get("heldOn") || "");
  const durationMin = Number(formData.get("durationMin") || 60);
  const url = String(formData.get("url") || "").trim();
  const attendeeIds = formData.getAll("attendeeIds").map(String).filter(Boolean);

  const back = (msg: string) =>
    redirect(`/admin/live?pullinfo=${encodeURIComponent(msg)}`);

  if (!title || !courseTitle || !heldOn || !url) {
    back("Title, folder, date and recording link are all required.");
  }

  const driveId = process.env.GRAPH_DRIVE_ID;
  const rootPath = process.env.GRAPH_VIDEOS_FOLDER_PATH;
  if (!driveId || !rootPath) back("Drive not configured.");

  let created: { id: string } | null = null;
  try {
    const token =
      (await getAppOnlyToken()) ?? (await getUserGraphToken(session.user.id));
    if (!token) throw new Error("No Microsoft Graph token available.");

    // Same folder layout as a scheduled session: L&D/{parent}/{course}.
    if (folderParent) await ensureFolder(driveId!, rootPath!, folderParent, token);
    const parentPath = folderParent ? `${rootPath}/${folderParent}` : rootPath!;
    const targetFolderId = await ensureFolder(driveId!, parentPath, courseTitle, token);

    // Time is cosmetic here (the session is over) — anchor it at 10:00 IST on
    // the date given so the card sorts and displays sensibly.
    const startAt = istLocalToUtc(`${heldOn}T10:00`);
    if (Number.isNaN(startAt.getTime())) throw new Error("Invalid date.");
    const endAt = new Date(startAt.getTime() + durationMin * 60_000);

    created = await prisma.liveSession.create({
      data: {
        title,
        courseTitle,
        folderParent,
        scheduledById: session.user.id,
        startAt,
        endAt,
        attendeeIds,
        targetFolderId,
        status: "ENDED",
      },
      select: { id: true },
    });
  } catch (e) {
    back((e as Error).message || "Could not create the session.");
  }

  // Copy the recording in and run the normal pipeline (video + allotment).
  const result = await ingestFromRecapLink(created!.id, url);
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
  back(
    result.status === "ingested"
      ? "Session added and recording published."
      : result.message ?? result.status
  );
}

// Ingest a recording from a pasted Teams recap/share link — for when the
// recorder isn't the organizer, so the automatic /Recordings scan misses it.
async function ingestFromLinkAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const url = String(formData.get("url") ?? "").trim();
  const result = await ingestFromRecapLink(id, url);
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
  const q =
    result.status === "ingested"
      ? "pulled=1"
      : `pullinfo=${encodeURIComponent(result.message ?? result.status)}`;
  redirect(`/admin/live?${q}`);
}

// Re-pull: drop the ingested recording and grab the largest one instead — for
// when a false-start left a short clip as the published video.
async function repullRecordingAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const result = await repullRecording(id);
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
  const q =
    result.status === "ingested"
      ? "pulled=1"
      : `pullinfo=${encodeURIComponent(result.message ?? result.status)}`;
  redirect(`/admin/live?${q}`);
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  SCHEDULED: { label: "Scheduled", cls: "bg-brand-50 text-brand-700 border-brand-200" },
  LIVE: { label: "● Live now", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  WRAPPING: { label: "In progress", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  ENDED: { label: "Completed", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  RECORDING_READY: { label: "Recording ready", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  INGESTED: { label: "Published", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Cancelled", cls: "bg-muted text-ink-faint border-border line-through" },
};

// Meetings often run past their scheduled slot, and Graph has no cheap
// "is it still running" flag — the real end signal in our pipeline is the
// recording turning up (RECORDING_READY / INGESTED, set by the ingest).
// So: within the slot ⇒ Live; past the slot but unconfirmed ⇒ In progress;
// only call it Completed once the recording is found or after a 4h cap
// (covers meetings that were never recorded).
const OVERRUN_GRACE_MS = 4 * 60 * 60 * 1000;

function displayStatus(s: { status: string; startAt: Date; endAt: Date }): string {
  // ENDED is now set deliberately (attendance-report check, admin click, or
  // the 4h cap) — trust it. Only SCHEDULED/LIVE are derived from the clock.
  if (s.status !== "SCHEDULED" && s.status !== "LIVE") return s.status;
  const now = Date.now();
  if (now < s.startAt.getTime()) return "SCHEDULED";
  if (now <= s.endAt.getTime()) return "LIVE";
  if (now <= s.endAt.getTime() + OVERRUN_GRACE_MS) return "WRAPPING";
  return "ENDED";
}

export default async function AdminLivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const scheduled = sp.scheduled === "1";
  const edited = sp.edited === "1";
  const error = sp.error;
  const pulled = sp.pulled === "1";
  const pullinfo = sp.pullinfo;
  const tab = sp.tab === "sessions" ? "sessions" : "schedule";

  const [users, nameRows, allSessions, linkedAccounts, session] =
    await Promise.all([
      prisma.user.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true },
      }),
      prisma.user.findMany({ select: { id: true, name: true, email: true } }),
      prisma.liveSession.findMany({
        orderBy: { startAt: "desc" },
        include: {
          attendances: {
            orderBy: { secondsAttended: "desc" },
            include: { user: { select: { name: true, email: true } } },
          },
        },
      }),
      // Only people who connected Microsoft 365 at /connect hold a refresh token
      // we can act with on their calendar — they're the only valid organizers.
      prisma.account.findMany({
        where: { provider: "microsoft-entra-id", refresh_token: { not: null } },
        select: { userId: true },
      }),
      auth(),
    ]);

  const canOrganize = new Set(linkedAccounts.map((a) => a.userId));
  const organizers = users.filter((u) => canOrganize.has(u.id));
  const currentUserId = session?.user?.id ?? "";

  // Existing course folders under the L&D root, offered as dropdown choices.
  // Best-effort: an empty list just means the form falls back to free text.
  let existingFolders: string[] = [];
  const driveId = process.env.GRAPH_DRIVE_ID;
  const rootPath = process.env.GRAPH_VIDEOS_FOLDER_PATH;
  if (driveId && rootPath) {
    const token =
      (await getAppOnlyToken().catch(() => null)) ??
      (currentUserId ? await getUserGraphToken(currentUserId).catch(() => null) : null);
    if (token) {
      existingFolders = await listSubfolderNames(driveId, rootPath, token);
    }
  }

  const nameById = new Map(nameRows.map((u) => [u.id, u.name ?? u.email]));
  const now = Date.now();

  // Optional date-range filter (IST day bounds) on the Sessions tab.
  const fromDate = sp.from ? new Date(`${sp.from}T00:00:00+05:30`) : null;
  const toDate = sp.to ? new Date(`${sp.to}T23:59:59+05:30`) : null;
  const sessions = allSessions.filter(
    (s) =>
      (!fromDate || s.startAt >= fromDate) && (!toDate || s.startAt <= toDate)
  );

  const isOpen = (s: (typeof sessions)[number]) =>
    ["SCHEDULED", "LIVE", "WRAPPING"].includes(displayStatus(s));
  const upcoming = sessions.filter(isOpen);
  const past = sessions.filter((s) => !isOpen(s));

  const defaultStart = istLocalInputValue(new Date(now + 60 * 60 * 1000));

  return (
    <main className="px-6 py-8 max-w-5xl">
      <AutoIngest />
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1.5">
          Admin · Live sessions
        </p>
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">
          Live sessions
        </h1>
        <p className="text-ink-mute mt-1 text-sm">
          Schedule a Teams meeting from here. Attendees get the invite by email,
          and the recording lands in a folder named after the course.
        </p>
      </div>

      {scheduled && (
        <div className="mb-6 rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-emerald-700">Session scheduled</p>
            <p className="text-sm text-emerald-700/80 mt-0.5">
              The Teams invite has gone out to the attendees, and the recording
              folder is ready under L&amp;D.
            </p>
          </div>
        </div>
      )}
      {edited && (
        <div className="mb-6 rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-emerald-700">
            Session updated — the Teams invite has been updated for attendees.
          </p>
        </div>
      )}
      {error && (
        <div className="mb-6 rounded-xl bg-rose-50 border border-rose-200 p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-rose-700">Couldn&apos;t schedule the session</p>
            <p className="text-sm text-rose-700/80 mt-0.5 break-words">{error}</p>
          </div>
        </div>
      )}
      {pulled && (
        <div className="mb-6 rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-emerald-700">
            Recording pulled in — it&apos;s now a lesson, and its quiz is generating
            in the background.
          </p>
        </div>
      )}
      {pullinfo && (
        <div className="mb-6 rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm font-semibold text-amber-700 break-words">
            {pullinfo}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="inline-flex items-center gap-1 bg-card p-1 rounded-full border border-border mb-6">
        <Link
          href="/admin/live"
          className={`px-4 py-2 rounded-full text-[13px] font-bold transition ${
            tab === "schedule" ? "bg-brand-500 text-white" : "text-ink-mute hover:text-ink"
          }`}
        >
          Schedule
        </Link>
        <Link
          href="/admin/live?tab=sessions"
          className={`px-4 py-2 rounded-full text-[13px] font-bold transition ${
            tab === "sessions" ? "bg-brand-500 text-white" : "text-ink-mute hover:text-ink"
          }`}
        >
          All sessions ({allSessions.length})
        </Link>
      </div>

      {tab === "schedule" && (
      <>
      <section className="rounded-2xl bg-white border border-border shadow-soft p-5 sm:p-6 mb-8">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold">Schedule a session</h2>
            <p className="text-xs text-ink-mute mt-0.5">
              Creates a Teams meeting on the organizer&apos;s calendar and invites the people you pick.
            </p>
          </div>
        </div>

        <ScheduleLiveForm
          users={users}
          organizers={organizers}
          currentUserId={currentUserId}
          existingFolders={existingFolders}
          action={scheduleSession}
          defaultStart={defaultStart}
        />

        <div className="mt-5 rounded-xl bg-muted/50 border border-border p-3 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-ink-faint shrink-0 mt-0.5" />
          <p className="text-xs text-ink-mute leading-relaxed">
            One-time setup: an organizer opens <code className="text-[11px] bg-white px-1 py-0.5 rounded border border-border">/connect</code> and
            grants these delegated Graph permissions (your Entra admin must have
            allowed them on the app registration) —{" "}
            <code className="text-[11px] bg-white px-1 py-0.5 rounded border border-border">
              Calendars.ReadWrite · Files.ReadWrite.All · OnlineMeetings.ReadWrite ·
              OnlineMeetingTranscript.Read.All · OnlineMeetingArtifact.Read.All
            </code>
            . The last three power auto-record, transcript quizzes, and
            meeting-ended detection.
          </p>
        </div>
      </section>

      <section className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 grid place-items-center shrink-0">
            <Download className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold">Add a past session</h2>
            <p className="text-xs text-ink-mute mt-0.5">
              For a session held without scheduling it here. Files the recording from
              its link and allots it — no Teams meeting is created and no invite is sent.
            </p>
          </div>
        </div>

        <AddPastSessionForm
          users={users}
          existingFolders={existingFolders}
          action={addPastSession}
          defaultDate={istDate(new Date())}
        />
      </section>
      </>
      )}

      {tab === "sessions" && (
      <>
      <datalist id="ld-folders">
        {existingFolders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {/* Date filter */}
      <form
        method="GET"
        className="rounded-2xl bg-white border border-border shadow-soft p-4 mb-6 flex flex-wrap items-end gap-3 text-sm"
      >
        <input type="hidden" name="tab" value="sessions" />
        <label>
          <span className="block text-xs text-ink-mute mb-1 font-semibold">From</span>
          <input
            type="date"
            name="from"
            defaultValue={sp.from ?? ""}
            className="bg-white border border-border rounded-lg px-3 py-2"
          />
        </label>
        <label>
          <span className="block text-xs text-ink-mute mb-1 font-semibold">To</span>
          <input
            type="date"
            name="to"
            defaultValue={sp.to ?? ""}
            className="bg-white border border-border rounded-lg px-3 py-2"
          />
        </label>
        <button className="px-4 py-2 rounded-lg bg-ink hover:bg-ink-soft text-white font-semibold transition">
          Filter
        </button>
        {(sp.from || sp.to) && (
          <Link
            href="/admin/live?tab=sessions"
            className="px-3 py-2 rounded-lg text-ink-mute hover:text-ink hover:bg-muted transition"
          >
            Clear
          </Link>
        )}
        <span className="ml-auto text-xs text-ink-faint">
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
          {(sp.from || sp.to) ? " in range" : ""}
        </span>
      </form>

      {/* Upcoming */}
      <h2 className="font-display text-sm uppercase tracking-wider font-semibold text-ink-faint mb-3">
        Live &amp; upcoming ({upcoming.length})
      </h2>
      {upcoming.length === 0 ? (
        <div className="rounded-2xl bg-white border border-dashed border-border p-10 text-center shadow-soft mb-8">
          <CalendarClock className="w-10 h-10 text-ink-faint mx-auto mb-2" />
          <p className="text-ink-mute text-sm">No upcoming sessions yet.</p>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {upcoming.map((s) => {
            const attendeeCount = Array.isArray(s.attendeeIds)
              ? (s.attendeeIds as string[]).length
              : 0;
            const eff = displayStatus(s);
            const meta = STATUS_META[eff] ?? STATUS_META.SCHEDULED;
            const durationMin = Math.max(
              1,
              Math.round((s.endAt.getTime() - s.startAt.getTime()) / 60000)
            );
            return (
              <div
                key={s.id}
                className="rounded-2xl bg-white border border-border shadow-soft p-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                  <Video className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display font-bold truncate">{s.title}</h3>
                    <span
                      className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full border ${meta.cls}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                  <p className="text-xs text-ink-mute mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="w-3.5 h-3.5" />
                      {formatIst(s.startAt)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UsersIcon className="w-3.5 h-3.5" />
                      {attendeeCount} invited
                    </span>
                    <span className="text-ink-faint">
                      📁 L&amp;D {s.folderParent ? `/ ${s.folderParent} ` : ""}/ {s.courseTitle}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {s.joinUrl && (
                    <JoinMeetingButton
                      joinUrl={s.joinUrl}
                      className="text-sm px-3.5 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-semibold inline-flex items-center gap-1.5 transition"
                    >
                      Join
                      <ExternalLink className="w-3.5 h-3.5" />
                    </JoinMeetingButton>
                  )}
                  {eff === "WRAPPING" && (
                    <form action={markCompleted}>
                      <input type="hidden" name="id" value={s.id} />
                      <button
                        className="text-sm px-3 py-2 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 font-semibold inline-flex items-center gap-1.5 transition"
                        title="The meeting is over — mark it completed and start pulling the recording"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Mark completed
                      </button>
                    </form>
                  )}
                  <form action={cancelSession}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="text-sm px-3 py-2 rounded-lg text-ink-mute hover:text-rose-600 hover:bg-rose-50 font-medium transition">
                      Cancel
                    </button>
                  </form>
                </div>
                </div>

                {eff === "SCHEDULED" && (
                  <details className="mt-3 border-t border-border pt-3">
                    <summary className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:text-brand-700 list-none [&::-webkit-details-marker]:hidden">
                      <Pencil className="w-3.5 h-3.5" />
                      Edit time / folder
                    </summary>
                    <form
                      action={editSession}
                      className="mt-3 grid sm:grid-cols-2 gap-3 text-sm"
                    >
                      <input type="hidden" name="id" value={s.id} />
                      <label className="block">
                        <span className="block text-xs font-semibold text-ink-mute mb-1">Title</span>
                        <input
                          name="title"
                          required
                          defaultValue={s.title}
                          className="w-full bg-white border border-border rounded-lg px-3 py-2"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-xs font-semibold text-ink-mute mb-1">Course / folder</span>
                        <input
                          name="courseTitle"
                          list="ld-folders"
                          required
                          defaultValue={s.courseTitle}
                          className="w-full bg-white border border-border rounded-lg px-3 py-2"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-xs font-semibold text-ink-mute mb-1">
                          Parent folder <span className="text-ink-faint font-normal">(optional)</span>
                        </span>
                        <input
                          name="folderParent"
                          list="ld-folders"
                          defaultValue={s.folderParent ?? ""}
                          placeholder="e.g. Accounting"
                          className="w-full bg-white border border-border rounded-lg px-3 py-2"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-xs font-semibold text-ink-mute mb-1">Starts (IST)</span>
                        <input
                          type="datetime-local"
                          name="startLocal"
                          required
                          defaultValue={istLocalInputValue(s.startAt)}
                          className="w-full bg-white border border-border rounded-lg px-3 py-2"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-xs font-semibold text-ink-mute mb-1">Duration</span>
                        <select
                          name="durationMin"
                          defaultValue={String(durationMin)}
                          className="w-full bg-white border border-border rounded-lg px-3 py-2"
                        >
                          {[30, 45, 60, 90, 120].map((d) => (
                            <option key={d} value={d}>
                              {d} minutes
                            </option>
                          ))}
                          {![30, 45, 60, 90, 120].includes(durationMin) && (
                            <option value={durationMin}>{durationMin} minutes</option>
                          )}
                        </select>
                      </label>
                      <div className="sm:col-span-2">
                        <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm transition">
                          Save changes
                        </button>
                        <span className="text-xs text-ink-faint ml-3">
                          Attendees stay the same. Changing the folder only affects the recording location.
                        </span>
                      </div>
                    </form>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Past */}
      {past.length > 0 && (
        <>
          <h2 className="font-display text-sm uppercase tracking-wider font-semibold text-ink-faint mb-3">
            Past &amp; cancelled ({past.length})
          </h2>
          <div className="space-y-2">
            {past.map((s) => {
              const meta = STATUS_META[displayStatus(s)] ?? STATUS_META.ENDED;
              const attSorted = s.attendances ?? [];
              const attPts = attSorted.reduce((sum, a) => sum + a.points, 0);
              return (
                <div
                  key={s.id}
                  className="rounded-xl bg-white border border-border p-4 shadow-soft"
                >
                  <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-sm truncate">{s.title}</p>
                      <span
                        className={`text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full border ${meta.cls}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <p className="text-xs text-ink-faint mt-0.5">
                      {formatIst(s.startAt)} · by {nameById.get(s.scheduledById) ?? "—"} · 📁{" "}
                      {s.folderParent ? `${s.folderParent} / ` : ""}{s.courseTitle}
                    </p>
                  </div>
                  {s.recordedVideoId ? (
                    <div className="shrink-0 flex items-center gap-2">
                      <a
                        href={`/video/${s.recordedVideoId}`}
                        className="text-xs px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold inline-flex items-center gap-1.5 hover:bg-emerald-100 transition"
                      >
                        <PlayCircle className="w-3.5 h-3.5" />
                        Recording
                      </a>
                      <form action={repullRecordingAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button
                          className="text-xs px-3 py-1.5 rounded-lg bg-white border border-border hover:bg-muted text-ink-soft font-semibold inline-flex items-center gap-1.5 transition"
                          title="Wrong/short clip? Re-pull the largest recording (fixes false-start re-records)"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Re-pull
                        </button>
                      </form>
                    </div>
                  ) : s.status !== "CANCELLED" ? (
                    <div className="shrink-0 flex flex-col items-end gap-1.5">
                      <form action={pullRecording}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="text-xs px-3 py-1.5 rounded-lg bg-white border border-border hover:bg-muted text-ink-soft font-semibold inline-flex items-center gap-1.5 transition">
                          <Download className="w-3.5 h-3.5" />
                          Pull recording
                        </button>
                      </form>
                      <form action={ingestFromLinkAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="id" value={s.id} />
                        <input
                          name="url"
                          required
                          placeholder="Paste Teams recording link"
                          className="text-xs px-2 py-1.5 rounded-lg border border-border w-52 bg-white"
                        />
                        <button
                          className="text-xs px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-semibold inline-flex items-center gap-1.5 transition whitespace-nowrap"
                          title="Ingest a recording from its Teams share link — use when the recorder isn't the organizer"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Ingest link
                        </button>
                      </form>
                    </div>
                  ) : null}
                  </div>

                  {attSorted.length > 0 && (
                    <details className="mt-3 border-t border-border pt-3">
                      <summary className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-bold text-ink-mute hover:text-ink list-none [&::-webkit-details-marker]:hidden">
                        <UsersIcon className="w-3.5 h-3.5" />
                        Attendance ({attSorted.length}) · {attPts} pts
                      </summary>
                      <div className="mt-2 divide-y divide-border">
                        {attSorted.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between py-1.5 text-xs"
                          >
                            <span className="text-ink truncate">
                              {a.user.name ?? a.user.email}
                            </span>
                            <span className="text-ink-mute shrink-0 tabular-nums">
                              {Math.round(a.secondsAttended / 60)} min ·{" "}
                              {a.attendedPct.toFixed(0)}% ·{" "}
                              <span
                                className={
                                  a.points > 0 ? "text-emerald-600 font-semibold" : "text-ink-faint"
                                }
                              >
                                {a.points} pts
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}

                  {s.status !== "CANCELLED" && (
                    <details className="mt-3 border-t border-border pt-3">
                      <summary className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-bold text-ink-mute hover:text-ink list-none [&::-webkit-details-marker]:hidden">
                        <FolderInput className="w-3.5 h-3.5" />
                        Move to folder
                      </summary>
                      <form
                        action={moveFolderAction}
                        className="mt-2 flex flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="id" value={s.id} />
                        <label className="block">
                          <span className="block text-xs font-semibold text-ink-mute mb-1">
                            Parent folder (blank = L&amp;D root)
                          </span>
                          <input
                            name="folderParent"
                            list="ld-folders"
                            defaultValue={s.folderParent ?? ""}
                            placeholder="e.g. Accounting"
                            className="bg-white border border-border rounded-lg px-3 py-1.5 text-sm"
                          />
                        </label>
                        <button className="px-3 py-1.5 rounded-lg bg-ink hover:bg-ink-soft text-white text-sm font-semibold transition">
                          Move
                        </button>
                        <span className="text-xs text-ink-faint">
                          Moves the SharePoint folder (recordings come along).
                        </span>
                      </form>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      </>
      )}
    </main>
  );
}
