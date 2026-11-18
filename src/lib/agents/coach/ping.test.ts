// Heartbeat back-off: once a minute while heartbeats are recorded; spaced out (2, 4, then 5 min)
// only while the server keeps answering "nothing recorded" with no nudge — never beyond half the
// 10-minute break gap, so a streak this tab records cannot break.
import { describe, expect, it } from "vitest";
import { BREAK_POLICY } from "./config";
import { PING_INTERVAL_MS, PING_MAX_INTERVAL_MS, isQuietAnswer, pingInterval, shouldPing } from "./ping";

describe("ping back-off", () => {
  it("doubles from one minute to at most five", () => {
    expect([0, 1, 2, 3, 4, 10].map(pingInterval)).toEqual([60_000, 120_000, 240_000, 300_000, 300_000, 300_000]);
    expect(pingInterval(-1)).toBe(PING_INTERVAL_MS);
    expect(PING_MAX_INTERVAL_MS * 2).toBeLessThanOrEqual(BREAK_POLICY.gapMin * 60_000);
  });

  it("a quiet answer is recorded: false with no nudge", () => {
    expect(isQuietAnswer({ recorded: false, nudge: null })).toBe(true);
    expect(isQuietAnswer({ recorded: true, nudge: null })).toBe(false);
    expect(isQuietAnswer({ recorded: false, nudge: { id: "n", message: "m" } })).toBe(false);
    expect(isQuietAnswer(null)).toBe(false);
  });

  it("shouldPing honours the current spacing (default once a minute)", () => {
    const s = { visible: true, lastInputAt: 1_000_000, lastSentAt: 1_000_000 - 90_000, now: 1_000_000 };
    expect(shouldPing(s)).toBe(true);
    expect(shouldPing({ ...s, intervalMs: pingInterval(1) })).toBe(false);
    expect(shouldPing({ ...s, lastSentAt: s.now - 120_000, intervalMs: pingInterval(1) })).toBe(true);
    expect(shouldPing({ ...s, visible: false, intervalMs: pingInterval(0) })).toBe(false);
  });
});
