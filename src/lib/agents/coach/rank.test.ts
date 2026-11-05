// Ranking: statutory above internal, overdue first, deterministic ties, weekends and holidays when
// counting working days, the client-priority / blocking / penalty factors, and the board buckets.
import { describe, expect, it } from "vitest";
import { parseDayKey } from "@/lib/ist";
import { DEFAULT_CALENDAR, calendarFromEnv } from "./config";
import {
  buildBoard,
  compareRanked,
  proximityFactor,
  rankJobs,
  scoreJob,
  stepHolder,
  waitingOnHolder,
  type RankInput,
} from "./rank";
import { effectiveDueKey, internalDueMoment, isCoachWorkingTime, isWorkingDayKey, shiftDayKey, workingDaysBetween } from "./workdays";

// November 2026: Sun 01, Mon 02, Tue 03, Wed 04, Thu 05, Fri 06, Sat 07, Sun 08, Mon 09.
const day = (k: string) => parseDayKey(k) as Date;
/** IST wall clock → UTC instant. */
const ist = (k: string, hhmm: string) => new Date(`${k}T${hhmm}:00+05:30`);
const WED_9 = ist("2026-11-04", "09:00");

let n = 0;
function job(over: Partial<RankInput> = {}): RankInput {
  n += 1;
  return {
    id: `job-${String(n).padStart(3, "0")}`,
    title: "GSTR-3B",
    service: "Books",
    state: "IN_PREP",
    clientCode: "ACME01",
    period: "2026-10",
    fy: "2026-27",
    internalDueOn: null,
    statutoryDueOn: null,
    role: "prepare",
    waitingOnMe: 0,
    ...over,
  };
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("working days (IST, weekends and holidays skipped)", () => {
  it.each([
    ["2026-11-04", "2026-11-04", 0], // same day
    ["2026-11-04", "2026-11-05", 1], // Wed → Thu
    ["2026-11-06", "2026-11-09", 1], // Fri → Mon over the weekend
    ["2026-11-06", "2026-11-08", 0], // Fri → Sun: nothing working in between
    ["2026-11-09", "2026-11-06", -1], // Mon, due last Fri
    ["2026-11-09", "2026-11-07", -1], // Mon, due last Sat
    ["2026-11-02", "2026-11-13", 9], // two working weeks less a day
  ])("%s → %s = %i", (from, to, want) => {
    expect(workingDaysBetween(from, to, DEFAULT_CALENDAR)).toBe(want);
  });

  it("a holiday is not a working day", () => {
    const cal = { ...DEFAULT_CALENDAR, holidays: ["2026-11-05"] };
    expect(isWorkingDayKey("2026-11-05", cal)).toBe(false);
    expect(workingDaysBetween("2026-11-04", "2026-11-06", cal)).toBe(1);
    expect(workingDaysBetween("2026-11-06", "2026-11-04", cal)).toBe(-1);
  });

  it("a due date on a weekend or holiday moves back to the working day before (the planner's rule), at 18:00 IST", () => {
    expect(effectiveDueKey(day("2026-11-08"), DEFAULT_CALENDAR)).toBe("2026-11-06");
    const cal = { ...DEFAULT_CALENDAR, holidays: ["2026-11-06"] };
    expect(effectiveDueKey(day("2026-11-08"), cal)).toBe("2026-11-05");
    expect(internalDueMoment(day("2026-11-04"), DEFAULT_CALENDAR, { hour: 18, minute: 0 }).toISOString()).toBe(ist("2026-11-04", "18:00").toISOString());
  });

  it("coach working time: working day and 09:00 ≤ IST < 19:00", () => {
    expect(isCoachWorkingTime(ist("2026-11-04", "08:59"), DEFAULT_CALENDAR)).toBe(false);
    expect(isCoachWorkingTime(ist("2026-11-04", "09:00"), DEFAULT_CALENDAR)).toBe(true);
    expect(isCoachWorkingTime(ist("2026-11-04", "18:59"), DEFAULT_CALENDAR)).toBe(true);
    expect(isCoachWorkingTime(ist("2026-11-04", "19:00"), DEFAULT_CALENDAR)).toBe(false);
    expect(isCoachWorkingTime(ist("2026-11-07", "10:00"), DEFAULT_CALENDAR)).toBe(false); // Saturday
    expect(isCoachWorkingTime(ist("2026-11-07", "10:00"), { ...DEFAULT_CALENDAR, weekendDays: [0] })).toBe(true);
    expect(isCoachWorkingTime(ist("2026-11-05", "10:00"), { ...DEFAULT_CALENDAR, holidays: ["2026-11-05"] })).toBe(false);
  });

  it("shiftDayKey rejects a malformed key", () => {
    expect(shiftDayKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(() => shiftDayKey("31-12-2026", 1)).toThrow(/invalid day key/);
  });

  it("FIRM_OS_HOLIDAYS adds days; malformed entries are ignored", () => {
    expect(calendarFromEnv({}).holidays).toEqual([]);
    expect(calendarFromEnv({ FIRM_OS_HOLIDAYS: " 2026-11-14, nope ,2026-11-08,2026-11-14" }).holidays).toEqual(["2026-11-08", "2026-11-14"]);
  });
});

describe("proximity", () => {
  it("1 at or past the due day, falling with each working day, 0 without a date", () => {
    expect(proximityFactor(null)).toBe(0);
    expect(proximityFactor(-3)).toBe(1);
    expect(proximityFactor(0)).toBe(1);
    expect(proximityFactor(1)).toBe(0.5);
    expect(proximityFactor(3)).toBe(0.25);
  });
});

describe("statutory weighs more than internal", () => {
  it("statutory due in 2 working days outranks internal due in 2 working days", () => {
    const stat = job({ statutoryDueOn: day("2026-11-06") });
    const int = job({ internalDueOn: day("2026-11-06") });
    expect(ids(rankJobs([int, stat], WED_9))).toEqual([stat.id, int.id]);
    expect(scoreJob(stat, WED_9).factors.proximity).toBeCloseTo(2 / 3);
    expect(scoreJob(int, WED_9).factors.proximity).toBeCloseTo(1 / 3);
  });

  it("both dates add up; neither date still lists, last", () => {
    const both = job({ statutoryDueOn: day("2026-11-09"), internalDueOn: day("2026-11-06") });
    const none = job();
    const r = rankJobs([none, both], WED_9);
    expect(ids(r)).toEqual([both.id, none.id]);
    expect(r[0].factors.proximity).toBeCloseTo(2 / 4 + 1 / 3);
    expect(r[1]).toMatchObject({ bucket: "later", reason: "No due date set", score: 0.05 });
  });
});

describe("overdue ranks first", () => {
  it("statutory overdue, then internal overdue, then the rest, whatever the other factors", () => {
    const dueToday = job({ internalDueOn: day("2026-11-04"), statutoryDueOn: day("2026-11-05"), service: "GST", waitingOnMe: 1, clientPriority: 3 });
    const intOver = job({ internalDueOn: day("2026-11-03") });
    const statOver = job({ statutoryDueOn: day("2026-11-03"), internalDueOn: day("2026-10-30") });
    const r = rankJobs([dueToday, intOver, statOver], WED_9);
    expect(ids(r)).toEqual([statOver.id, intOver.id, dueToday.id]);
    expect(r.map((x) => x.tier)).toEqual([0, 1, 2]);
    expect(r[0]).toMatchObject({ overdue: "statutory", reason: "Statutory due 03 Nov 2026 has passed", bucket: "must-today" });
    expect(r[1]).toMatchObject({ overdue: "internal", reason: "Internal due 03 Nov 2026 has passed", internalDaysLeft: -1 });
  });

  it("internal due today is due until 18:00 IST, overdue from 18:00", () => {
    const j = job({ internalDueOn: day("2026-11-04") });
    expect(scoreJob(j, ist("2026-11-04", "17:59"))).toMatchObject({ tier: 2, overdue: null, bucket: "must-today", reason: "Internal due today" });
    expect(scoreJob(j, ist("2026-11-04", "18:00"))).toMatchObject({ tier: 1, overdue: "internal" });
  });

  it("statutory due today is not overdue until the day is over", () => {
    const j = job({ statutoryDueOn: day("2026-11-04"), service: "GST" });
    expect(scoreJob(j, ist("2026-11-04", "23:59"))).toMatchObject({ tier: 2, reason: "Statutory due 04 Nov 2026 (today)" });
    expect(scoreJob(j, ist("2026-11-05", "00:00"))).toMatchObject({ tier: 0 });
  });
});

describe("ties are deterministic", () => {
  it("equal scores: earlier statutory due, then client code, then id; input order never matters", () => {
    const a = job({ id: "b-2", clientCode: "ZED01", statutoryDueOn: day("2026-11-20"), internalDueOn: day("2026-11-10") });
    const b = job({ id: "b-1", clientCode: "ZED01", statutoryDueOn: day("2026-11-20"), internalDueOn: day("2026-11-10") });
    const c = job({ id: "a-9", clientCode: "ACME01", statutoryDueOn: day("2026-11-20"), internalDueOn: day("2026-11-10") });
    // Same working-day distance but a later statutory date (crosses no working day: Sat → Sun).
    const d = job({ id: "a-1", clientCode: "ACME01", statutoryDueOn: day("2026-11-22"), internalDueOn: day("2026-11-10") });
    expect(scoreJob(d, WED_9).score).toBe(scoreJob(c, WED_9).score);
    const want = [c.id, b.id, a.id, d.id];
    expect(ids(rankJobs([a, b, c, d], WED_9))).toEqual(want);
    expect(ids(rankJobs([d, c, b, a], WED_9))).toEqual(want);
    expect(ids(rankJobs([b, d, a, c], WED_9))).toEqual(want);
  });

  it("no statutory date sorts after one; identical rows compare equal", () => {
    const withStat = job({ id: "x-2", internalDueOn: day("2026-11-10"), statutoryDueOn: day("2026-12-31"), clientCode: "B" });
    const noStat = job({ id: "x-1", internalDueOn: day("2026-11-10"), clientCode: "A", clientPriority: 0.5 });
    const r = rankJobs([noStat, withStat], WED_9).map((x) => ({ ...x, score: 1 }));
    expect(compareRanked(r[0], r[1])).toBeLessThan(0);
    expect(compareRanked(r[0], r[0])).toBe(0);
  });
});

describe("holidays and weekends change the working-day count", () => {
  it("a Friday holiday brings Monday's due one working day closer", () => {
    const j = job({ internalDueOn: day("2026-11-09") });
    const thu = ist("2026-11-05", "09:00");
    expect(scoreJob(j, thu).internalDaysLeft).toBe(2);
    const hol = { calendar: { ...DEFAULT_CALENDAR, holidays: ["2026-11-06"] } };
    expect(scoreJob(j, thu, hol).internalDaysLeft).toBe(1);
    expect(scoreJob(j, thu, hol).score).toBeGreaterThan(scoreJob(j, thu).score);
  });

  it("internal due on a holiday is due (and overdue) on the working day before", () => {
    const j = job({ internalDueOn: day("2026-11-06") });
    const hol = { calendar: { ...DEFAULT_CALENDAR, holidays: ["2026-11-06"] } };
    expect(scoreJob(j, ist("2026-11-05", "09:00"), hol)).toMatchObject({ internalDaysLeft: 0, bucket: "must-today", tier: 2 });
    expect(scoreJob(j, ist("2026-11-05", "18:00"), hol)).toMatchObject({ tier: 1, overdue: "internal" });
    expect(scoreJob(j, ist("2026-11-05", "18:00"))).toMatchObject({ tier: 2, bucket: "this-week" });
  });

  it("internal due on Sunday is must-today on Friday and overdue from Friday 18:00", () => {
    const j = job({ internalDueOn: day("2026-11-08") });
    expect(scoreJob(j, ist("2026-11-06", "09:00"))).toMatchObject({ internalDaysLeft: 0, bucket: "must-today", tier: 2 });
    expect(scoreJob(j, ist("2026-11-06", "18:00"))).toMatchObject({ tier: 1 });
  });
});

describe("client priority, blocking-others and penalty risk", () => {
  const base = { internalDueOn: day("2026-11-10"), statutoryDueOn: day("2026-11-20") };

  it("client priority comes from data (default 1), clamped to 0.5–3", () => {
    const vip = job({ ...base, clientCode: "VIP01" });
    const plain = job({ ...base, clientCode: "AAA01" });
    const o = { clientPriority: { VIP01: 2 } };
    expect(ids(rankJobs([plain, vip], WED_9, o))).toEqual([vip.id, plain.id]);
    expect(scoreJob(plain, WED_9, o).factors.priority).toBe(1);
    expect(scoreJob(job({ ...base, clientCode: "VIP01", clientPriority: 10 }), WED_9).factors.priority).toBe(3);
    expect(scoreJob(job({ ...base, clientPriority: 0 }), WED_9).factors.priority).toBe(0.5);
  });

  it("a review someone is waiting on outranks the same job to prepare", () => {
    const prep = job({ ...base, clientCode: "AAA01" });
    const rev = job({ ...base, clientCode: "ZZZ01", role: "review", state: "IN_REVIEW", waitingOnMe: 1 });
    expect(ids(rankJobs([prep, rev], WED_9))).toEqual([rev.id, prep.id]);
    expect(scoreJob(rev, WED_9).factors.blocking).toBe(1.5);
  });

  it("penalty risk by service applies only with a statutory due date", () => {
    const gst = job({ ...base, service: "GST", clientCode: "ZZZ01" });
    const books = job({ ...base, service: "Books", clientCode: "AAA01" });
    expect(ids(rankJobs([books, gst], WED_9))).toEqual([gst.id, books.id]);
    expect(scoreJob(gst, WED_9).factors.penalty).toBe(1.5);
    expect(scoreJob(job({ service: "GST", internalDueOn: base.internalDueOn }), WED_9).factors.penalty).toBe(1);
    expect(scoreJob(gst, WED_9, { penaltyRisk: {} }).factors.penalty).toBe(1);
  });

  it("score is the product of the four factors", () => {
    const r = scoreJob(job({ ...base, service: "TDS", role: "review", state: "IN_REVIEW", waitingOnMe: 1, clientPriority: 2 }), WED_9);
    const f = r.factors;
    expect(r.score).toBeCloseTo(f.proximity * f.priority * f.blocking * f.penalty);
    expect(f).toMatchObject({ priority: 2, blocking: 1.5, penalty: 1.5 });
  });
});

describe("board", () => {
  it("top 5 'Must today' (overdue first), top 5 'This week', the rest later, with counts", () => {
    const must = Array.from({ length: 7 }, (_, i) => job({ internalDueOn: day(i < 2 ? "2026-11-03" : "2026-11-04"), clientCode: `M${i}` }));
    const week = [job({ internalDueOn: day("2026-11-06") }), job({ statutoryDueOn: day("2026-11-11") })];
    const later = [job({ internalDueOn: day("2026-11-30") }), job()];
    const b = buildBoard([...later, ...week, ...must], WED_9);
    expect(b.mustToday).toHaveLength(5);
    expect(b.mustTodayMore).toBe(2);
    expect(b.mustToday.slice(0, 2).every((r) => r.overdue === "internal")).toBe(true);
    expect(ids(b.thisWeek).sort()).toEqual(ids(week).sort());
    expect(b.thisWeekMore).toBe(0);
    expect(ids(b.later)).toEqual(ids(later));
    expect(b.all).toHaveLength(11);
    expect(b.counts).toEqual({ open: 11, overdue: 2, mustToday: 7, thisWeek: 2 });
  });

  it("statutory due the next working day is must-today; six working days away is later", () => {
    const fri = ist("2026-11-06", "09:00");
    const r1 = scoreJob(job({ statutoryDueOn: day("2026-11-09"), service: "GST" }), fri);
    expect(r1).toMatchObject({ statutoryDaysLeft: 1, bucket: "must-today", reason: "Statutory due 09 Nov 2026 (next working day)" });
    const r2 = scoreJob(job({ statutoryDueOn: day("2026-11-16") }), fri);
    expect(r2).toMatchObject({ statutoryDaysLeft: 6, bucket: "later", reason: "Statutory due 16 Nov 2026" });
    const r3 = scoreJob(job({ statutoryDueOn: day("2026-11-12"), internalDueOn: day("2026-11-10") }), fri);
    expect(r3).toMatchObject({ bucket: "this-week", reason: "Internal due 10 Nov 2026" });
    const r4 = scoreJob(job({ statutoryDueOn: day("2026-11-11"), internalDueOn: day("2026-11-12") }), fri);
    expect(r4.reason).toBe("Statutory due 11 Nov 2026");
  });

  it("an empty list is an empty board", () => {
    expect(buildBoard([], WED_9)).toMatchObject({ mustToday: [], thisWeek: [], later: [], counts: { open: 0, overdue: 0 } });
  });
});

describe("whose move it is", () => {
  it("reviewer while IN_REVIEW, assignee before filing, nobody after filing or when unset", () => {
    const j = { assigneeId: "u-a", reviewerId: "u-r" };
    expect(stepHolder({ ...j, state: "IN_REVIEW" })).toEqual({ userId: "u-r", role: "review" });
    for (const s of ["ASSIGNED", "IN_PREP", "AGENT_DONE", "APPROVED"] as const) expect(stepHolder({ ...j, state: s })).toEqual({ userId: "u-a", role: "prepare" });
    for (const s of ["DRAFT", "FILED_BY_HUMAN", "CLOSING", "DONE"] as const) expect(stepHolder({ ...j, state: s })).toBeNull();
    expect(stepHolder({ state: "IN_REVIEW", assigneeId: "u-a", reviewerId: null })).toBeNull();
    expect(stepHolder({ state: "IN_PREP", assigneeId: null, reviewerId: "u-r" })).toBeNull();
  });

  it("the preparer waits on a review by someone else", () => {
    expect(waitingOnHolder({ state: "IN_REVIEW", assigneeId: "u-a", reviewerId: "u-r" })).toBe(1);
    expect(waitingOnHolder({ state: "IN_REVIEW", assigneeId: "u-a", reviewerId: "u-a" })).toBe(0);
    expect(waitingOnHolder({ state: "IN_PREP", assigneeId: "u-a", reviewerId: "u-r" })).toBe(0);
  });
});
