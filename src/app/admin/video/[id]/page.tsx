import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { QuizAI } from "./QuizAI";
import { generateQuiz } from "@/lib/quiz-gen";
import { getQuizDefaults } from "@/lib/settings";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmButton } from "@/components/ConfirmButton";
import {
  getAppOnlyToken,
  getUserGraphToken,
  getItemParentId,
  uploadFileToFolderId,
  resolveFolderId,
} from "@/lib/graph";
import { isAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");
  return session;
}

async function addGeneratedQuestion(data: {
  videoId: string;
  text: string;
  options: { text: string; isCorrect: boolean }[];
}): Promise<{ ok: boolean; error?: string }> {
  "use server";
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
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
  if (!session?.user || !isAdmin(session.user)) {
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
  if (!session?.user || !isAdmin(session.user)) {
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

// Attach a downloadable handout to this video. The file is uploaded into the
// SAME SharePoint folder the video lives in, so materials sit beside the
// recording and nothing is stored in our DB but the Graph pointer.
async function addMaterial(formData: FormData) {
  "use server";
  await requireAdmin();
  const videoId = String(formData.get("videoId"));
  const back = (msg: string) =>
    `/admin/video/${videoId}?matinfo=${encodeURIComponent(msg)}`;

  // Everything that can fail is inside the try, so a bad upload shows a message
  // instead of throwing and blanking the page. redirect() throws by design, so
  // it stays OUTSIDE (a caught NEXT_REDIRECT would swallow the navigation).
  let done: string;
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Choose a file first.");
    }

    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video) notFound();

    const session = await auth();
    const token =
      (await getAppOnlyToken()) ??
      (session?.user ? await getUserGraphToken(session.user.id) : null);
    if (!token) throw new Error("No Microsoft Graph token available.");

    // Store it beside the video (that folder already lives under the L&D root);
    // if the video's own folder can't be resolved, fall back to the L&D root so
    // the handout still lands somewhere sensible.
    let folderId = await getItemParentId(
      video.graphDriveId,
      video.graphItemId,
      token
    );
    const rootPath = process.env.GRAPH_VIDEOS_FOLDER_PATH;
    if (!folderId && rootPath) {
      folderId = await resolveFolderId(video.graphDriveId, rootPath, token);
    }
    if (!folderId) throw new Error("Couldn't find a folder to store the file in.");

    const uploaded = await uploadFileToFolderId(
      video.graphDriveId,
      folderId,
      file.name,
      await file.arrayBuffer(),
      token
    );
    if (!uploaded) {
      throw new Error(
        "Upload was rejected by SharePoint — check the app has Files.ReadWrite.All."
      );
    }

    const count = await prisma.material.count({ where: { videoId } });
    await prisma.material.create({
      data: {
        videoId,
        name: file.name,
        graphDriveId: video.graphDriveId,
        graphItemId: uploaded.id,
        sizeBytes: uploaded.size || file.size,
        order: count,
      },
    });
    revalidatePath(`/admin/video/${videoId}`);
    revalidatePath(`/video/${videoId}`);
    done = back("Material attached.");
  } catch (e) {
    done = back((e as Error).message || "Upload failed.");
  }
  redirect(done);
}

// Detach a handout. Removes our pointer only — the file stays in SharePoint, so
// an accidental click here never destroys the firm's copy.
async function deleteMaterial(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const videoId = String(formData.get("videoId"));
  await prisma.material.delete({ where: { id } }).catch(() => {});
  revalidatePath(`/admin/video/${videoId}`);
  revalidatePath(`/video/${videoId}`);
}

function formatBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminVideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ matinfo?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { matinfo } = await searchParams;

  const video = await prisma.video.findUnique({
    where: { id },
    include: {
      quiz: {
        include: {
          questions: { include: { options: true }, orderBy: { order: "asc" } },
        },
      },
      materials: { orderBy: { order: "asc" } },
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
        <h2 className="font-display text-lg font-bold mb-1">Materials</h2>
        <p className="text-sm text-ink-mute mb-4">
          Handouts learners can download from this lesson (PDF, worksheet, zipped
          formats). Stored in the L&amp;D SharePoint folder alongside the video.
          Up to 50 MB per file.
        </p>

        {matinfo && (
          <p className="text-sm mb-4 px-3 py-2 rounded-lg bg-muted text-ink-soft">{matinfo}</p>
        )}

        {video.materials.length > 0 && (
          <div className="rounded-xl border border-border divide-y divide-border mb-4">
            {video.materials.map((m) => (
              <div key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <a
                    href={`/api/material/${m.id}`}
                    className="font-semibold text-sm hover:underline truncate block"
                  >
                    {m.name}
                  </a>
                  <p className="text-xs text-ink-faint">{formatBytes(m.sizeBytes)}</p>
                </div>
                <form action={deleteMaterial} className="shrink-0">
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="videoId" value={video.id} />
                  <ConfirmButton
                    message={`Remove "${m.name}" from this lesson? The file stays in SharePoint.`}
                    className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-ink-soft font-semibold"
                  >
                    Remove
                  </ConfirmButton>
                </form>
              </div>
            ))}
          </div>
        )}

        <form action={addMaterial} className="flex items-center gap-3 flex-wrap">
          <input type="hidden" name="videoId" value={video.id} />
          <input
            type="file"
            name="file"
            required
            className="text-sm file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border file:bg-white file:text-ink-soft file:font-semibold file:text-xs hover:file:bg-muted"
          />
          <SubmitButton className="text-sm px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold transition">
            Attach
          </SubmitButton>
        </form>
      </section>

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
                    <ConfirmButton
                      message="Delete this quiz question and its options? This cannot be undone."
                      className="text-xs text-rose-600 hover:text-rose-500"
                    >
                      Delete
                    </ConfirmButton>
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
