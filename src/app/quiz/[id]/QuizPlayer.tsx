"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Question {
  id: string;
  text: string;
  points: number;
  options: { id: string; text: string }[];
}

interface StartResp {
  attemptId: string;
  quizTitle: string;
  timeLimitSec: number;
  remainingSec: number;
  passPercent: number;
  questions: Question[];
}

export default function QuizPlayer({ quizId }: { quizId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "active" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<StartResp | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const submittedRef = useRef(false);

  const start = async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/quiz/${quizId}/start`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start quiz");
      setData(json);
      setRemaining(json.remainingSec);
      setState("active");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  };

  const submit = useCallback(
    async (auto = false) => {
      if (!data || submittedRef.current) return;
      submittedRef.current = true;
      setState("submitting");
      try {
        const res = await fetch(`/api/quiz/${quizId}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: data.attemptId, answers }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Submit failed");
        const params = new URLSearchParams({
          score: String(json.score),
          max: String(json.maxScore),
          percent: json.percent.toFixed(2),
          passed: String(json.passed),
          auto: auto ? "1" : "0",
        });
        router.replace(`/quiz/${quizId}/result?${params.toString()}`);
      } catch (e) {
        submittedRef.current = false;
        setError((e as Error).message);
        setState("error");
      }
    },
    [data, answers, quizId, router]
  );

  // Tick timer
  useEffect(() => {
    if (state !== "active") return;
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(t);
          submit(true);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [state, submit]);

  if (state === "idle") {
    return (
      <button
        onClick={start}
        className="px-6 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-accent-violet text-white font-semibold shadow-pop hover:opacity-95 transition"
      >
        Start quiz
      </button>
    );
  }

  if (state === "loading") {
    return <p className="text-ink-mute">Loading...</p>;
  }

  if (state === "error") {
    return (
      <div>
        <p className="text-rose-600 mb-3 text-sm">{error}</p>
        <button
          onClick={start}
          className="px-4 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft transition"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const lowTime = remaining <= 30;

  return (
    <div>
      <div
        className={`sticky top-2 z-10 mb-6 flex items-center justify-between rounded-xl px-4 py-3 backdrop-blur shadow-soft ${
          lowTime
            ? "bg-rose-50 border border-rose-200"
            : "bg-white border border-border"
        }`}
      >
        <span className="text-sm text-ink-mute font-medium">Time remaining</span>
        <span
          className={`font-mono text-lg font-bold tabular-nums ${
            lowTime ? "text-rose-600" : "text-ink"
          }`}
        >
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </span>
      </div>

      <div className="space-y-4">
        {data.questions.map((q, i) => (
          <fieldset
            key={q.id}
            className="rounded-2xl bg-white border border-border p-5 shadow-soft"
          >
            <legend className="text-xs uppercase tracking-wider font-semibold text-ink-faint px-2">
              Question {i + 1} of {data.questions.length} · {q.points} pt
            </legend>
            <p className="font-medium mb-4 mt-1">{q.text}</p>
            <div className="space-y-2">
              {q.options.map((o) => {
                const checked = answers[q.id] === o.id;
                return (
                  <label
                    key={o.id}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition ${
                      checked
                        ? "border-brand-500 bg-brand-50 shadow-ring"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={o.id}
                      checked={checked}
                      onChange={() =>
                        setAnswers((a) => ({ ...a, [q.id]: o.id }))
                      }
                      className="accent-brand-500"
                    />
                    <span>{o.text}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-8 flex items-center justify-between">
        <p className="text-sm text-ink-mute">
          <span className="font-semibold text-ink">
            {Object.keys(answers).length}
          </span>{" "}
          / {data.questions.length} answered
        </p>
        <button
          onClick={() => submit(false)}
          disabled={state === "submitting"}
          className="px-5 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-accent-violet text-white font-semibold shadow-pop hover:opacity-95 disabled:opacity-50 transition"
        >
          {state === "submitting" ? "Submitting..." : "Submit quiz"}
        </button>
      </div>
    </div>
  );
}
