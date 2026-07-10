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
} from "lucide-react";
import {
  scheduleLiveSession,
  cancelLiveSession,
  ingestRecording,
  confirmSessionEnded,
} from "@/lib/live";
import { istLocalInputValue, formatIst } from "@/lib/live-format";
import { JoinMeetingButton } from "@/components/JoinMeetingButton";
import ScheduleLiveForm from "./ScheduleLiveForm";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  return session;
}

async function scheduleSession(formData: FormData) {
  "use server";
  const session = await requireAdmin();
  const title = String(formData.get("title") || "").trim();
  const courseTitle = String(formData.get("courseTitle") || "").trim();
  const description = String(formData.get("description") || "").trim() || null;
  const startLocal = String(formData.get("startLocal") || "");
  const durationMin = Number(formData.get("durationMin") || 60);
  const attendeeUserIds = formData
    .getAll("attendeeIds")
    .map(String)
    .filter(Boolean);

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
    await scheduleLiveSession(
      {
        title,
        courseTitle,
        description,
        startLocal,
        durationMin: Number.isFinite(durationMin) ? durationMin : 60,
        attendeeUserIds,
      },
      organizerId
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
      prisma.liveSession.findMany({ orderBy: { startAt: "desc" } }),
      // Only people who've signed in to the LMS have a Microsoft token we can
      // act as — they're the only valid meeting organizers.
      prisma.account.findMany({
        where: { provider: "microsoft-entra-id" },
        select: { userId: true },
      }),
      auth(),
    ]);

  const canOrganize = new Set(linkedAccounts.map((a) => a.userId));
  const organizers = users.filter((u) => canOrganize.has(u.id));
  const currentUserId = session?.user?.id ?? "";

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
          action={scheduleSession}
          defaultStart={defaultStart}
        />

        <div className="mt-5 rounded-xl bg-muted/50 border border-border p-3 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-ink-faint shrink-0 mt-0.5" />
          <p className="text-xs text-ink-mute leading-relaxed">
            One-time setup: your Entra admin must grant these delegated Graph
            permissions on the app registration, then you sign out and back in
            once —{" "}
            <code className="text-[11px] bg-white px-1 py-0.5 rounded border border-border">
              Calendars.ReadWrite · Files.ReadWrite.All · OnlineMeetings.ReadWrite ·
              OnlineMeetingTranscript.Read.All · OnlineMeetingArtifact.Read.All
            </code>
            . The last three power auto-record, transcript quizzes, and
            meeting-ended detection.
          </p>
        </div>
      </section>
      )}

      {tab === "sessions" && (
      <>
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
            return (
              <div
                key={s.id}
                className="rounded-2xl bg-white border border-border shadow-soft p-5 flex flex-col sm:flex-row sm:items-center gap-4"
              >
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
                    <span className="text-ink-faint">📁 L&amp;D / {s.courseTitle}</span>
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
              return (
                <div
                  key={s.id}
                  className="rounded-xl bg-white border border-border p-4 flex items-center gap-3 shadow-soft"
                >
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
                      {formatIst(s.startAt)} · by {nameById.get(s.scheduledById) ?? "—"} · 📁 {s.courseTitle}
                    </p>
                  </div>
                  {s.recordedVideoId ? (
                    <a
                      href={`/video/${s.recordedVideoId}`}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold inline-flex items-center gap-1.5 hover:bg-emerald-100 transition"
                    >
                      <PlayCircle className="w-3.5 h-3.5" />
                      Recording
                    </a>
                  ) : s.status !== "CANCELLED" ? (
                    <form action={pullRecording} className="shrink-0">
                      <input type="hidden" name="id" value={s.id} />
                      <button className="text-xs px-3 py-1.5 rounded-lg bg-white border border-border hover:bg-muted text-ink-soft font-semibold inline-flex items-center gap-1.5 transition">
                        <Download className="w-3.5 h-3.5" />
                        Pull recording
                      </button>
                    </form>
                  ) : null}
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
