"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2, Check, X, Pencil, Plus } from "lucide-react";

type Difficulty = "EASY" | "MEDIUM" | "HARD" | "MIXED";

type DraftQuestion = {
  text: string;
  options: { text: string; isCorrect: boolean }[];
  sourceQuote: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
};

type DraftStatus = "pending" | "saving" | "added" | "rejected";

type Draft = DraftQuestion & {
  localId: string;
  status: DraftStatus;
  editing: boolean;
};

type Props = {
  videoId: string;
  quizExists: boolean;
  addAction: (data: {
    videoId: string;
    text: string;
    options: { text: string; isCorrect: boolean }[];
  }) => Promise<{ ok: boolean; error?: string }>;
  geminiConfigured: boolean;
};

const DIFFICULTIES: { value: Difficulty; label: string; hint: string }[] = [
  { value: "EASY", label: "Easy", hint: "Direct recall" },
  { value: "MEDIUM", label: "Medium", hint: "Apply concepts" },
  { value: "HARD", label: "Hard", hint: "Edge cases" },
  { value: "MIXED", label: "Mixed", hint: "Balanced set" },
];

let idCounter = 0;
function makeLocalId(): string {
  idCounter += 1;
  return `d${idCounter}`;
}

function validateDraft(d: Draft): boolean {
  if (!d.text.trim()) return false;
  const opts = d.options.map((o) => o.text.trim());
  if (opts.length < 2 || opts.some((t) => !t)) return false;
  if (new Set(opts.map((t) => t.toLowerCase())).size !== opts.length) return false;
  if (d.options.filter((o) => o.isCorrect).length !== 1) return false;
  return true;
}

