// Break-nudge state machine: gaps, the 100-minute threshold, at most 3 a day, snooze, opt-out and
// the feature flag; plus the browser ping rule.
import { describe, expect, it } from "vitest";
import { BREAK_POLICY } from "./config";
import { breakMessage, evaluateBreak, formatActive, streakStart, type BreakInput } from "./breaks";
import { PING_INTERVAL_MS, RECENT_INPUT_MS, shouldPing } from "./ping";

const MIN = 60_000;
const T0 = new Date("2026-11-04T09:00:00+05:30");
const at = (min: number) => new Date(T0.getTime() + min * MIN);
/** One heartbeat a minute from `from` to `to` (inclusive), minutes after T0. */
const beats = (from: number, to: number, every = 1) => Array.from({ length: Math.floor((to - from) / every) + 1 }, (_, i) => at(from + i * every));

function input(over: Partial<BreakInput> = {}): BreakInput {
  return { now: at(0), heartbeats: [], nudgesToday: [], prefs: { enabled: true, snoozeUntil: null }, featureOn: true, ...over };
}

describe("off and opt-out", () => {
  it("the feature flag off wins over everything", () => {
    expect(evaluateBreak(input({ featureOn: false, heartbeats: beats(0, 200), now: at(200) }))).toEqual({ state: "off", reason: "feature-off" });
  });
  it("a person who turned break reminders off is never nudged", () => {
    expect(evaluateBreak(input({ prefs: { enabled: false, snoozeUntil: null }, heartbeats: beats(0, 200), now: at(200) }))).toEqual({ state: "off", reason: "opted-out" });
  });
});

describe("activity, gaps and the threshold", () => {
  it("no heartbeats → idle; last heartbeat 10 min ago → on a break", () => {
    expect(evaluateBreak(input())).toEqual({ state: "idle" });
    expect(evaluateBreak(input({ heartbeats: beats(0, 50), now: at(60) }))).toEqual({ state: "on-break", awayMs: 10 * MIN });
    expect(evaluateBreak(input({ heartbeats: beats(0, 50), now: at(59.9) })).state).toBe("active");
  });

  it("100 minutes exactly is not over the threshold; 101 is", () => {
    const st = evaluateBreak(input({ heartbeats: beats(0, 100), now: at(100) }));
    expect(st).toMatchObject({ state: "active", activeMs: 100 * MIN });
    expect(st.state === "active" && st.nudgeAt.toISOString()).toBe(new Date(at(100).getTime() + 1).toISOString());
    expect(evaluateBreak(input({ heartbeats: beats(0, 101), now: at(101) }))).toMatchObject({ state: "nudge", ordinal: 1, activeMs: 101 * MIN });
  });

  it("a gap of 10 minutes or more restarts the streak; 9 minutes does not", () => {
    const withBreak = [...beats(0, 60), ...beats(70, 140)]; // 10-min gap at 60 → 70
    expect(evaluateBreak(input({ heartbeats: withBreak, now: at(140) }))).toMatchObject({ state: "active", streakStart: at(70), activeMs: 70 * MIN });
    const noBreak = [...beats(0, 60), ...beats(69, 140)]; // 9-min gap
    expect(evaluateBreak(input({ heartbeats: noBreak, now: at(140) }))).toMatchObject({ state: "nudge", streakStart: at(0) });
  });

  it("sparse heartbeats under the gap still count as continuous", () => {
    expect(evaluateBreak(input({ heartbeats: beats(0, 108, 9), now: at(108) }))).toMatchObject({ state: "nudge", activeMs: 108 * MIN });
  });

  it("heartbeats in the future or beyond the lookback are ignored; order does not matter", () => {
    const old = at(-BREAK_POLICY.lookbackHours * 60 - 5);
    expect(evaluateBreak(input({ heartbeats: [at(5), old, at(500)], now: at(5) }))).toMatchObject({ state: "active", activeMs: 0 });
    expect(evaluateBreak(input({ heartbeats: [...beats(0, 101)].reverse(), now: at(101) })).state).toBe("nudge");
  });

  it("streakStart walks back while gaps stay short", () => {
    expect(streakStart([0, 5, 30, 35, 39].map((m) => m * MIN), 10 * MIN)).toBe(30 * MIN);
    expect(streakStart([7 * MIN], 10 * MIN)).toBe(7 * MIN);
  });
});

