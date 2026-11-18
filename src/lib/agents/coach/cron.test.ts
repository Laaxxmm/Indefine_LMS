// Coach crons over the in-memory world: windows, opt-outs and dedupeKey idempotency (a cron fired
// twice, or two runs at once, writes one event).
import { describe, expect, it } from "vitest";
import { parseDayKey } from "@/lib/ist";
import { CoachWorld } from "../../../../tests/fakes/coach-world";
import { DEFAULT_CALENDAR } from "./config";
import { boardMessage, isCoachJob, runCoachJob, runMorning } from "./cron";
import { buildBoard } from "./rank";

const day = (k: string) => parseDayKey(k) as Date;
const ist = (k: string, hhmm: string) => new Date(`${k}T${hhmm}:00+05:30`);
const WED_9 = ist("2026-11-04", "09:00");

function world() {
  const w = new CoachWorld();
  w.addUser("u-priya", { managerId: "u-meena" });
  w.addUser("u-ravi");
  w.addUser("u-meena", { level: "MANAGER" });
  w.addUser("u-gone", { active: false });
  w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-04"), assigneeId: "u-priya", reviewerId: "u-ravi" });
  w.addJob({ state: "IN_REVIEW", internalDueOn: day("2026-11-03"), assigneeId: "u-priya", reviewerId: "u-ravi" });
  w.addJob({ state: "ASSIGNED", internalDueOn: day("2026-11-20"), assigneeId: "u-gone" });
  w.addJob({ state: "CLOSING", assigneeId: "u-meena" });
  return w;
}

describe("morning board", () => {
  it("one board per person whose move it is; inactive people and filed-only people get none", async () => {
    const w = world();
    const s = await runMorning({ db: w.db, now: () => WED_9 });
    expect(s).toMatchObject({ people: 2, created: 2, existing: 0, boardOff: 0, channel: "in-app" });
    const boards = w.events("board");
    expect(boards.map((e) => e.userId).sort()).toEqual(["u-priya", "u-ravi"]);
    expect(boards.map((e) => e.dedupeKey).sort()).toEqual(["board:u-priya:2026-11-04", "board:u-ravi:2026-11-04"]);
    const ravi = boards.find((e) => e.userId === "u-ravi")?.payload as { message: string; mustToday: { reason: string }[]; channel: string };
    expect(ravi.message).toBe("Your board for 04 Nov 2026: 1 must today (1 past due), 0 this week.");
    expect(ravi.mustToday[0].reason).toBe("Internal due 03 Nov 2026 has passed");
    expect(w.auditEvent.rows).toEqual([expect.objectContaining({ actorId: "system:coach", action: "coach-board", meta: { day: "2026-11-04", created: 2 } })]);
  });

  it("is idempotent: fired twice, or twice at once, it writes each board once", async () => {
    const w = world();
    await runMorning({ db: w.db, now: () => WED_9 });
    const again = await runMorning({ db: w.db, now: () => ist("2026-11-04", "09:20") });
    expect(again).toMatchObject({ created: 0, existing: 2 });
    expect(w.events("board")).toHaveLength(2);
    expect(w.auditEvent.rows).toHaveLength(1);

    const w2 = world();
    const [a, b] = await Promise.all([runMorning({ db: w2.db, now: () => WED_9 }), runMorning({ db: w2.db, now: () => WED_9 })]);
    expect(a.created + b.created).toBe(2);
    expect(w2.events("board")).toHaveLength(2);
  });

  it("respects the person's 'morning board off' preference", async () => {
    const w = world();
    w.coachPreference.insert({ userId: "u-ravi", morningBoard: false });
    const s = await runMorning({ db: w.db, now: () => WED_9 });
    expect(s).toMatchObject({ people: 2, created: 1, boardOff: 1 });
    expect(w.events("board").map((e) => e.userId)).toEqual(["u-priya"]);
  });

  it("does nothing outside working time (weekend, holiday, before 09:00, from 19:00)", async () => {
    for (const now of [ist("2026-11-07", "09:00"), ist("2026-11-04", "08:59"), ist("2026-11-04", "19:00")]) {
      const w = world();
      expect(await runMorning({ db: w.db, now: () => now })).toMatchObject({ skipped: "outside-working-time", created: 0 });
      expect(w.events()).toEqual([]);
    }
    const w = world();
    const hol = { ...DEFAULT_CALENDAR, holidays: ["2026-11-04"] };
    expect(await runMorning({ db: w.db, now: () => WED_9, calendar: hol })).toMatchObject({ skipped: "outside-working-time" });
  });

  it("an empty firm writes nothing and audits nothing", async () => {
    const w = new CoachWorld();
    expect(await runMorning({ db: w.db, now: () => WED_9 })).toMatchObject({ people: 0, created: 0 });
    expect(w.auditEvent.rows).toEqual([]);
  });

  it("message for a quiet week", () => {
    const b = buildBoard([], WED_9);
    expect(boardMessage(b, "2026-11-04")).toBe("Your board for 04 Nov 2026: nothing due this week. 0 open jobs.");
    const one = buildBoard(
      [{ id: "j", title: "T", service: "Books", state: "IN_PREP", clientCode: "A", period: "p", fy: "f", internalDueOn: day("2026-12-31"), statutoryDueOn: null, role: "prepare", waitingOnMe: 0 }],
      WED_9,
    );
    expect(boardMessage(one, "2026-11-04")).toBe("Your board for 04 Nov 2026: nothing due this week. 1 open job.");
  });
});

describe("job dispatch", () => {
  it("knows its jobs", async () => {
    expect(isCoachJob("morning")).toBe(true);
    expect(isCoachJob("nope")).toBe(false);
    expect(isCoachJob(null)).toBe(false);
    const w = world();
    expect(await runCoachJob("morning", { db: w.db, now: () => WED_9 })).toMatchObject({ created: 2 });
  });
});
