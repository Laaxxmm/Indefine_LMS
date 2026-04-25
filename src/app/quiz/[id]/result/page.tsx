import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";

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
    <main className="min-h-screen px-6 py-10 max-w-2xl mx-auto">
      <div
        className={`rounded-2xl border p-8 text-center ${
          passed
            ? "bg-green-500/10 border-green-500/30"
            : "bg-yellow-500/10 border-yellow-500/30"
        }`}
      >
        <p className="text-sm text-white/60 mb-2">
          {auto ? "Time expired — auto-submitted" : "Submitted"}
        </p>
        <h1 className="text-4xl font-bold mb-2">
          {percent.toFixed(0)}%
        </h1>
        <p className={`text-lg font-medium ${passed ? "text-green-300" : "text-yellow-300"}`}>
          {passed ? "Passed" : "Not passed"}
        </p>
        <p className="text-white/60 text-sm mt-1">
          {score} / {max} points • Pass mark {quiz.passPercent}%
        </p>
      </div>

      <div className="mt-8 flex gap-3 justify-center">
        <Link
          href={`/video/${quiz.videoId}`}
          className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15"
        >
          Back to video
        </Link>
        <Link
          href="/dashboard"
          className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600"
        >
          Dashboard
        </Link>
        {!passed && (
          <Link
            href={`/quiz/${id}`}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15"
          >
            Retake
          </Link>
        )}
      </div>
    </main>
  );
}
