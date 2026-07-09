import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { QuizAI } from "./QuizAI";
import { generateQuiz } from "@/lib/quiz-gen";
import { getQuizDefaults } from "@/lib/settings";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  return session;
}

async function addGeneratedQuestion(data: {
  videoId: string;
  text: string;
  options: { text: string; isCorrect: boolean }[];
}): Promise<{ ok: boolean; error?: string }> {
  "use server";
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, error: "Unauthorized" };
  }
  const text = data.text?.trim();
  if (!text) return { ok: false, error: "Missing question text" };
  const opts = (data.options ?? [])
    .map((o, i) => ({ text: o.text?.trim() ?? "", isCorrect: !!o.isCorrect, order: i }))
    .filter((o) => o.text);
  if (opts.length < 2) return { ok: false, error: "Need at least 2 options" };
  if (opts.filter((o) => o.isCorrect).length !== 1) {
    return { ok: false, error: "Need exactly one correct option" };
  }
  const quiz = await prisma.quiz.findUnique({
    where: { videoId: data.videoId },
    select: { id: true },
  });
  if (!quiz) return { ok: false, error: "Quiz does not exist for this video yet" };

  const count = await prisma.question.count({ where: { quizId: quiz.id } });
  await prisma.question.create({
    data: {
      quizId: quiz.id,
      text,
      order: count,
      options: { create: opts },
    },
  });
  revalidatePath(`/admin/video/${data.videoId}`);
  return { ok: true };
}

// Persist the video's script/notes (and make sure a quiz row exists to attach to).
async function saveScript(data: {
  videoId: string;
  sourceText: string;
}): Promise<{ ok: boolean; error?: string }> {
  "use server";
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, error: "Unauthorized" };
  }
  const sourceText = (data.sourceText ?? "").trim();
  const video = await prisma.video.findUnique({
    where: { id: data.videoId },
    select: { id: true, title: true },
  });
  if (!video) return { ok: false, error: "Video not found" };

  await prisma.video.update({
    where: { id: video.id },
    data: { sourceText: sourceText || null },
  });
  const existing = await prisma.quiz.findUnique({ where: { videoId: video.id }, select: { id: true } });
  if (!existing) {
    await prisma.quiz.create({
      data: { videoId: video.id, title: `${video.title} quiz`, ...(await getQuizDefaults()) },
    });
  }
  revalidatePath(`/admin/video/${video.id}`);
  return { ok: true };
}