describe("after a nudge", () => {
  it("the next one waits another 100 minutes of the same streak", () => {
    const hb = beats(0, 250);
    expect(evaluateBreak(input({ heartbeats: hb.slice(0, 201), now: at(200), nudgesToday: [at(101)] }))).toMatchObject({ state: "active" });
    expect(evaluateBreak(input({ heartbeats: hb.slice(0, 203), now: at(202), nudgesToday: [at(101)] }))).toMatchObject({ state: "nudge", ordinal: 2 });
  });

  it("a nudge from an earlier streak does not hold back the new one, but counts towards today's 3", () => {
    const hb = [...beats(0, 101), ...beats(130, 232)];
    expect(evaluateBreak(input({ heartbeats: hb, now: at(232), nudgesToday: [at(101)] }))).toMatchObject({ state: "nudge", ordinal: 2, streakStart: at(130) });
  });

  it("at most 3 a day; yesterday's do not count", () => {
    const hb = beats(0, 420);
    const three = [at(101), at(202), at(303)];
    expect(evaluateBreak(input({ heartbeats: hb, now: at(420), nudgesToday: three }))).toMatchObject({ state: "limit" });
    const yesterday = [new Date(T0.getTime() - 20 * 60 * MIN)];
    expect(evaluateBreak(input({ heartbeats: hb.slice(0, 102), now: at(101), nudgesToday: yesterday }))).toMatchObject({ state: "nudge", ordinal: 1 });
  });
});

describe("snooze", () => {
  it("while snoozed nothing is raised; when it ends, the reminder comes back if the streak never broke", () => {
    const hb = beats(0, 200);
    const snooze = { enabled: true, snoozeUntil: at(131) };
    expect(evaluateBreak(input({ heartbeats: hb.slice(0, 121), now: at(120), nudgesToday: [at(101)], prefs: snooze }))).toEqual({ state: "snoozed", until: at(131) });
    expect(evaluateBreak(input({ heartbeats: hb.slice(0, 132), now: at(131), nudgesToday: [at(101)], prefs: snooze }))).toMatchObject({ state: "nudge", ordinal: 2 });
  });

  it("a break during the snooze starts a fresh streak", () => {
    const hb = [...beats(0, 101), ...beats(140, 160)];
    const st = evaluateBreak(input({ heartbeats: hb, now: at(160), nudgesToday: [at(101)], prefs: { enabled: true, snoozeUntil: at(131) } }));
    expect(st).toMatchObject({ state: "active", streakStart: at(140) });
  });

  it("an expired snooze set before the last nudge changes nothing", () => {
    const hb = beats(0, 150);
    expect(evaluateBreak(input({ heartbeats: hb, now: at(150), nudgesToday: [at(101)], prefs: { enabled: true, snoozeUntil: at(50) } }))).toMatchObject({ state: "active" });
  });
});

describe("copy", () => {
  it("is plain and gentle", () => {
    expect(formatActive(101 * MIN)).toBe("1 h 41 min");
    expect(formatActive(40 * MIN + 59_000)).toBe("40 min");
    expect(breakMessage(105 * MIN)).toBe("You have been working for about 1 h 45 min without a pause. A few minutes away from the screen may help.");
  });
});

describe("browser ping", () => {
  const base = { visible: true, lastInputAt: 1_000_000, lastSentAt: null, now: 1_000_000 };
  it("only while visible, after recent interaction, at most once a minute", () => {
    expect(shouldPing(base)).toBe(true);
    expect(shouldPing({ ...base, visible: false })).toBe(false);
    expect(shouldPing({ ...base, now: base.lastInputAt + RECENT_INPUT_MS + 1 })).toBe(false);
    expect(shouldPing({ ...base, lastSentAt: base.now - PING_INTERVAL_MS + 1 })).toBe(false);
    expect(shouldPing({ ...base, lastSentAt: base.now - PING_INTERVAL_MS })).toBe(true);
  });
});
