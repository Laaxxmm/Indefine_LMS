// Auto-generate a quiz for a video by having Gemini watch it.
//
//   1. Reuse the saved transcript (video.sourceText) if we already have one.
//   2. Otherwise download the video via Graph, transcribe it with Gemini, and
//      save the transcript onto the video for reuse / editing.
//   3. Generate a 20-question MEDIUM quiz grounded in that transcript and save
//      the questions live. All quiz-gen guardrails apply.

//
// DPDP (security audit #11, ADR-002): a live-session recording may discuss a real client.
//   - Its VIDEO is never uploaded to Gemini (an upload cannot be masked): the session is parked
//     for an admin instead (an AuditEvent `gemini.parked`, plain message, nothing sent).
//   - Its TRANSCRIPT is checked first (legacy-gate.ts transcriptGate): when masking cannot cover it
//     the session is parked; otherwise it is sent masked (client + staff name dictionary).
//   - Every text prompt (distill, quiz generation) is masked and gated inside those modules.

import { prisma } from "@/lib/prisma";
import { getAppOnlyToken, getUserGraphToken, getStreamUrl } from "@/lib/graph";
import { transcribeVideo } from "@/lib/transcribe";
import { generateQuiz, type Difficulty } from "@/lib/quiz-gen";
import { distillTranscript } from "@/lib/distill";
import { getQuizDefaults } from "@/lib/settings";
import { logAudit } from "@/lib/audit/log";
import { PARKED_MESSAGE, transcriptGate } from "@/lib/ai/legacy-gate";
import { loadFirmNameDictionary } from "@/lib/ai/name-directory";
import type { DictionaryEntry } from "@/lib/ai/types";

/** AuditEvent.action recording that a legacy Gemini call was parked for an admin (nothing sent). */
export const GEMINI_PARKED_ACTION = "gemini.parked";

/** Park a live session / video for admin review: an AuditEvent with the reasons (kinds, never values). */
export async function parkForAdminReview(entity: "LiveSession" | "Video", entityId: string, reasons: readonly string[]): Promise<void> {
  await logAudit(prisma, { actorId: "system:gemini-gate", action: GEMINI_PARKED_ACTION, entity, entityId, meta: { reasons: [...reasons], message: PARKED_MESSAGE } });
  console.warn(`Gemini: ${entity} ${entityId} parked for admin review (${reasons.join(", ")}); nothing was sent.`);
}

/** Has this live session / video already been parked? (The cron then leaves it for the admin.) */
export async function isParkedForAdmin(entity: "LiveSession" | "Video", entityId: string): Promise<boolean> {
  return (await prisma.auditEvent.count({ where: { action: GEMINI_PARKED_ACTION, entity, entityId } })) > 0;
}

/** Client master + staff names for masking legacy Gemini text; null when they cannot be read (callers then send nothing). */
export async function legacyDictionary(): Promise<DictionaryEntry[] | null> {
  try {
    return await loadFirmNameDictionary(prisma as unknown as Parameters<typeof loadFirmNameDictionary>[0]);
  } catch {
    return null;
  }
}

const MAX_TRANSCRIPT_CHARS = 28_000; // stay under generateQuiz's source limit
// Transcripts longer than this go through the distillation pass first — raw
// ASR text this size is noisy and would be truncated anyway.
const DISTILL_THRESHOLD_CHARS = 6_000;

export type AutoQuizResult = {
  ok: boolean;
  videoId: string;
  generated?: number;
  dropped?: number;
  transcriptChars?: number;
  skipped?: "has-quiz" | "no-key" | "no-transcript" | "parked";
  message?: string;
  error?: string;
};

export async function autoQuizFromVideo(
  videoId: string,
  opts: {
    fallbackUserId?: string;
    noVideoFallback?: boolean;
    /** Question difficulty — live-session quizzes pass HARD. Default MEDIUM. */
    difficulty?: Difficulty;
    /** Client + staff names to mask (default: loaded from the database; nothing is sent without it). */
    dictionary?: DictionaryEntry[];
  } = {}
): Promise<AutoQuizResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, videoId, skipped: "no-key", error: "The AI service for quizzes is not set up on the server. Ask IT to add the Gemini key." };
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

  const dictionary = opts.dictionary ?? (await legacyDictionary());
  if (!dictionary) {
    return { ok: false, videoId, error: "The list of client and staff names to hide from the AI could not be loaded, so nothing was sent. Try again later." };
  }
  // A live-session recording may discuss a client (ADR-002 known gap, closed here).
  const live = await prisma.liveSession.findFirst({ where: { recordedVideoId: videoId }, select: { id: true } });

  // 1/2. Get a transcript — reuse the saved one, else transcribe the video.
  let transcript = (video.sourceText ?? "").trim();
  if (transcript.length < 200) {
    // Live-session recordings generate quizzes from the Teams transcript only —
    // we never re-transcribe the whole video here (that's the costly path).
    if (opts.noVideoFallback) {
      return {
        ok: false,
        videoId,
        skipped: "no-transcript",
        error: "No transcript available yet — skipped video transcription.",
      };
    }
    if (live) {
      // Uploading the recording cannot be masked: park it for an admin instead of sending it.
      await parkForAdminReview("LiveSession", live.id, ["recording upload cannot be masked"]);
      return { ok: false, videoId, skipped: "parked", error: PARKED_MESSAGE };
    }
    let token = await getAppOnlyToken();
    if (!token && opts.fallbackUserId) token = await getUserGraphToken(opts.fallbackUserId);
    if (!token) return { ok: false, videoId, error: "The connection to OneDrive is not set up on the server, so the video could not be read. Tell IT." };

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
  if (live) {
    const verdict = transcriptGate(transcript, dictionary);
    if (!verdict.send) {
      await parkForAdminReview("LiveSession", live.id, verdict.reasons);
      return { ok: false, videoId, skipped: "parked", error: PARKED_MESSAGE };
    }
  }

  // 3. Long/raw transcripts: distill first. The distillation pass reads the
  // FULL transcript (direct generation truncates at ~28k chars) and produces
  // clean, transcript-verified key points — deeper questions, less noise,
  // and one key point per distinct fact keeps repetition down. Falls back to
  // the raw (truncated) transcript if distillation fails.
  let sourceText = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  if (transcript.length > DISTILL_THRESHOLD_CHARS) {
    const distilled = await distillTranscript({
      title: video.title,
      transcript,
      apiKey,
      dictionary,
    });
    if (distilled.ok && distilled.notes.length >= 200) {
      sourceText = distilled.notes;
    }
  }

  // 4. Generate a grounded quiz from the (distilled) source.
  const result = await generateQuiz({
    videoTitle: video.title,
    videoDescription: video.description,
    sourceText,
    count: 20,
    difficulty: opts.difficulty ?? "MEDIUM",
    dictionary,
  });
  if (!result.ok) return { ok: false, videoId, error: result.error, transcriptChars: transcript.length };

  // Ensure a quiz exists, then save the questions live.
  let quizId = video.quiz?.id;
  if (!quizId) {
    const created = await prisma.quiz.create({
      data: { videoId: video.id, title: `${video.title} quiz`, ...(await getQuizDefaults()) },
    });
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
