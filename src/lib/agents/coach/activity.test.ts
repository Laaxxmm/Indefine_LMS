// Heartbeats, break nudges, dismissing and preferences over the in-memory world: nothing stored with
// the flag off or after opt-out, at most one heartbeat a minute, the nudge raised once (two tabs at
// once included), 3 a day, snooze and turn-off honoured at once, someone else's notice is 404.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoachWorld } from "../../../../tests/fakes/coach-world";
import { currentNudge, dismissEvent, loadPreferences, recordHeartbeat, updatePreferences } from "./activity";
import { isBreakNudgeEnabled } from "./flags";

const MIN = 60_000;
const T0 = new Date("2026-11-04T09:00:00+05:30");
const at = (min: number) => new Date(T0.getTime() + min * MIN);
const ON = { FIRM_OS_BREAK_NUDGE: "1" };

let w: CoachWorld;
const deps = (env: Record<string, string | undefined> = ON) => ({ db: w.db, env, now: () => new Date() });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  w = new CoachWorld();
  w.clock = () => new Date();
});
afterEach(() => vi.useRealTimers());

/** One heartbeat a minute for minutes [from, to]; returns the last answer. */
async function work(userId: string, from: number, to: number, env = ON) {
  let last = { recorded: false, nudge: null as { id: string; message: string } | null };
  for (let m = from; m <= to; m++) {
    vi.setSystemTime(at(m));
    last = await recordHeartbeat(userId, deps(env));
  }
  return last;
}

describe("flag", () => {
  it("FIRM_OS_BREAK_NUDGE defaults off", () => {
    expect(isBreakNudgeEnabled({})).toBe(false);
    expect(isBreakNudgeEnabled({ FIRM_OS_BREAK_NUDGE: "on" })).toBe(true);
    expect(isBreakNudgeEnabled({ FIRM_OS_BREAK_NUDGE: "0" })).toBe(false);
  });

  it("with the flag off nothing is stored and nothing is read", async () => {
    vi.setSystemTime(at(0));
    expect(await recordHeartbeat("u-priya", deps({}))).toEqual({ recorded: false, nudge: null });
    expect(w.activityHeartbeat.rows).toEqual([]);
  });
});

describe("heartbeats", () => {
  it("at most one stored per person per minute; each carries only who, when and source", async () => {
    vi.setSystemTime(at(0));
    expect((await recordHeartbeat("u-priya", deps())).recorded).toBe(true);
    vi.setSystemTime(new Date(at(0).getTime() + 30_000));
    expect((await recordHeartbeat("u-priya", deps())).recorded).toBe(false);
    vi.setSystemTime(new Date(at(1).getTime() - 4_000)); // 56 s later: within the 5 s tolerance
    expect((await recordHeartbeat("u-priya", deps())).recorded).toBe(true);
    expect(w.activityHeartbeat.rows).toHaveLength(2);
    expect(Object.keys(w.activityHeartbeat.rows[0]).sort()).toEqual(["at", "createdAt", "id", "source", "userId"]);
  });

  it("a person who turned break reminders off is not tracked at all", async () => {
    w.coachPreference.insert({ userId: "u-priya", breakNudges: false });
    expect(await work("u-priya", 0, 120)).toEqual({ recorded: false, nudge: null });
    expect(w.activityHeartbeat.rows).toEqual([]);
    expect(w.events("break")).toEqual([]);
  });
});

describe("break nudges", () => {
  it("raised once past 100 minutes of continuous work, shown until dismissed or 20 minutes old", async () => {
    expect((await work("u-priya", 0, 100)).nudge).toBeNull();
    const r = await work("u-priya", 101, 101);
    expect(r.nudge?.message).toMatch(/^You have been working for about 1 h 41 min without a pause\./);
    expect(w.events("break")).toEqual([expect.objectContaining({ userId: "u-priya", dedupeKey: "break:u-priya:2026-11-04:1", jobTaskId: null })]);
    expect((await work("u-priya", 102, 110)).nudge?.id).toBe(r.nudge?.id);
    expect(w.events("break")).toHaveLength(1);
    expect((await work("u-priya", 111, 125)).nudge).toBeNull(); // older than 20 minutes
    expect(w.auditEvent.rows).toEqual([]); // ADR-006: no lasting record of break activity
  });

  it("two tabs pinging at the same moment raise one nudge", async () => {
    await work("u-priya", 0, 100);
    vi.setSystemTime(at(101));
    await Promise.all([recordHeartbeat("u-priya", deps()), recordHeartbeat("u-priya", deps())]);
    expect(w.events("break")).toHaveLength(1);
  });

  it("no more than 3 a day", async () => {
    await work("u-priya", 0, 520);
    expect(w.events("break").map((e) => e.dedupeKey)).toEqual(["break:u-priya:2026-11-04:1", "break:u-priya:2026-11-04:2", "break:u-priya:2026-11-04:3"]);
  });

  it("snooze hides the nudge and holds the next one until it ends; turning off stops tracking at once", async () => {
    const first = await work("u-priya", 0, 101);
    vi.setSystemTime(at(101));
    expect(await updatePreferences("u-priya", { snoozeMinutes: 30 }, deps())).toMatchObject({ ok: true, data: { snoozeUntil: at(131).toISOString() } });
    expect((await work("u-priya", 102, 130)).nudge).toBeNull();
    const back = await work("u-priya", 131, 131);
    expect(back.nudge?.id).not.toBe(first.nudge?.id);
    expect(w.events("break")).toHaveLength(2);

    expect((await updatePreferences("u-priya", { breakNudges: false }, deps())).ok).toBe(true);
    const beats = w.activityHeartbeat.rows.length;
    expect(await work("u-priya", 132, 300)).toEqual({ recorded: false, nudge: null });
    expect(w.activityHeartbeat.rows).toHaveLength(beats);
  });

  it("a break of 10 minutes resets the clock", async () => {
    await work("u-priya", 0, 90);
    await work("u-priya", 100, 195);
    expect(w.events("break")).toEqual([]);
  });

  it("currentNudge ignores dismissed nudges", async () => {
    await work("u-priya", 0, 101);
    const id = String(w.events("break")[0].id);
    vi.setSystemTime(at(102));
    expect((await dismissEvent("u-priya", id, deps())).ok).toBe(true);
    expect(await currentNudge(w.db, "u-priya", at(102))).toBeNull();
  });
});

