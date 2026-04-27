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
    <main className="min-h-screen px-6 py-8 max-w-3xl mx-auto">
      <Link
        href={`/video/${quiz.videoId}`}
        className="text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 mb-4"
      >
        ← {quiz.video.title}
      </Link>
      <h1 className="font-display text-3xl font-extrabold mt-2">{quiz.title}</h1>
      <p className="text-ink-mute text-sm mt-1 mb-6">
        {quiz.timeLimitSec / 60} min · Pass {quiz.passPercent}%
        {quiz.maxAttempts &&
          ` · ${quiz.attempts.length} / ${quiz.maxAttempts} attempts used`}
      </p>

      {best && (
        <div className="mb-6 rounded-2xl bg-white border border-border shadow-soft p-4 text-sm">
          Best so far:{" "}
          <span
            className={
              best.passed
                ? "text-emerald-600 font-bold"
                : "text-amber-600 font-bold"
            }
          >
            {best.percent.toFixed(0)}% ({best.passed ? "passed" : "not passed"})
          </span>
        </div>
      )}

      {gate.ok ? (
        <QuizPlayer quizId={id} />
      ) : (
        <div className="rounded-2xl bg-white border border-border shadow-soft p-6 text-ink-soft">
          {gate.reason}
        </div>
      )}
    </main>
  );
}
