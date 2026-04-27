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
          className={`rounded-3xl border-2 p-10 text-center relative overflow-hidden ${
            passed
              ? "bg-gradient-to-br from-accent-mint/10 to-brand-500/10 border-accent-mint/40 shadow-glow"
              : "bg-gradient-to-br from-accent-gold/10 to-accent-rose/5 border-accent-gold/30"
          }`}
        >
          {/* Decorative glow */}
          <div
            className={`absolute -top-20 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full blur-3xl pointer-events-none ${
              passed ? "bg-accent-mint/30" : "bg-accent-gold/20"
            }`}
          />

          <div className="relative">
            <div
              className={`w-20 h-20 rounded-full mx-auto mb-5 flex items-center justify-center ${
                passed
                  ? "bg-accent-mint/20 text-accent-mint"
                  : "bg-accent-gold/20 text-accent-gold"
              }`}
            >
              {passed ? (
                <Trophy className="w-10 h-10" />
              ) : (
                <Sparkles className="w-10 h-10" />
              )}
            </div>

            {passed && (
              <p className="inline-flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-accent-mint mb-2">
                <PartyPopper className="w-4 h-4" />
                Congratulations
              </p>
            )}

            <p className="text-xs text-white/50 uppercase tracking-wide mb-2">
              {auto ? "Time expired — auto-submitted" : "Quiz submitted"}
            </p>

            <h1 className="text-7xl font-bold tracking-tight mb-3">
              <span
                className={passed ? "text-gradient" : "text-white"}
              >
                {percent.toFixed(0)}%
              </span>
            </h1>

            <p
              className={`text-xl font-semibold mb-2 ${
                passed ? "text-accent-mint" : "text-accent-gold"
              }`}
            >
              {passed ? "Quiz passed!" : "Almost there"}
            </p>
            <p className="text-white/60 text-sm">
              {score} / {max} points · pass mark {quiz.passPercent}%
            </p>

            {passed ? (
              <p className="mt-6 text-sm text-white/70 max-w-md mx-auto">
                Nice work — your score has been added to the leaderboard. Keep the streak going.
              </p>
            ) : (
              <p className="mt-6 text-sm text-white/70 max-w-md mx-auto">
                You needed {quiz.passPercent}% to pass. Rewatch the video and give
                it another shot — you&apos;ve got this.
              </p>
            )}
          </div>
        </div>

        <div className="mt-8 flex gap-3 justify-center flex-wrap">
          <Link
            href={`/video/${quiz.videoId}`}
            className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium inline-flex items-center gap-2 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to video
          </Link>
          {!passed && (
            <Link
              href={`/quiz/${id}`}
              className="px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium inline-flex items-center gap-2 transition"
            >
              <RotateCcw className="w-4 h-4" />
              Retake
            </Link>
          )}
          <Link
            href="/dashboard"
            className="px-4 py-2.5 rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 hover:from-brand-400 hover:to-brand-500 text-sm font-semibold inline-flex items-center gap-2 shadow-glow transition"
          >
            Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
