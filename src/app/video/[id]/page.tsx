import { auth, signOut } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { canAccessVideo } from "@/lib/assignments";
import VideoPlayer from "./VideoPlayer";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  GraduationCap,
  LogOut,
  PlayCircle,
} from "lucide-react";

export const dynamic = "force-dynamic";

function prettifyName(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDuration(s: number | null) {
  if (!s) return null;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default async function VideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const userId = session.user.id;
  const { id } = await params;

  // Employees can only open videos allotted to them — enforced the same way in
  // the stream + progress APIs via the shared canAccessVideo helper.
  if (!(await canAccessVideo(userId, id, session.user.role === "ADMIN"))) {
    redirect("/dashboard");
  }

  const video = await prisma.video.findUnique({
    where: { id },
    include: {
      module: {
        include: {
          course: true,
          videos: {
            orderBy: { order: "asc" },
            include: {
              progresses: { where: { userId } },
              quiz: { include: { attempts: { where: { userId } } } },
            },
          },
        },
      },
      quiz: {
        include: {
          attempts: {
            where: { userId },
            orderBy: { submittedAt: "desc" },
          },
        },
      },
      progresses: { where: { userId } },
    },
  });
  if (!video) notFound();

  const progress = video.progresses[0];
  const unlockAt = video.quiz?.unlockAtPercent ?? 90;
  const watchedPct = progress?.percent ?? 0;
  const quizUnlocked = watchedPct >= unlockAt;
  const bestAttempt =
    video.quiz?.attempts.find((a) => a.passed) ?? video.quiz?.attempts[0];

  const moduleVideos = video.module.videos;
  const moduleDone = moduleVideos.filter(
    (v) => v.progresses[0]?.completed
  ).length;
  const modulePct =
    moduleVideos.length > 0 ? (moduleDone / moduleVideos.length) * 100 : 0;

  return (
    <main className="min-h-screen px-4 sm:px-6 py-5 max-w-[1240px] mx-auto">
      <header className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-card border border-border font-bold text-[13.5px] text-ink hover:bg-muted transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <div className="flex items-center gap-2.5">
          <span
            className="w-[34px] h-[34px] rounded-full grid place-items-center text-white font-extrabold text-sm"
            style={{ background: "linear-gradient(135deg,#6D5BF0,#4B37D8)" }}
          >
            {(session.user.name ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="font-bold text-sm hidden sm:inline">{session.user.name}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="ml-1 text-xs px-3 py-2 rounded-xl bg-card border border-border font-semibold text-ink-soft hover:bg-muted inline-flex items-center gap-1.5 transition">
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_340px] gap-6">
        {/* Main column — big player + quiz */}
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.1em] font-extrabold text-accent-coral mb-1">
            {video.module.course.title} · {video.module.title}
          </p>
          <h1 className="font-display text-2xl sm:text-[32px] font-extrabold tracking-[-0.02em] mb-4 leading-tight">
            {prettifyName(video.title)}
          </h1>

          <VideoPlayer
            videoId={video.id}
            initialPosition={progress?.lastPosition ?? 0}
            initialPercent={progress?.percent ?? 0}
            unlockAtPercent={unlockAt}
          />

          {video.quiz && (
            <section className="mt-4 rounded-[18px] bg-card border border-border p-5">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                    <GraduationCap className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold">
                      {video.quiz.title}
                    </h2>
                    <p className="text-xs text-ink-mute mt-1 flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {Math.round(video.quiz.timeLimitSec / 60)} min
                      </span>
                      <span className="text-ink-faint">·</span>
                      <span>Pass {video.quiz.passPercent}%</span>
                      {video.quiz.maxAttempts && (
                        <>
                          <span className="text-ink-faint">·</span>
                          <span>Max {video.quiz.maxAttempts} attempts</span>
                        </>
                      )}
                    </p>
                    {bestAttempt && (
                      <p className="text-sm mt-2">
                        Best score:{" "}
                        <span
                          className={
                            bestAttempt.passed
                              ? "text-emerald-600 font-bold"
                              : "text-amber-600 font-bold"
                          }
                        >
                          {bestAttempt.percent.toFixed(0)}%
                          {bestAttempt.passed && " ✓"}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
                {quizUnlocked ? (
                  <Link
                    href={`/quiz/${video.quiz.id}`}
                    className="px-6 py-3 rounded-[13px] bg-brand-500 hover:bg-brand-600 text-white font-bold transition"
                  >
                    {bestAttempt ? "Retake quiz" : "Start quiz"}
                  </Link>
                ) : (
                  <div className="text-xs text-ink-mute px-3 py-2 rounded-lg bg-muted border border-border">
                    Watch {unlockAt}% to unlock
                  </div>
                )}
              </div>

              {video.quiz.attempts.length > 0 && (
                <div className="mt-5 pt-5 border-t border-border">
                  <p className="text-sm font-semibold mb-2">
                    Attempt history ({video.quiz.attempts.length})
                  </p>
                  <div className="space-y-1.5">
                    {video.quiz.attempts.map((a, i) => {
                      const row = (
                        <>
                          <span className="text-ink-mute">
                            #{video.quiz!.attempts.length - i} ·{" "}
                            {a.submittedAt
                              ? a.submittedAt.toLocaleString()
                              : "in progress"}
                          </span>
                          <span className="flex items-center gap-2">
                            <span
                              className={
                                a.passed
                                  ? "text-emerald-600 font-semibold"
                                  : a.submittedAt
                                    ? "text-amber-600 font-semibold"
                                    : "text-ink-faint"
                              }
                            >
                              {a.submittedAt ? `${a.percent.toFixed(0)}%` : "—"}
                              {a.submittedAt && (a.passed ? " · passed" : " · failed")}
                            </span>
                            {a.submittedAt && (
                              <span className="inline-flex items-center gap-0.5 text-brand-600 font-semibold">
                                Review
                                <ArrowRight className="w-3 h-3" />
                              </span>
                            )}
                          </span>
                        </>
                      );
                      return a.submittedAt ? (
                        <Link
                          key={a.id}
                          href={`/quiz/${video.quiz!.id}/result?attempt=${a.id}`}
                          className="text-xs flex items-center justify-between bg-muted hover:bg-border/60 rounded-lg px-3 py-2 transition"
                        >
                          {row}
                        </Link>
                      ) : (
                        <div
                          key={a.id}
                          className="text-xs flex items-center justify-between bg-muted rounded-lg px-3 py-2"
                        >
                          {row}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Sidebar — module video list */}
        <aside className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto rounded-[20px] bg-card border border-border">
          <div className="px-4 py-3.5 border-b border-border sticky top-0 bg-card/95 backdrop-blur z-10">
            <p className="text-[10px] uppercase tracking-[0.1em] font-extrabold text-ink-faint">
              {video.module.title}
            </p>
            <p className="font-display text-lg font-extrabold mt-0.5">
              {moduleDone} / {moduleVideos.length} videos completed
            </p>
            <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 transition-all"
                style={{ width: `${modulePct}%` }}
              />
            </div>
            <p className="text-[10px] text-ink-mute mt-1 text-right font-medium">
              {Math.round(modulePct)}% module progress
            </p>
          </div>
          <div className="divide-y divide-border">
            {video.module.videos.map((v, i) => {
              const p = v.progresses[0];
              const pct = Math.round(p?.percent ?? 0);
              const isActive = v.id === video.id;
              const passed = v.quiz?.attempts.some((a) => a.passed);
              return (
                <Link
                  key={v.id}
                  href={`/video/${v.id}`}
                  className={`block px-4 py-3 transition ${
                    isActive
                      ? "bg-brand-50 border-l-[3px] border-brand-500"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 ${
                        p?.completed
                          ? "bg-emerald-100 text-emerald-700"
                          : isActive
                            ? "bg-brand-100 text-brand-600"
                            : "bg-muted text-ink-mute"
                      }`}
                    >
                      {p?.completed ? "✓" : i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug line-clamp-2 font-medium">
                        {prettifyName(v.title)}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-ink-mute">
                        {formatDuration(v.durationSeconds) && (
                          <span>{formatDuration(v.durationSeconds)}</span>
                        )}
                        {v.quiz && (
                          <>
                            <span>·</span>
                            <span
                              className={
                                passed ? "text-emerald-600 font-semibold" : "text-ink-mute"
                              }
                            >
                              Quiz
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-2 h-0.5 bg-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-500"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </aside>
      </div>
    </main>
  );
}
