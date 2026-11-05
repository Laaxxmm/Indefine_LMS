// When the browser sends an activity heartbeat (src/components/ActivityPing.tsx). Pure so the rule
// is tested without a DOM: only while the tab is visible, only after recent interaction, and at
// most once a minute. The ping carries no payload: the server knows who from the session.
//
// Back-off: when the server answers "nothing recorded" (the person turned break reminders off, or
// another tab already recorded this minute) and shows no nudge, this tab's next ping waits twice as
// long, up to PING_MAX_INTERVAL_MS — half the 10-minute break gap, so a working streak recorded by
// this tab can never be broken by the back-off. Any recorded heartbeat or nudge, or the tab coming
// back into view, returns to once a minute.
export const PING_INTERVAL_MS = 60_000;
/** Longest spacing while the server keeps answering "nothing recorded". */
export const PING_MAX_INTERVAL_MS = 5 * 60_000;
/** Interaction (pointer, key, wheel, touch) within this window counts as "working". */
export const RECENT_INPUT_MS = 2 * 60_000;
/** How often the component checks whether to ping. */
export const PING_CHECK_MS = 15_000;

/** `intervalMs`: the current spacing (pingInterval); default once a minute. */
export type PingState = { visible: boolean; lastInputAt: number; lastSentAt: number | null; now: number; intervalMs?: number };

export function shouldPing(s: PingState): boolean {
  if (!s.visible) return false;
  if (s.now - s.lastInputAt > RECENT_INPUT_MS) return false;
  return s.lastSentAt === null || s.now - s.lastSentAt >= (s.intervalMs ?? PING_INTERVAL_MS);
}

/** Spacing after `quiet` answers in a row that recorded nothing and showed no nudge. */
export function pingInterval(quiet: number): number {
  return Math.min(PING_INTERVAL_MS * 2 ** Math.max(0, Math.floor(quiet)), PING_MAX_INTERVAL_MS);
}

/** Was this heartbeat answer "nothing recorded, nothing to show"? */
export function isQuietAnswer(data: { recorded?: unknown; nudge?: unknown } | null | undefined): boolean {
  return !!data && data.recorded === false && !data.nudge;
}
