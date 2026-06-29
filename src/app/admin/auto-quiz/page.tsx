import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Sparkles } from "lucide-react";
import { BulkQuizRunner } from "./BulkQuizRunner";

export const dynamic = "force-dynamic";

export default async function AutoQuizPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  // Videos that have no quiz, or a quiz with zero questions.
  const videos = await prisma.video.findMany({
    where: {
      OR: [{ quiz: { is: null } }, { quiz: { questions: { none: {} } } }],
    },
    select: {
      id: true,
      title: true,
      module: { select: { title: true, course: { select: { title: true } } } },
    },
    orderBy: [{ moduleId: "asc" }, { order: "asc" }],
  });

  const geminiConfigured = !!process.env.GEMINI_API_KEY;

  return (
    <main className="px-6 py-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-6 h-6 text-brand-500" />
        <h1 className="text-2xl font-bold">Auto-generate quizzes</h1>
      </div>
      <p className="text-ink-mute text-sm mb-8">
        Gemini watches each video, transcribes it, and builds a grounded 20-question medium quiz —
        no script needed. The transcript is saved to the video so you can review or regenerate later.
      </p>

      {!geminiConfigured ? (
        <div className="rounded-2xl bg-white border border-border shadow-soft p-6">
          <p className="text-sm text-ink-mute">
            Set <code className="px-1 rounded bg-muted text-xs">GEMINI_API_KEY</code> on the server to
            enable AI quiz generation.
          </p>
        </div>
      ) : (
        <BulkQuizRunner
          videos={videos.map((v) => ({
            id: v.id,
            title: v.title,
            moduleTitle: v.module?.course?.title
              ? `${v.module.course.title} · ${v.module.title}`
              : v.module?.title ?? "—",
          }))}
        />
      )}
    </main>
  );
}
