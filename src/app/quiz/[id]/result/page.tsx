import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import Celebration from "./Celebration";
import {
  Trophy,
  RotateCcw,
  ArrowLeft,
  Sparkles,
  PartyPopper,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function QuizResult({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { id } = await params;
  const sp = await searchParams;

  const quiz = await prisma.quiz.findUnique({
    where: { id },
    include: { video: true },
  });
  if (!quiz) redirect("/dashboard");

  const percent = Number(sp.percent ?? 0);
  const passed = sp.passed === "true";
  const score = Number(sp.score ?? 0);
  const max = Number(sp.max ?? 0);
  const auto = sp.auto === "1";

  return (
    <main className="min-h-screen px-6 py-12 max-w-2xl mx-auto flex flex-col justify-center">
      <Celebration passed={passed} />

      <div className="animate-slide-up">
        <div
          className={`rounded-3xl border p-10 text-center relative overflow-hidden shadow-pop ${
            passed
              ? "bg-gradient-to-br from-emerald-50 to-brand-50 border-emerald-200"
              : "bg-gradient-to-br from-amber-50 to-rose-50 border-amber-200"
          }`}
        >
          <div
            className={`absolute -top-20 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full blur-3xl pointer-events-none ${
              passed ? "bg-emerald-200/40" : "bg-amber-200/40"
            }`}
          />

          <div className="relative">
            <div
              className={`w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center ${
                passed ? "bg-emerald-100 text-emerald-600" : "bg-amber-100 text-amber-600"
              }`}
            >
              {passed ? (
                <Trophy className="w-10 h-10" />
              ) : (
                <Sparkles className="w-10 h-10" />
              )}
            </div>

            {passed && (
              <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-emerald-600 mb-2">
                <PartyPopper className="w-4 h-4" />
                Congratulations
              </p>
            )}

            <p className="text-xs text-ink-faint uppercase tracking-wider font-semibold mb-2">
              {auto ? "Time expired — auto-submitted" : "Quiz submitted"}
            </p>

            <h1 className="font-display text-7xl font-extrabold tracking-tight mb-3">
              <span className={passed ? "text-gradient" : "text-ink"}>
                {percent.toFixed(0)}%
              </span>
            </h1>

            <p
              className={`font-display text-xl font-bold mb-2 ${
                passed ? "text-emerald-600" : "text-amber-600"
              }`}
            >
              {passed ? "Quiz passed!" : "Almost there"}
            </p>
            <p className="text-ink-mute text-sm">
              {score} / {max} points · pass mark {quiz.passPercent}%
            </p>

            {passed ? (
              <p className="mt-6 text-sm text-ink-soft max-w-md mx-auto">
                Nice work — your score has been added to the leaderboard. Keep the
                streak going.
              </p>
            ) : (
              <p className="mt-6 text-sm text-ink-soft max-w-md mx-auto">
                You needed {quiz.passPercent}% to pass. Rewatch the video and give
                it another shot — you&apos;ve got this.
              </p>
            )}
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-center flex-wrap">
          <Link
            href={`/video/${quiz.videoId}`}
            className="px-4 py-2.5 rounded-lg bg-white hover:bg-muted border border-border text-sm font-medium inline-flex items-center gap-2 shadow-soft transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to video
          </Link>
          {!passed && (
            <Link
              href={`/quiz/${id}`}
              className="px-4 py-2.5 rounded-lg bg-white hover:bg-muted border border-border text-sm font-medium inline-flex items-center gap-2 shadow-soft transition"
            >
              <RotateCcw className="w-4 h-4" />
              Retake
            </Link>
          )}
          <Link
            href="/dashboard"
            className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-brand-500 to-accent-violet text-white text-sm font-semibold inline-flex items-center gap-2 shadow-pop hover:opacity-95 transition"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