export function QuizGenerator({ videoId, quizExists, addAction, geminiConfigured }: Props) {
  const [sourceText, setSourceText] = useState("");
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>("MEDIUM");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dropped, setDropped] = useState(0);
  const [bulkPending, startBulk] = useTransition();

  const charCount = sourceText.length;
  const charsOk = charCount >= 200;

  async function handleGenerate() {
    setError(null);
    setDropped(0);
    if (!quizExists) {
      setError("Save the quiz settings above first — questions need a quiz to attach to.");
      return;
    }
    if (!charsOk) {
      setError(`Paste at least 200 characters of source material (you have ${charCount}).`);
      return;
    }
    setLoading(true);
    setDrafts([]);
    try {
      const res = await fetch("/api/admin/quiz/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, sourceText, count, difficulty }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Generation failed.");
        return;
      }
      setDrafts(
        (data.questions as DraftQuestion[]).map((q) => ({
          ...q,
          localId: makeLocalId(),
          status: "pending" as DraftStatus,
          editing: false,
        }))
      );
      setDropped(data.dropped ?? 0);
    } catch (e) {
      setError((e as Error).message || "Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(localId: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.localId === localId ? { ...d, ...patch } : d)));
  }

  function updateOption(
    localId: string,
    idx: number,
    patch: Partial<{ text: string; isCorrect: boolean }>
  ) {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.localId !== localId) return d;
        const options = d.options.map((o, i) => {
          if (i !== idx) {
            // Marking one option correct clears the rest.
            return patch.isCorrect ? { ...o, isCorrect: false } : o;
          }
          return { ...o, ...patch };
        });
        return { ...d, options };
      })
    );
  }

  // Commit a single draft. Guards against double-submit via the "saving" status.
  async function commitDraft(d: Draft): Promise<boolean> {
    if (d.status !== "pending") return false;
    if (!validateDraft(d)) {
      setError(
        "A question is incomplete: needs text, non-empty options, and exactly one correct answer."
      );
      return false;
    }
    updateDraft(d.localId, { status: "saving" });
    try {
      const res = await addAction({
        videoId,
        text: d.text,
        options: d.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
      });
      if (res.ok) {
        updateDraft(d.localId, { status: "added", editing: false });
        return true;
      }
      updateDraft(d.localId, { status: "pending" });
      setError(res.error || "Failed to add question.");
      return false;
    } catch (e) {
      updateDraft(d.localId, { status: "pending" });
      setError((e as Error).message || "Failed to add question.");
      return false;
    }
  }

  function addOne(d: Draft) {
    setError(null);
    void commitDraft(d);
  }

  function addAll() {
    setError(null);
    startBulk(async () => {
      // Sequential on purpose — keeps question order stable and avoids racing
      // the per-draft "saving" guard.
      for (const d of drafts) {
        if (d.status === "pending") {
          const ok = await commitDraft(d);
          if (!ok) break;
        }
      }
    });
  }

  const pendingCount = drafts.filter((d) => d.status === "pending").length;
  const addedCount = drafts.filter((d) => d.status === "added").length;

  if (!geminiConfigured) {
    return (
      <section className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-brand-500" />
          <h2 className="text-lg font-semibold">AI quiz generator</h2>
        </div>
        <p className="text-sm text-ink-mute">
          Set <code className="px-1 rounded bg-muted text-xs">GEMINI_API_KEY</code> in your
          environment to enable AI-assisted question generation. Get a key at{" "}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="text-brand-500 underline"
          >
            aistudio.google.com
          </a>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-8">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-brand-500" />
        <h2 className="text-lg font-semibold">Generate questions with AI</h2>
      </div>
      <p className="text-sm text-ink-mute mb-5">
        Paste the video script or notes. Gemini drafts questions <em>only</em> from this text — each
        one comes with the exact source quote that proves the answer. Review, edit, then add the
        ones you like.
      </p>

      <div className="space-y-4">
        <label className="block">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-ink-mute">
              Source material (script, notes, transcript)
            </span>
            <span className={`text-xs ${charsOk ? "text-emerald-600" : "text-ink-mute"}`}>
              {charCount.toLocaleString()} chars {charsOk ? "✓" : "(min 200)"}
            </span>
          </div>
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={10}
            placeholder="Paste the script or NotebookLM source notes here. The more detail, the better the questions."
            className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm font-mono leading-relaxed resize-y"
          />
        </label>

        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <div className="text-sm text-ink-mute mb-2">Difficulty</div>
            <div className="grid grid-cols-2 gap-2">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => setDifficulty(d.value)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                    difficulty === d.value
                      ? "border-brand-500 bg-brand-50 text-brand-600"
                      : "border-border bg-white hover:border-brand-300"
                  }`}
                >
                  <div className="font-medium">{d.label}</div>
                  <div className="text-xs text-ink-mute">{d.hint}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-sm text-ink-mute mb-2">
              Number of questions: <span className="font-semibold text-ink">{count}</span>
            </div>
            <input
              type="range"
              min={3}
              max={15}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
            <div className="flex justify-between text-xs text-ink-mute mt-1">
              <span>3</span>
              <span>15</span>
            </div>
            <p className="text-xs text-ink-mute mt-3">
              Gemini may return fewer if the source can&apos;t support that many grounded questions —
              that&apos;s by design.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading || !quizExists}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate questions
              </>
            )}
          </button>
          {!quizExists && <span className="text-xs text-ink-mute">Save quiz settings first.</span>}
        </div>

        {error && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {drafts.length > 0 && (
        <div className="mt-8 border-t border-border pt-6">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h3 className="font-semibold">
              Review drafts
              <span className="text-ink-mute font-normal">
                {" "}
                — {pendingCount} pending
                {addedCount > 0 && `, ${addedCount} added`}
                {dropped > 0 && `, ${dropped} dropped by guardrails`}
              </span>
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={addAll}
                disabled={bulkPending || pendingCount === 0}
                className="text-sm px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
              >
                {bulkPending ? "Adding…" : `Add all ${pendingCount}`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrafts([]);
                  setDropped(0);
                  setError(null);
                }}
                disabled={bulkPending}
                className="text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {drafts.map((d, i) => (
              <DraftCard
                key={d.localId}
                draft={d}
                index={i}
                onUpdate={updateDraft}
                onUpdateOption={updateOption}
                onAdd={() => addOne(d)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function DraftCard({
  draft,
  index,
  onUpdate,
  onUpdateOption,
  onAdd,
}: {
  draft: Draft;
  index: number;
  onUpdate: (id: string, patch: Partial<Draft>) => void;
  onUpdateOption: (
    id: string,
    idx: number,
    patch: Partial<{ text: string; isCorrect: boolean }>
  ) => void;
  onAdd: () => void;
}) {
  if (draft.status === "rejected") return null;

  if (draft.status === "added") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
        <Check className="w-4 h-4 shrink-0" />
        <span className="truncate">Added: {draft.text}</span>
      </div>
    );
  }

  const saving = draft.status === "saving";
  const badgeTone =
    draft.difficulty === "EASY"
      ? "bg-emerald-100 text-emerald-700"
      : draft.difficulty === "HARD"
      ? "bg-rose-100 text-rose-700"
      : "bg-amber-100 text-amber-700";

  return (
    <div className="rounded-xl border border-border bg-white shadow-soft p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-mute">#{index + 1}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${badgeTone}`}>{draft.difficulty}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onUpdate(draft.localId, { editing: !draft.editing })}
            disabled={saving}
            className="p-1.5 rounded hover:bg-muted text-ink-mute disabled:opacity-40"
            title={draft.editing ? "Done editing" : "Edit"}
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onUpdate(draft.localId, { status: "rejected" })}
            disabled={saving}
            className="p-1.5 rounded hover:bg-rose-50 text-rose-600 disabled:opacity-40"
            title="Reject"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={saving}
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      {draft.editing ? (
        <input
          value={draft.text}
          onChange={(e) => onUpdate(draft.localId, { text: e.target.value })}
          className="w-full bg-muted border border-border rounded px-3 py-2 text-sm font-medium mb-3"
        />
      ) : (
        <p className="font-medium mb-3">{draft.text}</p>
      )}

      <ul className="space-y-1.5 text-sm mb-3">
        {draft.options.map((o, i) => (
          <li key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onUpdateOption(draft.localId, i, { isCorrect: true })}
              disabled={saving}
              className={`w-5 h-5 rounded-full border flex items-center justify-center text-xs transition disabled:opacity-50 ${
                o.isCorrect
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : "border-border bg-white text-transparent hover:border-emerald-400"
              }`}
              title="Mark as correct answer"
            >
              ✓
            </button>
            {draft.editing ? (
              <input
                value={o.text}
                onChange={(e) => onUpdateOption(draft.localId, i, { text: e.target.value })}
                className="flex-1 bg-muted border border-border rounded px-2 py-1 text-sm"
              />
            ) : (
              <span className={o.isCorrect ? "text-emerald-700 font-medium" : "text-ink-soft"}>
                {o.text}
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="rounded-md bg-muted px-3 py-2 text-xs text-ink-mute">
        <span className="font-semibold text-ink-soft">Source:</span> &ldquo;{draft.sourceQuote}&rdquo;
      </div>
    </div>
  );
}
