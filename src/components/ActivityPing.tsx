"use client";

// LMS activity heartbeat + the gentle break nudge (Firm OS Phase 9, ADR-006). Mounted in the Firm OS
// layouts and on the dashboard; renders nothing until a nudge is due. While the tab is visible and
// the person has used it in the last two minutes, it posts an empty heartbeat at most once a
// minute; the server decides whether a nudge is due (src/lib/agents/coach/breaks.ts) and answers
// with it. The nudge never takes focus; Escape or "Dismiss" closes it, and it can be snoozed or
// turned off from here. `enabled` is FIRM_OS_BREAK_NUDGE, read on the server.
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { btnGhost, btnPrimary, call, card, errorText } from "@/components/ui";
import { focusRing, sectionTitle } from "@/app/agents/parts";
import { PING_CHECK_MS, shouldPing } from "@/lib/agents/coach/ping";

type Nudge = { id: string; message: string };
type Action = "dismiss" | "snooze-30" | "snooze-60" | "off";

const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

export function ActivityPing({ enabled }: { enabled: boolean }) {
  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const lastInput = useRef(0);
  const lastSent = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || stopped) return;
    lastInput.current = Date.now();
    const mark = () => {
      lastInput.current = Date.now();
    };
    for (const e of INPUT_EVENTS) window.addEventListener(e, mark, { passive: true });
    const tick = async () => {
      const now = Date.now();
      if (!shouldPing({ visible: document.visibilityState === "visible", lastInputAt: lastInput.current, lastSentAt: lastSent.current, now })) return;
      lastSent.current = now;
      const r = await call("/api/firm-os/coach/heartbeat", {});
      if (r.ok) setNudge((r.data.nudge as Nudge | null) ?? null);
    };
    void tick();
    const timer = window.setInterval(() => void tick(), PING_CHECK_MS);
    return () => {
      window.clearInterval(timer);
      for (const e of INPUT_EVENTS) window.removeEventListener(e, mark);
    };
  }, [enabled, stopped]);

  if (!enabled || !nudge) return null;
  const current = nudge;

  async function act(action: Action) {
    setBusy(action);
    setError(null);
    const pref = action === "off" ? { breakNudges: false } : action === "snooze-30" ? { snoozeMinutes: 30 } : action === "snooze-60" ? { snoozeMinutes: 60 } : null;
    const r = pref ? await call("/api/firm-os/coach/preferences", pref) : { ok: true, error: null };
    const d = r.ok ? await call(`/api/firm-os/coach/events/${encodeURIComponent(current.id)}/dismiss`) : r;
    setBusy(null);
    if (!d.ok) return setError(d.error);
    if (action === "off") setStopped(true);
    setNudge(null);
  }

  const button = (action: Action, label: string, cls = btnGhost) => (
    <button type="button" disabled={busy !== null} onClick={() => act(action)} className={`${cls} ${focusRing} inline-flex items-center gap-1.5`}>
      {busy === action && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
      {label}
    </button>
  );

  return (
    <section
      aria-labelledby="break-nudge-title"
      aria-live="polite"
      onKeyDown={(e) => {
        if (e.key === "Escape" && busy === null) void act("dismiss");
      }}
      className={`${card} fixed z-40 bottom-4 left-4 right-4 sm:left-auto sm:w-[360px]`}
    >
      <h2 id="break-nudge-title" className={sectionTitle}>
        Break reminder
      </h2>
      <p className="text-[13px] text-ink-soft">{current.message}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        {button("dismiss", "Dismiss", btnPrimary)}
        {button("snooze-30", "Snooze 30 min")}
        {button("snooze-60", "Snooze 60 min")}
        {button("off", "Turn off reminders")}
      </div>
      {error && (
        <p role="alert" className={`${errorText} mt-2`}>
          {error}
        </p>
      )}
    </section>
  );
}
