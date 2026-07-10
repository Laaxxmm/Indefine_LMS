import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
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
import { scheduleLiveSession, cancelLiveSession, ingestRecording } from "@/lib/live";
import { istLocalInputValue, formatIst } from "@/lib/live-format";
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
      session.user.id
    );
  } catch (e) {
    errMsg = (e as Error).message;
  }

  if (errMsg) {
    redirect(`/admin/live?error=${encodeURIComponent(errMsg)}`);
  }
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
  redirect("/admin/live?scheduled=1");
}

async function cancelSession(formData: FormData) {
  "use server";
  const session = await requireAdmin();
  const id = String(formData.get("id"));
  await cancelLiveSession(id, session.user.id);
  revalidatePath("/admin/live");
  revalidatePath("/dashboard");
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
  LIVE: { label: "Live now", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  ENDED: { label: "Ended", cls: "bg-muted text-ink-mute border-border" },
  RECORDING_READY: { label: "Recording ready", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  INGESTED: { label: "Published", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  CANCELLED: { label: "Cancelled", cls: "bg-muted text-ink-faint border-border line-through" },
};

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

  const [users, nameRows, sessions] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
    prisma.liveSession.findMany({ orderBy: { startAt: "desc" } }),
  ]);

  const nameById = new Map(nameRows.map((u) => [u.id, u.name ?? u.email]));
  const now = Date.now();
  const upcoming = sessions.filter(
    (s) => s.status !== "CANCELLED" && s.endAt.getTime() >= now
  );
  const past = sessions.filter(
    (s) => s.status === "CANCELLED" || s.endAt.getTime() < now
  );

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

      {/* Schedule form */}
      <section className="rounded-2xl bg-white border border-border shadow-soft p-5 sm:p-6 mb-8">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <Radio className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold">Schedule a session</h2>
            <p className="text-xs text-ink-mute mt-0.5">
              Creates a Teams meeting on your calendar and invites the people you pick.
            </p>
          </div>
        </div>

        <ScheduleLiveForm
          users={users}
          action={scheduleSession}
          defaultStart={defaultStart}
        />

        <div className="mt-5 rounded-xl bg-muted/50 border border-border p-3 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-ink-faint shrink-0 mt-0.5" />
          <p className="text-xs text-ink-mute leading-relaxed">
            One-time setup: your Entra admin must grant{" "}
            <code className="text-[11px] bg-white px-1 py-0.5 rounded border border-border">
              Calendars.ReadWrite
            </code>{" "}
            and{" "}
            <code className="text-[11px] bg-white px-1 py-0.5 rounded border border-border">
              Files.ReadWrite.All
            </code>{" "}
            on the app registration, then sign out and back in once so your
            session picks up the new permissions.
          </p>
        </div>
      </section>

      {/* Upcoming */}
      <h2 className="font-display text-sm uppercase tracking-wider font-semibold text-ink-faint mb-3">
        Upcoming ({upcoming.length})
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
            const meta = STATUS_META[s.status] ?? STATUS_META.SCHEDULED;
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
                    <a
                      href={s.joinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm px-3.5 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-semibold inline-flex items-center gap-1.5 transition"
                    >
                      Join
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
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
              const meta = STATUS_META[s.status] ?? STATUS_META.ENDED;
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
    </main>
  );
}
