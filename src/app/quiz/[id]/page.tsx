import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { canStartAttempt } from "@/lib/quiz";
import QuizPlayer from "./QuizPlayer";

export const dynamic = "force-dynamic";

export default async function QuizPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { id } = await params;

  const quiz = await prisma.quiz.findUnique({
    where: { id },
    include: {
      video: true,
      attempts: {
        where: { userId: session.user.id, submittedAt: { not: null } },
        orderBy: { submittedAt: "desc" },
      },
    },
  });
  if (!quiz) notFound();

  const gate = await canStartAttempt(session.user.id, id);
  const best = quiz.attempts.reduce<typeof quiz.attempts[number] | null>(
    (acc, a) => (acc == null || a.percent > acc.percent ? a : acc),
    null
  );

  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <Link href={`/video/${quiz.videoId}`} className="text-sm text-white/60 hover:text-white">
        ← {quiz.video.title}
      </Link>
      <h1 className="text-2xl font-bold mt-4">{quiz.title}</h1>
      <p className="text-white/60 text-sm mt-1 mb-6">
        {quiz.timeLimitSec / 60} min • Pass {quiz.passPercent}%
        {quiz.maxAttempts && ` • ${quiz.attempts.length} / ${quiz.maxAttempts} attempts used`}
      </p>

      {best && (
        <div className="mb-6 rounded-lg bg-white/5 border border-white/10 p-4 text-sm">
          Best so far:{" "}
          <span className={best.passed ? "text-green-300" : "text-yellow-300"}>
            {best.percent.toFixed(0)}% ({best.passed ? "passed" : "not passed"})
          </span>
        </div>
      )}

      {gate.ok ? (
        <QuizPlayer quizId={id} />
      ) : (
        <div className="rounded-xl bg-white/5 border border-white/10 p-6 text-white/70">
          {gate.reason}
        </div>
      )}
    </main>
  );
}
