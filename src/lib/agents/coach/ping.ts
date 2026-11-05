// When the browser sends an activity heartbeat (src/components/ActivityPing.tsx). Pure so the rule
// is tested without a DOM: only while the tab is visible, only after recent interaction, and at
// most once a minute. The ping carries no payload: the server knows who from the session.
export const PING_INTERVAL_MS = 60_000;
/** Interaction (pointer, key, wheel, touch) within this window counts as "working". */
export const RECENT_INPUT_MS = 2 * 60_000;
/** How often the component checks whether to ping. */
export const PING_CHECK_MS = 15_000;

export type PingState = { visible: boolean; lastInputAt: number; lastSentAt: number | null; now: number };

export function shouldPing(s: PingState): boolean {
  if (!s.visible) return false;
  if (s.now - s.lastInputAt > RECENT_INPUT_MS) return false;
  return s.lastSentAt === null || s.now - s.lastSentAt >= PING_INTERVAL_MS;
}