// Generate questions from the pasted script and append them to the quiz live.
async function generateAndAddLive(data: {
  videoId: string;
  sourceText: string;
  count: number;
  difficulty: "EASY" | "MEDIUM" | "HARD" | "MIXED";
}): Promise<{ ok: boolean; generated?: number; dropped?: number; error?: string }> {
  "use server";
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return { ok: false, error: "Unauthorized" };
  }
  const sourceText = (data.sourceText ?? "").trim();
  if (sourceText.length < 200) {
    return { ok: false, error: "Add at least 200 characters of source text." };
  }
  const video = await prisma.video.findUnique({
    where: { id: data.videoId },
    select: { id: true, title: true, description: true },
  });
  if (!video) return { ok: false, error: "Video not found" };

  await prisma.video.update({ where: { id: video.id }, data: { sourceText } });

  const result = await generateQuiz({
    videoTitle: video.title,
    videoDescription: video.description,
    sourceText,
    count: data.count,
    difficulty: data.difficulty,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const existing = await prisma.quiz.findUnique({ where: { videoId: video.id }, select: { id: true } });
  const quizId =
    existing?.id ??
    (
      await prisma.quiz.create({
        data: { videoId: video.id, title: `${video.title} quiz`, ...(await getQuizDefaults()) },
      })
    ).id;

  let order = await prisma.question.count({ where: { quizId } });
  for (const q of result.questions) {
    await prisma.question.create({
      data: {
        quizId,
        text: q.text,
        order: order++,
        options: { create: q.options.map((o, i) => ({ text: o.text, isCorrect: o.isCorrect, order: i })) },
      },
    });
  }
  revalidatePath(`/admin/video/${video.id}`);
  return { ok: true, generated: result.questions.length, dropped: result.dropped };
}

async function saveQuizSettings(formData: FormData) {
  "use server";
  await requireAdmin();
  const videoId = String(formData.get("videoId"));
  const title = String(formData.get("title") || "Quiz");
  const timeLimitSec = Number(formData.get("timeLimitMin") || 5) * 60;
  const passPercent = Number(formData.get("passPercent") || 70);
  const unlockAtPercent = Number(formData.get("unlockAtPercent") || 90);
  const maxAttemptsRaw = String(formData.get("maxAttempts") ?? "");
  const maxAttempts = maxAttemptsRaw === "" ? null : Number(maxAttemptsRaw);

  await prisma.quiz.upsert({
    where: { videoId },
    create: { videoId, title, timeLimitSec, passPercent, unlockAtPercent, maxAttempts },
    update: { title, timeLimitSec, passPercent, unlockAtPercent, maxAttempts },
  });
  revalidatePath(`/admin/video/${videoId}`);
}

async function addQuestion(formData: FormData) {
  "use server";
  await requireAdmin();
  const quizId = String(formData.get("quizId"));
  const videoId = String(formData.get("videoId"));
  const text = String(formData.get("text") || "").trim();
  if (!text) return;
  const correctIdx = Number(formData.get("correctIdx") || 0);

  const opts: { text: string; isCorrect: boolean; order: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const t = String(formData.get(`opt${i}`) || "").trim();
    if (t) opts.push({ text: t, isCorrect: i === correctIdx, order: i });
  }
  if (opts.length < 2 || !opts.some((o) => o.isCorrect)) return;

  const count = await prisma.question.count({ where: { quizId } });
  await prisma.question.create({
    data: {
      quizId,
      text,
      order: count,
      options: { create: opts },
    },
  });
  revalidatePath(`/admin/video/${videoId}`);
}

async function deleteQuestion(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const videoId = String(formData.get("videoId"));
  await prisma.question.delete({ where: { id } });
  revalidatePath(`/admin/video/${videoId}`);
}

export default async function AdminVideoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const video = await prisma.video.findUnique({
    where: { id },
    include: {
      quiz: {
        include: {
          questions: { include: { options: true }, orderBy: { order: "asc" } },
        },
      },
    },
  });
  if (!video) notFound();
  const quiz = video.quiz;

  return (
    <main className="min-h-screen px-6 py-10 max-w-3xl mx-auto">
      <Link
        href="/admin"
        className="text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white hover:bg-muted border border-border shadow-soft transition"
      >
        ← Admin
      </Link>
      <div className="mt-5 mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1.5">
          Admin · Edit quiz
        </p>
        <h1 className="font-display text-[30px] font-extrabold tracking-[-0.02em] leading-tight">
          {video.title}
        </h1>
        <p className="text-ink-mute text-sm mt-2">Edit quiz settings and questions</p>
      </div>

      <section className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-8">
        <h2 className="font-display text-lg font-bold mb-4">Quiz settings</h2>
        <form action={saveQuizSettings} className="grid sm:grid-cols-2 gap-4">
          <input type="hidden" name="videoId" value={video.id} />
          <Field
            label="Title"
            name="title"
            defaultValue={quiz?.title ?? "Quiz"}
            colSpan
          />
          <Field
            label="Time limit (min)"
            name="timeLimitMin"
            type="number"
            min={1}
            defaultValue={quiz ? Math.round(quiz.timeLimitSec / 60) : 5}
          />
          <Field
            label="Pass percent"
            name="passPercent"
            type="number"
            min={1}
            max={100}
            defaultValue={quiz?.passPercent ?? 70}
          />
          <Field
            label="Unlock at video % watched"
            name="unlockAtPercent"
            type="number"
            min={0}
            max={100}
            defaultValue={quiz?.unlockAtPercent ?? 90}
          />
          <Field
            label="Max attempts (blank = unlimited)"
            name="maxAttempts"
            type="number"
            min={1}
            defaultValue={quiz?.maxAttempts?.toString() ?? ""}
          />
          <div className="sm:col-span-2">
            <SubmitButton className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white">
              Save settings
            </SubmitButton>
          </div>
        </form>
      </section>

      <QuizAI
        videoId={video.id}
        savedSourceText={video.sourceText ?? ""}
        geminiConfigured={!!process.env.GEMINI_API_KEY}
        generateAndAddAction={generateAndAddLive}
        saveScriptAction={saveScript}
        addAction={addGeneratedQuestion}
      />

      {quiz && (
        <section className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-8">
          <h2 className="font-display text-lg font-bold mb-4">
            Questions ({quiz.questions.length})
          </h2>
          {quiz.questions.length === 0 && (
            <p className="text-ink-mute text-sm mb-4">No questions yet.</p>
          )}
          <div className="space-y-3">
            {quiz.questions.map((q, i) => (
              <div
                key={q.id}
                className="rounded-xl bg-white border border-border shadow-soft p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">
                    {i + 1}. {q.text}
                  </p>
                  <form action={deleteQuestion}>
                    <input type="hidden" name="id" value={q.id} />
                    <input type="hidden" name="videoId" value={video.id} />
                    <button className="text-xs text-rose-600 hover:text-rose-500">
                      Delete
                    </button>
                  </form>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {q.options.map((o) => (
                    <li
                      key={o.id}
                      className={
                        o.isCorrect ? "text-emerald-600" : "text-ink-soft"
                      }
                    >
                      {o.isCorrect ? "✓" : "○"} {o.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <form action={addQuestion} className="mt-6 space-y-3 border-t border-border pt-6">
            <input type="hidden" name="quizId" value={quiz.id} />
            <input type="hidden" name="videoId" value={video.id} />
            <Field label="Question text" name="text" required colSpan />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm w-24">
                  <input
                    type="radio"
                    name="correctIdx"
                    value={i}
                    defaultChecked={i === 0}
                    className="accent-brand-500"
                  />
                  Correct
                </label>
                <input
                  name={`opt${i}`}
                  placeholder={`Option ${i + 1}${i < 2 ? " (required)" : ""}`}
                  className="flex-1 bg-muted border border-border rounded px-3 py-2 text-sm"
                />
              </div>
            ))}
            <SubmitButton className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white">
              Add question
            </SubmitButton>
          </form>
        </section>
      )}

      {!quiz && (
        <p className="text-ink-mute text-sm">
          Save the quiz settings above to start adding questions.
        </p>
      )}
    </main>
  );
}

function Field({
  label,
  colSpan,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  colSpan?: boolean;
}) {
  return (
    <label className={`block ${colSpan ? "sm:col-span-2" : ""}`}>
      <span className="block text-sm text-ink-mute mb-1">{label}</span>
      <input
        {...input}
        className="w-full bg-muted border border-border rounded px-3 py-2 text-sm"
      />
    </label>
  );
}
