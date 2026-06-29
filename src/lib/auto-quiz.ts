// Auto-generate a quiz for a video by having Gemini watch it.
//
//   1. Reuse the saved transcript (video.sourceText) if we already have one.
//   2. Otherwise download the video via Graph, transcribe it with Gemini, and
//      save the transcript onto the video for reuse / editing.
//   3. Generate a 20-question MEDIUM quiz grounded in that transcript and save
//      the questions live. All quiz-gen guardrails apply.

import { prisma } from "@/lib/prisma";
import { getAppOnlyToken, getUserGraphToken, getStreamUrl } from "@/lib/graph";
import { transcribeVideo } from "@/lib/transcribe";
import { generateQuiz } from "@/lib/quiz-gen";

const MAX_TRANSCRIPT_CHARS = 28_000; // stay under generateQuiz's source limit

export type AutoQuizResult = {
  ok: boolean;
  videoId: string;
  generated?: number;
  dropped?: number;
  transcriptChars?: number;
  skipped?: "has-quiz" | "no-key";
  message?: string;
  error?: string;
};

export async function autoQuizFromVideo(
  videoId: string,
  opts: { fallbackUserId?: string } = {}
): Promise<AutoQuizResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, videoId, skipped: "no-key", error: "GEMINI_API_KEY is not set on the server." };
  }

  const video = await prisma.video.findUnique({
    where: { id: videoId },
    select: {
      id: true,
      title: true,
      description: true,
      sourceText: true,
      graphDriveId: true,
      graphItemId: true,
      quiz: { select: { id: true, _count: { select: { questions: true } } } },
    },
  });
  if (!video) return { ok: false, videoId, error: "Video not found." };

  // Never clobber an existing quiz that already has questions.
  if (video.quiz && video.quiz._count.questions > 0) {
    return {
      ok: true,
      videoId,
      skipped: "has-quiz",
      message: `Already has ${video.quiz._count.questions} questions — skipped.`,
    };
  }

  // 1/2. Get a transcript — reuse the saved one, else transcribe the video.
  let transcript = (video.sourceText ?? "").trim();
  if (transcript.length < 200) {
    let token = await getAppOnlyToken();
    if (!token && opts.fallbackUserId) token = await getUserGraphToken(opts.fallbackUserId);
    if (!token) return { ok: false, videoId, error: "No Microsoft Graph token available to fetch the video." };

    const downloadUrl = await getStreamUrl(video.graphDriveId, video.graphItemId, token);
    if (!downloadUrl) return { ok: false, videoId, error: "Could not resolve a download URL for the video." };

    const t = await transcribeVideo({
      downloadUrl,
      displayName: video.title,
      apiKey,
    });
    if (!t.ok) return { ok: false, videoId, error: t.error };

    transcript = t.transcript.trim();
    await prisma.video.update({ where: { id: video.id }, data: { sourceText: transcript } });
  }

  if (transcript.length < 200) {
    return { ok: false, videoId, error: "Transcript too short to generate a grounded quiz." };
  }

  // 3. Generate a grounded quiz from the transcript.
  const result = await generateQuiz({
    videoTitle: video.title,
    videoDescription: video.description,
    sourceText: transcript.slice(0, MAX_TRANSCRIPT_CHARS),
    count: 20,
    difficulty: "MEDIUM",
  });
  if (!result.ok) return { ok: false, videoId, error: result.error, transcriptChars: transcript.length };

  // Ensure a quiz exists, then save the questions live.
  let quizId = video.quiz?.id;
  if (!quizId) {
    const created = await prisma.quiz.create({ data: { videoId: video.id, title: `${video.title} quiz` } });
    quizId = created.id;
  }
  let order = 0;
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

  return {
    ok: true,
    videoId,
    generated: result.questions.length,
    dropped: result.dropped,
    transcriptChars: transcript.length,
  };
}
