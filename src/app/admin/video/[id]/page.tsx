import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  return session;
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
      <Link href="/admin" className="text-sm text-ink-mute hover:text-ink">
        ← Admin
      </Link>
      <h1 className="text-2xl font-bold mt-4">{video.title}</h1>
      <p className="text-ink-mute text-sm mb-8">Edit quiz settings and questions</p>

      <section className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Quiz settings</h2>
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
            <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white">
              Save settings
            </button>
          </div>
        </form>
      </section>

      {quiz && (
        <section className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">
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
            <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white">
              Add question
            </button>
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
