// Transcribe a video with Gemini's multimodal File API.
//
// Flow (all REST, no SDK):
//   1. Download the video bytes from the Graph pre-authenticated URL.
//   2. Resumable-upload them to the Gemini File API.
//   3. Poll the file until it finishes PROCESSING and becomes ACTIVE.
//   4. Ask Gemini to transcribe the narration verbatim.
//   5. Best-effort delete the uploaded file.
//
// The transcript is what later grounds the quiz — so quiz questions stay
// verifiable against real spoken content, keeping the generator's guardrails.

import { resolveGeminiModel, isThinkingModel } from "@/lib/gemini";

const GEMINI_BASE = "https://generativelanguage.googleapis.com";

const DEFAULT_MAX_BYTES = 250 * 1024 * 1024; // 250 MB — NotebookLM overviews are far smaller
const DOWNLOAD_TIMEOUT_MS = 180_000;
const UPLOAD_TIMEOUT_MS = 300_000;
const PROCESS_TIMEOUT_MS = 300_000;
const GENERATE_TIMEOUT_MS = 300_000;

export type TranscribeResult =
  | { ok: true; transcript: string }
  | { ok: false; error: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function short(s: string, n = 200): string {
  return s.length > n ? s.slice(0, n) : s;
}

export async function transcribeVideo(opts: {
  downloadUrl: string;
  mimeType?: string;
  displayName: string;
  apiKey: string;
  model?: string;
  maxBytes?: number;
}): Promise<TranscribeResult> {
  const apiKey = opts.apiKey;
  const model = opts.model || (await resolveGeminiModel(apiKey));
  const mimeType = opts.mimeType || "video/mp4";
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  // 1. Download the video bytes.
  let bytes: ArrayBuffer;
  try {
    const r = await fetch(opts.downloadUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!r.ok) return { ok: false, error: `Video download failed (${r.status}).` };
    const declared = Number(r.headers.get("content-length") || 0);
    if (declared && declared > maxBytes) {
      return { ok: false, error: `Video is too large (${Math.round(declared / 1e6)} MB, limit ${Math.round(maxBytes / 1e6)} MB).` };
    }
    bytes = await r.arrayBuffer();
    if (bytes.byteLength > maxBytes) {
      return { ok: false, error: `Video is too large (${Math.round(bytes.byteLength / 1e6)} MB).` };
    }
    if (bytes.byteLength === 0) return { ok: false, error: "Downloaded video was empty." };
  } catch (e) {
    const err = e as Error;
    const msg = err.name === "TimeoutError" ? "timed out" : err.message;
    return { ok: false, error: `Video download error: ${msg}` };
  }

  // 2. Start a resumable upload.
  let uploadUrl: string;
  try {
    const start = await fetch(`${GEMINI_BASE}/upload/v1beta/files`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "content-type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: opts.displayName } }),
    });
    if (!start.ok) {
      return { ok: false, error: `Gemini upload start failed (${start.status}): ${short(await start.text().catch(() => ""))}` };
    }
    const u = start.headers.get("x-goog-upload-url");
    if (!u) return { ok: false, error: "Gemini did not return an upload URL." };
    uploadUrl = u;
  } catch (e) {
    return { ok: false, error: `Gemini upload start error: ${(e as Error).message}` };
  }

  // 3. Upload the bytes and finalize.
  let fileName: string;
  let fileUri: string;
  let state: string;
  try {
    const up = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "X-Goog-Upload-Command": "upload, finalize",
        "X-Goog-Upload-Offset": "0",
        "content-length": String(bytes.byteLength),
      },
      body: bytes,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!up.ok) {
      return { ok: false, error: `Gemini upload failed (${up.status}): ${short(await up.text().catch(() => ""))}` };
    }
    const j = (await up.json()) as { file?: { name?: string; uri?: string; state?: string } };
    if (!j.file?.uri || !j.file?.name) return { ok: false, error: "Gemini upload returned no file handle." };
    fileName = j.file.name; // e.g. "files/abc123"
    fileUri = j.file.uri;
    state = j.file.state ?? "PROCESSING";
  } catch (e) {
    const err = e as Error;
    const msg = err.name === "TimeoutError" ? "upload timed out" : err.message;
    return { ok: false, error: `Gemini upload error: ${msg}` };
  }

  // 4. Poll until the video finishes processing.
  const deadline = Date.now() + PROCESS_TIMEOUT_MS;
  try {
    while (state === "PROCESSING") {
      if (Date.now() > deadline) {
        void deleteFile(fileName, apiKey);
        return { ok: false, error: "Gemini took too long to process the video." };
      }
      await sleep(3000);
      const p = await fetch(`${GEMINI_BASE}/v1beta/${fileName}`, {
        headers: { "x-goog-api-key": apiKey },
      });
      if (!p.ok) return { ok: false, error: `Gemini file status check failed (${p.status}).` };
      const pj = (await p.json()) as { state?: string };
      state = pj.state ?? state;
    }
  } catch (e) {
    return { ok: false, error: `Gemini processing poll error: ${(e as Error).message}` };
  }
  if (state !== "ACTIVE") {
    void deleteFile(fileName, apiKey);
    return { ok: false, error: `Gemini could not process the video (state: ${state}).` };
  }

  // 5. Transcribe.
  try {
    const gen = await fetch(
      `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { file_data: { mime_type: mimeType, file_uri: fileUri } },
                {
                  text:
                    "Transcribe the spoken narration of this training video into plain text — verbatim and in spoken order. " +
                    "Include every sentence that is spoken. Do NOT summarize, paraphrase, translate, add commentary, timestamps, or speaker labels. " +
                    "If there is no speech, output an empty string. Output only the transcript text.",
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: isThinkingModel(model) ? 16384 : 8192,
            ...(isThinkingModel(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        }),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      }
    );
    if (!gen.ok) {
      void deleteFile(fileName, apiKey);
      return { ok: false, error: `Gemini transcription failed (${gen.status}): ${short(await gen.text().catch(() => ""))}` };
    }
    const gj = (await gen.json()) as {
      promptFeedback?: { blockReason?: string };
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };
    void deleteFile(fileName, apiKey); // cleanup regardless of outcome

    if (gj.promptFeedback?.blockReason) {
      return { ok: false, error: `Gemini blocked transcription (${gj.promptFeedback.blockReason}).` };
    }
    const transcript = (gj.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "").trim();
    if (!transcript) return { ok: false, error: "Transcription came back empty (the video may have no clear speech)." };
    return { ok: true, transcript };
  } catch (e) {
    void deleteFile(fileName, apiKey);
    const err = e as Error;
    const msg = err.name === "TimeoutError" ? "transcription timed out" : err.message;
    return { ok: false, error: `Gemini transcription error: ${msg}` };
  }
}

async function deleteFile(fileName: string, apiKey: string): Promise<void> {
  try {
    await fetch(`${GEMINI_BASE}/v1beta/${fileName}`, {
      method: "DELETE",
      headers: { "x-goog-api-key": apiKey },
    });
  } catch {
    /* best effort */
  }
}