describe("dismiss", () => {
  it("only the owner can dismiss; someone else's id is not found; repeating is harmless", async () => {
    vi.setSystemTime(at(0));
    const e = w.coachEvent.insert({ userId: "u-priya", kind: "reminder", dedupeKey: "k1", payload: { message: "x" } });
    expect(await dismissEvent("u-meena", String(e.id), deps())).toEqual({ ok: false, status: 404, error: "Notice not found" });
    expect(await dismissEvent("u-priya", "nope", deps())).toMatchObject({ ok: false, status: 404 });
    const ok = await dismissEvent("u-priya", String(e.id), deps());
    expect(ok).toEqual({ ok: true, data: { id: e.id, dismissedAt: at(0).toISOString() } });
    vi.setSystemTime(at(5));
    expect(await dismissEvent("u-priya", String(e.id), deps())).toEqual(ok);
    expect(w.auditEvent.rows).toEqual([expect.objectContaining({ actorId: "u-priya", action: "dismiss", entity: "CoachEvent", entityId: e.id, meta: { kind: "reminder" } })]);
  });

  it("the audit row for a dismissed break nudge names no kind", async () => {
    vi.setSystemTime(at(0));
    const e = w.coachEvent.insert({ userId: "u-priya", kind: "break", dedupeKey: "b1", payload: { message: "x" } });
    await dismissEvent("u-priya", String(e.id), deps());
    expect(w.auditEvent.rows[0].meta).toBeUndefined();
  });
});

describe("preferences", () => {
  it("defaults on; changes are saved, audited and read back; an ended snooze reads as none", async () => {
    vi.setSystemTime(at(0));
    expect(await loadPreferences(w.db, "u-priya", at(0))).toEqual({ breakNudges: true, morningBoard: true, snoozeUntil: null });
    expect(await updatePreferences("u-priya", { morningBoard: false, snoozeMinutes: 60 }, deps())).toEqual({
      ok: true,
      data: { breakNudges: true, morningBoard: false, snoozeUntil: at(60).toISOString() },
    });
    expect(await loadPreferences(w.db, "u-priya", at(61))).toMatchObject({ snoozeUntil: null, morningBoard: false });
    expect(await updatePreferences("u-priya", { snoozeMinutes: 0 }, deps())).toMatchObject({ ok: true, data: { snoozeUntil: null } });
    expect(w.auditEvent.rows.map((a) => a.meta)).toEqual([{ morningBoard: false, snoozeMinutes: 60 }, { snoozeMinutes: 0 }]);
  });

  it("turning break reminders off also ends a snooze; on again works", async () => {
    vi.setSystemTime(at(0));
    await updatePreferences("u-priya", { snoozeMinutes: 30 }, deps());
    expect(await updatePreferences("u-priya", { breakNudges: false }, deps())).toMatchObject({ data: { breakNudges: false, snoozeUntil: null } });
    expect(await updatePreferences("u-priya", { breakNudges: true }, deps())).toMatchObject({ data: { breakNudges: true } });
  });

  it("refuses an unsupported snooze length and an empty change", async () => {
    expect(await updatePreferences("u-priya", { snoozeMinutes: 45 }, deps())).toEqual({ ok: false, status: 400, error: "Snooze for 30 or 60 minutes" });
    expect(await updatePreferences("u-priya", {}, deps())).toEqual({ ok: false, status: 400, error: "Nothing to change" });
    expect(w.coachPreference.rows).toEqual([]);
  });
});
