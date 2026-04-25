import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import VideoPlayer from "./VideoPlayer";

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

  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-[1600px] mx-auto">
      <Link
        href={`/dashboard?module=${video.moduleId}`}
        className="text-sm text-white/60 hover:text-white inline-block mb-4"
      >
        ← {video.module.title}
      </Link>

      <div className="grid lg:grid-cols-[1fr_340px] gap-6">
        {/* Main column — big player + quiz */}
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold mb-1">
            {prettifyName(video.title)}
          </h1>
          <p className="text-white/50 text-xs mb-4">
            {video.module.course.title} · {video.module.title}
          </p>

          <VideoPlayer
            videoId={video.id}
            initialPosition={progress?.lastPosition ?? 0}
            initialPercent={progress?.percent ?? 0}
          />

          {video.quiz && (
            <section className="mt-6 rounded-xl bg-white/5 border border-white/10 p-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{video.quiz.title}</h2>
                  <p className="text-sm text-white/60 mt-1">
                    {Math.round(video.quiz.timeLimitSec / 60)} min · pass{" "}
                    {video.quiz.passPercent}%
                    {video.quiz.maxAttempts &&
                      ` · max ${video.quiz.maxAttempts} attempts`}
                  </p>
                  {bestAttempt && (
                    <p className="text-sm mt-2">
                      Best score:{" "}
                      <span
                        className={
                          bestAttempt.passed ? "text-green-300" : "text-yellow-300"
                        }
                      >
                        {bestAttempt.percent.toFixed(0)}%
                      </span>
                    </p>
                  )}
                </div>
                {quizUnlocked ? (
                  <Link
                    href={`/quiz/${video.quiz.id}`}
                    className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 font-medium"
                  >
                    {bestAttempt ? "Retake quiz" : "Start quiz"}
                  </Link>
                ) : (
                  <span className="text-sm text-white/50">
                    Watch {unlockAt}% to unlock
                  </span>
                )}
              </div>

              {video.quiz.attempts.length > 0 && (
                <div className="mt-5 pt-5 border-t border-white/10">
                  <p className="text-sm font-medium mb-2">
                    Attempt history ({video.quiz.attempts.length})
                  </p>
                  <div className="space-y-1.5">
                    {video.quiz.attempts.map((a, i) => (
                      <div
                        key={a.id}
                        className="text-xs flex items-center justify-between bg-white/5 rounded px-3 py-2"
                      >
                        <span className="text-white/60">
                          #{video.quiz!.attempts.length - i} ·{" "}
                          {a.submittedAt
                            ? a.submittedAt.toLocaleString()
                            : "in progress"}
                        </span>
                        <span
                          className={
                            a.passed
                              ? "text-green-300"
                              : a.submittedAt
                                ? "text-yellow-300"
                                : "text-white/50"
                          }
                        >
                          {a.submittedAt ? `${a.percent.toFixed(0)}%` : "—"}
                          {a.submittedAt && (a.passed ? " · passed" : " · failed")}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Sidebar — module video list */}
        <aside className="lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto rounded-xl bg-white/5 border border-white/10">
          <div className="px-4 py-3 border-b border-white/10 sticky top-0 bg-[#0b1020]/90 backdrop-blur z-10">
            <p className="text-xs uppercase text-white/50 tracking-wide">
              {video.module.title}
            </p>
            <p className="text-sm font-medium mt-0.5">
              {video.module.videos.length} videos
            </p>
          </div>
          <div className="divide-y divide-white/5">
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
                      ? "bg-brand-500/15 border-l-2 border-brand-500"
                      : "hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-7 h-7 rounded text-xs font-semibold flex items-center justify-center shrink-0 ${
                        p?.completed
                          ? "bg-green-500/20 text-green-300"
                          : isActive
                            ? "bg-brand-500/30 text-brand-500"
                            : "bg-white/10 text-white/60"
                      }`}
                    >
                      {p?.completed ? "✓" : i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug line-clamp-2">
                        {prettifyName(v.title)}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 text-[11px] text-white/50">
                        {formatDuration(v.durationSeconds) && (
                          <span>{formatDuration(v.durationSeconds)}</span>
                        )}
                        {v.quiz && (
                          <>
                            <span>·</span>
                            <span
                              className={
                                passed ? "text-green-300" : "text-white/50"
                              }
                            >
                              Quiz
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-2 h-0.5 bg-white/10 rounded-full overflow-hidden">
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
