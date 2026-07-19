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
          attempt: String(json.attemptId),
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
        className="px-7 py-3.5 rounded-[14px] bg-brand-500 hover:bg-brand-600 text-white font-bold transition"
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
        className={`sticky top-2 z-10 mb-6 flex items-center justify-between rounded-2xl px-5 py-4 backdrop-blur border ${
          lowTime ? "bg-rose-50 border-rose-200" : "border-[#DDD6FA]"
        }`}
        style={lowTime ? undefined : { background: "linear-gradient(135deg,#EEEBFF,#F5F2FF)" }}
      >
        <span className={`font-bold text-sm ${lowTime ? "text-rose-600" : "text-brand-600"}`}>
          ⏱ Time remaining
        </span>
        <span
          className={`font-display font-extrabold text-[22px] tabular-nums ${
            lowTime ? "text-rose-600" : "text-brand-600"
          }`}
        >
          {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </span>
      </div>

      <div className="space-y-4">
        {data.questions.map((q, i) => (
          <fieldset
            key={q.id}
            className="rounded-2xl bg-card border border-border p-5 sm:p-6"
          >
            <legend className="text-[11px] uppercase tracking-[0.1em] font-extrabold text-accent-coral px-1">
              Question {i + 1} of {data.questions.length} · {q.points} pt
            </legend>
            <p className="font-display font-bold text-[17px] mb-4 mt-1">{q.text}</p>
            <div className="space-y-2.5">
              {q.options.map((o) => {
                const checked = answers[q.id] === o.id;
                return (
                  <label
                    key={o.id}
                    className={`flex items-center gap-3 rounded-[14px] border-[1.5px] px-4 py-3.5 cursor-pointer transition ${
                      checked ? "border-brand-500 bg-brand-50" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name={q.id}
                      value={o.id}
                      checked={checked}
                      onChange={() => setAnswers((a) => ({ ...a, [q.id]: o.id }))}
                      className="sr-only peer"
                    />
                    <span
                      className={`w-5 h-5 rounded-full border-[1.5px] grid place-items-center shrink-0 transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400 ${
                        checked ? "border-brand-500" : "border-ink-faint"
                      }`}
                    >
                      {checked && <span className="w-2.5 h-2.5 rounded-full bg-brand-500" />}
                    </span>
                    <span className="font-semibold">{o.text}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-8">
        <p className="text-sm text-ink-mute text-center mb-3">
          <span className="font-bold text-ink">{Object.keys(answers).length}</span> /{" "}
          {data.questions.length} answered
        </p>
        <button
          onClick={() => submit(false)}
          disabled={state === "submitting"}
          className="w-full px-5 py-4 rounded-[14px] bg-brand-500 hover:bg-brand-600 text-white font-bold disabled:opacity-50 transition"
        >
          {state === "submitting" ? "Submitting…" : "Submit quiz"}
        </button>
      </div>
    </div>
  );
}
