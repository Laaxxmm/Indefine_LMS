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
        className="px-5 py-3 rounded-lg bg-brand-500 hover:bg-brand-600 font-semibold"
      >
        Start quiz
      </button>
    );
  }

  if (state === "loading") {
    return <p className="text-white/60">Loading...</p>;
  }

  if (state === "error") {
    return (
      <div>
        <p className="text-red-300 mb-3">{error}</p>
        <button
          onClick={start}
          className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15"
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
        className={`sticky top-2 z-10 mb-6 flex items-center justify-between rounded-lg px-4 py-3 backdrop-blur ${
          lowTime ? "bg-red-500/20 border border-red-500/40" : "bg-white/5 border border-white/10"
        }`}
      >
        <span className="text-sm text-white/70">
          Time remaining
        </span>
        <span className={`font-mono text-lg font-bold ${lowTime ? "text-red-300" : ""}`}>
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </span>
      </div>

      <div className="space-y-6">
        {data.questions.map((q, i) => (
          <fieldset
            key={q.id}
            className="rounded-xl bg-white/5 border border-white/10 p-5"
          >
            <legend className="text-sm text-white/50 px-2">
              Question {i + 1} of {data.questions.length} • {q.points} pt
            </legend>
            <p className="font-medium mb-4">{q.text}</p>
            <div className="space-y-2">
              {q.options.map((o) => {
                const checked = answers[q.id] === o.id;
                return (
                  <label
                    key={o.id}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition ${
                      checked
                        ? "border-brand-500 bg-brand-500/10"
                        : "border-white/10 hover:bg-white/5"
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
        <p className="text-sm text-white/60">
          {Object.keys(answers).length} / {data.questions.length} answered
        </p>
        <button
          onClick={() => submit(false)}
          disabled={state === "submitting"}
          className="px-5 py-3 rounded-lg bg-brand-500 hover:bg-brand-600 font-semibold disabled:opacity-50"
        >
          {state === "submitting" ? "Submitting..." : "Submit quiz"}
        </button>
      </div>
    </div>
  );
}
