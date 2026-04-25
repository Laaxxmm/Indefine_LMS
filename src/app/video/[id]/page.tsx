import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import VideoPlayer from "./VideoPlayer";

export const dynamic = "force-dynamic";

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
      module: { include: { course: true } },
      quiz: { include: { attempts: { where: { userId }, orderBy: { submittedAt: "desc" } } } },
      progresses: { where: { userId } },
    },
  });
  if (!video) notFound();

  const progress = video.progresses[0];
  const unlockAt = video.quiz?.unlockAtPercent ?? 90;
  const quizUnlocked = (progress?.percent ?? 0) >= unlockAt;
  const bestAttempt = video.quiz?.attempts.find((a) => a.passed) ?? video.quiz?.attempts[0];

  return (
    <main className="min-h-screen px-6 py-10 max-w-5xl mx-auto">
      <Link href="/dashboard" className="text-sm text-white/60 hover:text-white">
        ← Dashboard
      </Link>
      <h1 className="text-2xl font-bold mt-4">{video.title}</h1>
      <p className="text-white/60 text-sm mb-6">
        {video.module.course.title} • {video.module.title}
      </p>

      <VideoPlayer
        videoId={video.id}
        initialPosition={progress?.lastPosition ?? 0}
        initialPercent={progress?.percent ?? 0}
      />

      {video.quiz && (
        <section className="mt-8 rounded-xl bg-white/5 border border-white/10 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{video.quiz.title}</h2>
              <p className="text-sm text-white/60 mt-1">
                {video.quiz.timeLimitSec / 60} min • Pass {video.quiz.passPercent}%
                {video.quiz.maxAttempts && ` • Max ${video.quiz.maxAttempts} attempts`}
              </p>
              {bestAttempt && (
                <p className="text-sm mt-2">
                  Best score:{" "}
                  <span className={bestAttempt.passed ? "text-green-300" : "text-yellow-300"}>
                    {bestAttempt.percent.toFixed(0)}%
                  </span>
                </p>
              )}
            </div>
            {quizUnlocked ? (
              <Link
                href={`/quiz/${video.quiz.id}`}
                className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600"
              >
                {bestAttempt ? "Retake quiz" : "Start quiz"}
              </Link>
            ) : (
              <span className="text-sm text-white/50">
                Unlocks at {unlockAt}% watched
              </span>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
