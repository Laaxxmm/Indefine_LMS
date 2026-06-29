"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, Square, CheckCircle2, XCircle, MinusCircle, Sparkles } from "lucide-react";

type VideoLite = { id: string; title: string; moduleTitle: string };

type Status = "pending" | "working" | "done" | "skipped" | "failed";

type Item = VideoLite & { status: Status; message?: string };

type ApiResult = {
  ok: boolean;
  generated?: number;
  dropped?: number;
  transcriptChars?: number;
  skipped?: string;
  message?: string;
  error?: string;
};

const PER_VIDEO_TIMEOUT_MS = 480_000; // 8 min hard ceiling per video

export function BulkQuizRunner({ videos }: { videos: VideoLite[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(
    videos.map((v) => ({ ...v, status: "pending" }))
  );
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  function patch(id: string, p: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }

  async function runOne(id: string): Promise<void> {
    patch(id, { status: "working", message: "Transcribing & generating…" });
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PER_VIDEO_TIMEOUT_MS);
      const res = await fetch("/api/admin/quiz/from-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: id }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const data: ApiResult = await res.json();
      if (data.ok && data.generated) {
        patch(id, {
          status: "done",
          message:
            `Generated ${data.generated} question${data.generated === 1 ? "" : "s"}` +
            (data.dropped ? ` · ${data.dropped} dropped` : "") +
            (data.transcriptChars ? ` · ${data.transcriptChars.toLocaleString()} char transcript` : ""),
        });
      } else if (data.ok && data.skipped) {
        patch(id, { status: "skipped", message: data.message || "Skipped." });
      } else if (data.ok) {
        patch(id, { status: "skipped", message: data.message || "Nothing generated." });
      } else {
        patch(id, { status: "failed", message: data.error || "Failed." });
      }
    } catch (e) {
      const err = e as Error;
      patch(id, {
        status: "failed",
        message: err.name === "AbortError" ? "Timed out (over 8 min)." : err.message,
      });
    }
  }

  async function runAll() {
    stopRef.current = false;
    setRunning(true);
    // Snapshot ids that still need processing.
    const queue = items.filter((it) => it.status === "pending" || it.status === "failed").map((it) => it.id);
    for (const id of queue) {
      if (stopRef.current) break;
      await runOne(id);
    }
    setRunning(false);
    router.refresh();
  }

  async function runSingle(id: string) {
    setRunning(true);
    await runOne(id);
    setRunning(false);
    router.refresh();
  }

  const counts = {
    pending: items.filter((i) => i.status === "pending").length,
    done: items.filter((i) => i.status === "done").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    failed: items.filter((i) => i.status === "failed").length,
  };
  const remaining = counts.pending + counts.failed;

  if (videos.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-dashed border-border p-10 text-center text-ink-mute text-sm">
        Every video already has a quiz. 🎉
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-2xl bg-white border border-border shadow-soft p-5 mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold">
              {videos.length} video{videos.length === 1 ? "" : "s"} without a quiz
            </p>
            <p className="text-sm text-ink-mute mt-0.5">
              {counts.done} done · {counts.skipped} skipped · {counts.failed} failed · {remaining} to go
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!running ? (
              <button
                onClick={runAll}
                disabled={remaining === 0}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
              >
                <Play className="w-4 h-4" />
                {counts.failed > 0 && counts.done > 0 ? "Retry remaining" : "Generate all"}
              </button>
            ) : (
              <button
                onClick={() => {
                  stopRef.current = true;
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:bg-muted"
              >
                <Square className="w-4 h-4" />
                Stop after current
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-amber-50 border border-amber-100 text-amber-700 text-xs px-3 py-2">
          Each video is downloaded, sent to Gemini to transcribe, then turned into a grounded 20-question
          quiz. Expect <strong>1–3 minutes per video</strong>. Keep this tab open while it runs.
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-border shadow-soft divide-y divide-border overflow-hidden">
        {items.map((it) => (
          <div key={it.id} className="px-5 py-3 flex items-center gap-3">
            <StatusIcon status={it.status} />
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{it.title}</p>
              <p className="text-xs text-ink-faint truncate">{it.moduleTitle}</p>
              {it.message && (
                <p
                  className={`text-xs mt-0.5 break-words ${
                    it.status === "failed" ? "text-rose-600" : "text-ink-mute"
                  }`}
                >
                  {it.message}
                </p>
              )}
            </div>
            {(it.status === "pending" || it.status === "failed") && !running && (
              <button
                onClick={() => runSingle(it.id)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted shrink-0 inline-flex items-center gap-1"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generate
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "working") return <Loader2 className="w-5 h-5 text-brand-500 animate-spin shrink-0" />;
  if (status === "done") return <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />;
  if (status === "failed") return <XCircle className="w-5 h-5 text-rose-500 shrink-0" />;
  if (status === "skipped") return <MinusCircle className="w-5 h-5 text-ink-faint shrink-0" />;
  return <div className="w-5 h-5 rounded-full border-2 border-border shrink-0" />;
}
