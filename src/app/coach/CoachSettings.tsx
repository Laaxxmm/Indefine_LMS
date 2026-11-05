"use client";

// The person's own coach settings, inside the "Reminders and breaks" card on /coach. Each change
// saves at once and says so; nothing here is visible to anyone else. Break controls appear only
// when the firm has turned break reminders on.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, errorText, focusRing } from "@/components/ui";
import { formatDateTimeIst } from "@/lib/agents/core/format";
import type { PreferencesView } from "@/lib/agents/coach/activity";
import { Button } from "@/components/firm-os";

type Change = { breakNudges?: boolean; morningBoard?: boolean; snoozeMinutes?: number };

const checkbox = `h-4 w-4 accent-brand-500 ${focusRing}`;
const row = "flex items-start gap-2 text-[13px] leading-5";
/** In-card subheading (the OnboardPanel card pattern); the section title sits above it in the card. */
const subheading = "font-bold text-[13px] leading-5 mb-2";

export function CoachSettings({ prefs, breakFeature }: { prefs: PreferencesView; breakFeature: boolean }) {
  const router = useRouter();
  const [p, setP] = useState(prefs);
  // A change made elsewhere (the break nudge) refreshes the page: take the new values.
  useEffect(() => setP(prefs), [prefs]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(key: string, change: Change, done: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    const r = await call("/api/firm-os/coach/preferences", change);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setP(r.data as unknown as PreferencesView);
    setNotice(done);
    router.refresh();
  }


  return (
    <div>
      <h3 className={subheading}>Morning board</h3>
      <label className={row}>
        <input
          type="checkbox"
          className={`${checkbox} mt-0.5`}
          checked={p.morningBoard}
          disabled={busy !== null}
          onChange={(e) => save("board", { morningBoard: e.target.checked }, e.target.checked ? "Morning board notice is on." : "Morning board notice is off.")}
        />
        <span>
          A notice at 09:00 IST on working days with what must be done today and this week.
          <span className="block text-[12px] text-ink-mute">The board on this page and on your dashboard stays either way.</span>
        </span>
      </label>

      <h3 className={`${subheading} mt-6`}>Break reminders</h3>
      {breakFeature ? (
        <>
          <label className={row}>
            <input
              type="checkbox"
              className={`${checkbox} mt-0.5`}
              checked={p.breakNudges}
              disabled={busy !== null}
              onChange={(e) => save("break", { breakNudges: e.target.checked }, e.target.checked ? "Break reminders are on." : "Break reminders are off. Your activity is no longer recorded.")}
            />
            <span>
              A short reminder after about 100 minutes of continuous work, at most 3 a day.
              <span className="block text-[12px] text-ink-mute">
                To time these, the LMS notes when you are active (no page content) and keeps it for 7 days. Only you see it; nothing about breaks is reported to anyone.
              </span>
            </span>
          </label>
          {p.breakNudges && (
            <div className="flex flex-wrap items-center gap-2 mt-3 pl-6">
              {p.snoozeUntil ? (
                <>
                  <span className="text-[13px] text-ink-soft tabular-nums">Snoozed until {formatDateTimeIst(new Date(p.snoozeUntil))} IST.</span>
                  <Button busy={busy === "resume"} disabled={busy !== null} onClick={() => save("resume", { snoozeMinutes: 0 }, "Break reminders are back on.")}>
                    Resume now
                  </Button>
                </>
              ) : (
                [30, 60].map((m) => (
                  <Button key={m} busy={busy === `snooze-${m}`} disabled={busy !== null} onClick={() => save(`snooze-${m}`, { snoozeMinutes: m }, `Break reminders snoozed for ${m} minutes.`)}>
                    Snooze {m} min
                  </Button>
                ))
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-[13px] text-ink-mute">Break reminders are not turned on for the firm. Nothing about your activity is recorded.</p>
      )}

      {error && (
        <p role="alert" className={`${errorText} mt-3`}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-[13px] text-ink-soft mt-3">
          {notice}
        </p>
      )}
    </div>
  );
}
