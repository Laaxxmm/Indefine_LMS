"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Sparkles, CheckCircle2, AlertCircle, Info } from "lucide-react";

type SaveResult = {
  ok: boolean;
  generated?: number;
  dropped?: number;
  skipped?: "short" | "has-questions" | "no-key";
  message?: string;
  error?: string;
};

type Props = {
  videoId: string;
  defaultSourceText: string;
  quizQuestionCount: number;
  saveAction: (data: { videoId: string; sourceText: string }) => Promise<SaveResult>;
};

export function ScriptAutoGen({ videoId, defaultSourceText, quizQuestionCount, saveAction }: Props) {
  const router = useRouter();
  const [sourceText, setSourceText] = useState(defaultSourceText);
  const [pending, startSave] = useTransition();
  const [result, setResult] = useState<SaveResult | null>(null);

  const charCount = sourceText.trim().length;
  const willAutoGen = quizQuestionCount === 0 && charCount >= 200;

  function save() {
    setResult(null);
    startSave(async () => {
      const res = await saveAction({ videoId, sourceText });
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  return (
    <section className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-8">
      <div className="flex items-center gap-2 mb-1">
        <FileText className="w-5 h-5 text-brand-500" />
        <h2 className="text-lg font-semibold">Script / notes</h2>
      </div>
      <p className="text-sm text-ink-mute mb-4">
        Paste this video&apos;s script or NotebookLM source notes. Saving it{" "}
        {quizQuestionCount === 0 ? (
          <>auto-generates a <strong>20-question medium quiz</strong></>
        ) : (
          <>updates the source used for AI generation</>
        )}
        . It also pre-fills the AI panel below so you can generate more questions any time.
      </p>

      <label className="block">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-ink-mute">Source text</span>
          <span className={`text-xs ${charCount >= 200 ? "text-emerald-600" : "text-ink-mute"}`}>
            {charCount.toLocaleString()} chars {charCount >= 200 ? "✓" : "(min 200 to auto-generate)"}
          </span>
        </div>
        <textarea
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          rows={8}
          placeholder="Paste the video script or source notes here…"
          className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm font-mono leading-relaxed resize-y"
        />
      </label>

      {quizQuestionCount > 0 && (
        <div className="mt-3 rounded-lg bg-muted text-ink-soft text-xs px-3 py-2 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          This quiz already has {quizQuestionCount} question{quizQuestionCount === 1 ? "" : "s"}, so
          saving won&apos;t auto-generate again. Use the AI panel below to add more.
        </div>
      )}

      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
        >
          {pending ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {willAutoGen ? "Saving & generating…" : "Saving…"}
            </>
          ) : (
            <>
              {willAutoGen ? <Sparkles className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
              {willAutoGen ? "Save script & auto-generate 20" : "Save script"}
            </>
          )}
        </button>
        {willAutoGen && !pending && (
          <span className="text-xs text-ink-mute">Generation can take 15–30 seconds.</span>
        )}
      </div>

      {result && (
        <div
          className={`mt-4 rounded-lg text-sm px-3 py-2 flex items-start gap-2 border ${
            result.ok && result.generated
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : result.ok
              ? "bg-muted border-border text-ink-soft"
              : "bg-rose-50 border-rose-200 text-rose-700"
          }`}
        >
          {result.ok && result.generated ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : result.ok ? (
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>
            {result.error
              ? result.error
              : result.message
              ? result.message
              : result.generated
              ? `Generated ${result.generated} question${result.generated === 1 ? "" : "s"}` +
                (result.dropped ? ` · ${result.dropped} dropped by guardrails` : "") +
                ". Saved live below."
              : "Script saved."}
          </span>
        </div>
      )}
    </section>
  );
}
