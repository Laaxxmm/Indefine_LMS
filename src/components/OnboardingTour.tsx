"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpCircle, X, ArrowRight, ArrowLeft } from "lucide-react";

export type TourStep = {
  // CSS selector of the element to highlight. Omit for a centered step.
  selector?: string;
  title: string;
  body: string;
};

const STORAGE_KEY = "indefine_tour_v1";
const CARD_W = 330;

// A lightweight, dependency-free spotlight tour. Auto-runs once on first visit
// (tracked in localStorage) and can be replayed from the floating ? button.
export function OnboardingTour({ steps }: { steps: TourStep[] }) {
  const [active, setActive] = useState(false);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Auto-start on first visit only.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    const t = setTimeout(() => {
      setI(0);
      setActive(true);
    }, 700);
    return () => clearTimeout(t);
  }, []);

  const measure = useCallback(() => {
    const step = steps[i];
    if (!step?.selector) {
      setRect(null);
      return;
    }
    const el = document.querySelector(step.selector) as HTMLElement | null;
    setRect(el ? el.getBoundingClientRect() : null);
  }, [i, steps]);

  // On step change: scroll target into view, then measure (and keep measuring
  // on scroll/resize so the spotlight tracks the element).
  useEffect(() => {
    if (!active) return;
    const step = steps[i];
    const el = step?.selector
      ? (document.querySelector(step.selector) as HTMLElement | null)
      : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });

    measure();
    const t = setTimeout(measure, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, i, steps, measure]);

  function finish() {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, "1");
    setActive(false);
  }
  function next() {
    if (i >= steps.length - 1) finish();
    else setI((n) => n + 1);
  }
  function back() {
    setI((n) => Math.max(0, n - 1));
  }

  const step = steps[i];

  // Position the tooltip card relative to the highlighted element (or centre it).
  let cardStyle: React.CSSProperties = {
    top: "50%",
    left: "50%",
    transform: "translate(-50%,-50%)",
    width: CARD_W,
  };
  if (rect && typeof window !== "undefined") {
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeBelow = spaceBelow > 220;
    const top = placeBelow ? rect.bottom + 14 : Math.max(12, rect.top - 200);
    let left = rect.left;
    left = Math.min(left, window.innerWidth - CARD_W - 14);
    left = Math.max(14, left);
    cardStyle = { top, left, width: CARD_W };
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setI(0);
          setActive(true);
        }}
        aria-label="Help and product tour"
        className="fixed bottom-5 right-5 z-40 w-11 h-11 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lift flex items-center justify-center transition"
        title="Help & tour"
      >
        <HelpCircle className="w-5 h-5" />
      </button>

      {active && step && (
        <div className="fixed inset-0 z-50">
          {/* Click-blocker while the tour is open */}
          <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

          {/* Spotlight (box-shadow dims everything except the target) */}
          {rect ? (
            <div
              style={{
                position: "fixed",
                top: rect.top - 8,
                left: rect.left - 8,
                width: rect.width + 16,
                height: rect.height + 16,
                borderRadius: 16,
                boxShadow: "0 0 0 9999px rgba(15,23,42,0.62)",
                pointerEvents: "none",
                transition: "top .2s, left .2s, width .2s, height .2s",
              }}
            />
          ) : (
            <div className="absolute inset-0" style={{ background: "rgba(15,23,42,0.62)" }} />
          )}

          {/* Tooltip card */}
          <div
            style={{ position: "fixed", ...cardStyle }}
            className="rounded-2xl bg-white shadow-lift border border-border p-5 animate-fade-in"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <p className="text-[10px] uppercase tracking-wider font-bold text-red-500">
                Step {i + 1} of {steps.length}
              </p>
              <button
                type="button"
                onClick={finish}
                aria-label="Close tour"
                className="text-ink-faint hover:text-ink -mt-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <h3 className="font-display text-lg font-bold mb-1">{step.title}</h3>
            <p className="text-sm text-ink-mute leading-relaxed">{step.body}</p>

            <div className="flex items-center justify-between mt-4">
              <button
                type="button"
                onClick={finish}
                className="text-xs text-ink-faint hover:text-ink"
              >
                Skip
              </button>
              <div className="flex items-center gap-2">
                {i > 0 && (
                  <button
                    type="button"
                    onClick={back}
                    className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={next}
                  className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium"
                >
                  {i >= steps.length - 1 ? "Done" : "Next"}
                  {i < steps.length - 1 && <ArrowRight className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
