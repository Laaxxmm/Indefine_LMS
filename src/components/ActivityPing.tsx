"use client";

// LMS activity heartbeat + the gentle break nudge (Firm OS Phase 9, ADR-006). Mounted in the Firm OS
// layouts and on the dashboard; shows nothing until a nudge is due. While the tab is visible and
// the person has used it in the last two minutes, it posts an empty heartbeat at most once a
// minute (spaced out up to 5 minutes while the server answers "nothing recorded" — reminders off,
// or another tab already recorded; see ping.ts); the server decides whether a nudge is due
// (src/lib/agents/coach/breaks.ts) and answers with it. The nudge never takes focus (a polite live region announces it); "Dismiss", or Escape
// while focus is in the notice, closes it, and it can be snoozed or turned off from here. It sits
// above the dashboard's help button and the review screen's action bar. `enabled` is
// FIRM_OS_BREAK_NUDGE, read on the server.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { btnGhost, btnPrimary, call, card, errorText } from "@/components/ui";
import { focusRing, sectionTitle } from "@/app/agents/parts";
import { PING_CHECK_MS, isQuietAnswer, pingInterval, shouldPing } from "@/lib/agents/coach/ping";

type Nudge = { id: string; message: string };
type Action = "dismiss" | "snooze-30" | "snooze-60" | "off";

const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

const DONE: Record<Action, string | null> = {
  dismiss: null,
  "snooze-30": "Break reminders snoozed for 30 minutes.",
  "snooze-60": "Break reminders snoozed for 60 minutes.",
  off: "Break reminders are off. Turn them on again on My day.",
};

export function ActivityPing({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const lastInput = useRef(0);
  const lastSent = useRef<number | null>(null);
  const quiet = useRef(0);

  useEffect(() => {
    if (!enabled || stopped) return;
    lastInput.current = Date.now();
    const mark = () => {
      lastInput.current = Date.now();
    };
    for (const e of INPUT_EVENTS) window.addEventListener(e, mark, { passive: true });
    const tick = async () => {
      const now = Date.now();
      const visible = document.visibilityState === "visible";
      if (!shouldPing({ visible, lastInputAt: lastInput.current, lastSentAt: lastSent.current, now, intervalMs: pingInterval(quiet.current) })) return;
      lastSent.current = now;
      const r = await call("/api/firm-os/coach/heartbeat", {});
      if (!r.ok) return;
      quiet.current = isQuietAnswer(r.data) ? quiet.current + 1 : 0;
      setNudge((r.data.nudge as Nudge | null) ?? null);
    };
    // Back in view: once a minute again, and check now.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      quiet.current = 0;
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    const timer = window.setInterval(() => void tick(), PING_CHECK_MS);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      for (const e of INPUT_EVENTS) window.removeEventListener(e, mark);
    };
  }, [enabled, stopped]);

  if (!enabled) return null;

  async function act(n: Nudge, action: Action) {
    setBusy(action);
    setError(null);
    const pref = action === "off" ? { breakNudges: false } : action === "snooze-30" ? { snoozeMinutes: 30 } : action === "snooze-60" ? { snoozeMinutes: 60 } : null;
    if (pref) {
      const r = await call("/api/firm-os/coach/preferences", pref);
      if (!r.ok) {
        setBusy(null);
        return setError(r.error);
      }
    }
    const d = await call(`/api/firm-os/coach/events/${encodeURIComponent(n.id)}/dismiss`);
    setBusy(null);
    if (!d.ok) return setError(d.error);
    if (action === "off") setStopped(true);
    setNudge(null);
    setStatus(DONE[action]);
    if (pref) router.refresh();
  }

  const button = (n: Nudge, action: Action, label: string, cls = btnGhost) => (
    <button type="button" disabled={busy !== null} onClick={() => act(n, action)} className={`${cls} ${focusRing} inline-flex items-center gap-1.5`}>
      {busy === action && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
      {label}
    </button>
  );

  return (
    <>
      {/* Always mounted, so screen readers announce a nudge when it arrives and the outcome of a choice. */}
      <div aria-live="polite" className="sr-only">
        {nudge ? `Break reminder: ${nudge.message}` : status ?? ""}
      </div>
      {nudge && (
        <section
          aria-labelledby="break-nudge-title"
          onKeyDown={(e) => {
            if (e.key === "Escape" && busy === null) void act(nudge, "dismiss");
          }}
          className={`${card} fixed z-40 bottom-20 left-4 right-4 sm:left-auto sm:w-[360px]`}
        >
          <h2 id="break-nudge-title" className={sectionTitle}>
            Break reminder
          </h2>
          <p className="text-[13px] text-ink-soft">{nudge.message}</p>
          <div className="flex flex-wrap gap-2 mt-3">
            {button(nudge, "dismiss", "Dismiss", btnPrimary)}
            {button(nudge, "snooze-30", "Snooze 30 min")}
            {button(nudge, "snooze-60", "Snooze 60 min")}
            {button(nudge, "off", "Turn off break reminders")}
          </div>
          {error && (
            <p role="alert" className={`${errorText} mt-2`}>
              {error}
            </p>
          )}
        </section>
      )}
    </>
  );
}
