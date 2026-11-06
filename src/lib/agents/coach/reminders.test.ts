// Reminder scheduling (T−2h, T−30m before 18:00 IST on the internal due day) with fake timers, IST
// day boundaries, weekends, escalation at most once per job per day, and the split with the
// close-loop reconciler (the coach never touches filed jobs).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDayKey } from "@/lib/ist";
import { CoachWorld } from "../../../../tests/fakes/coach-world";
import { DEFAULT_CALENDAR } from "./config";
import { runCoachJob, runReminders } from "./cron";
import { dueReminderSlot, escalationMessage, escalationTarget, isInternalOverdue, reminderMessage, reminderSlots, slotLabel } from "./reminders";

const day = (k: string) => parseDayKey(k) as Date;
const ist = (k: string, hhmm: string) => new Date(`${k}T${hhmm}:00+05:30`);
const iso = (d: Date | undefined) => d?.toISOString();

describe("slots", () => {
  it("T−2h at 16:00 and T−30m at 17:30 IST on the due day; keys carry the due day", () => {
    const s = reminderSlots(day("2026-11-04"));
    expect(s.map((x) => [x.label, iso(x.at), x.key])).toEqual([
      ["T−2h", iso(ist("2026-11-04", "16:00")), "2026-11-04@t-120"],
      ["T−30m", iso(ist("2026-11-04", "17:30")), "2026-11-04@t-30"],
    ]);
    expect(iso(s[0].dueAt)).toBe(iso(ist("2026-11-04", "18:00")));
  });

  it.each([
    ["15:59", null],
    ["16:00", "T−2h"],
    ["17:29", "T−2h"],
    ["17:30", "T−30m"],
    ["17:59", "T−30m"],
    ["18:00", null],
    ["23:00", null],
  ])("at %s IST the slot is %s", (hhmm, want) => {
    expect(dueReminderSlot(day("2026-11-04"), ist("2026-11-04", hhmm))?.label ?? null).toBe(want);
  });

  it("a due date stored as UTC midnight is still that IST day", () => {
    const utcMidnight = new Date("2026-11-05T00:00:00.000Z"); // 05:30 IST Thu
    expect(dueReminderSlot(utcMidnight, ist("2026-11-05", "16:00"))?.key).toBe("2026-11-05@t-120");
    expect(dueReminderSlot(utcMidnight, ist("2026-11-04", "16:00"))).toBeNull();
  });

  it("a due date on Sunday reminds on Friday", () => {
    expect(reminderSlots(day("2026-11-08")).map((s) => iso(s.at))).toEqual([iso(ist("2026-11-06", "16:00")), iso(ist("2026-11-06", "17:30"))]);
  });

  it("offsets are data: duplicates and non-positive values are ignored; labels in hours or minutes", () => {
    expect(reminderSlots(day("2026-11-04"), { offsetsMin: [30, 90, 30, 0, -5] }).map((s) => s.label)).toEqual(["T−90m", "T−30m"]);
    expect(dueReminderSlot(day("2026-11-04"), ist("2026-11-04", "16:00"), { offsetsMin: [] })).toBeNull();
    expect(slotLabel(60)).toBe("T−1h");
  });

  it("overdue from the due moment", () => {
    expect(isInternalOverdue(day("2026-11-04"), ist("2026-11-04", "17:59"))).toBe(false);
    expect(isInternalOverdue(day("2026-11-04"), ist("2026-11-04", "18:00"))).toBe(true);
    expect(isInternalOverdue(day("2026-11-04"), ist("2026-11-04", "11:00"), { dueTime: { hour: 10, minute: 30 } })).toBe(true);
  });

  it("messages are plain and specific", () => {
    const [t2] = reminderSlots(day("2026-11-04"));
    expect(reminderMessage("GSTR-3B 2026-10 for ACME01", t2)).toBe("GSTR-3B 2026-10 for ACME01 is due internally today at 18:00 IST, in about 2 hours.");
    const t30 = reminderSlots(day("2026-11-04"))[1];
    expect(reminderMessage("X", t30)).toBe("X is due internally today at 18:00 IST, in about 30 minutes.");
    expect(reminderMessage("X", reminderSlots(day("2026-11-04"), { offsetsMin: [60] })[0])).toMatch(/about 1 hour\.$/);
    expect(escalationMessage("X", day("2026-11-03"), "IN_PREP", "Priya")).toBe("X passed its internal due date (03 Nov 2026) and is still IN_PREP with Priya.");
    expect(escalationMessage("X", day("2026-11-03"), "IN_PREP", null)).toBe("X passed its internal due date (03 Nov 2026) and is still IN_PREP.");
  });
});

describe("escalation target", () => {
  const managers: Record<string, string> = { "u-priya": "u-meena", "u-ravi": "u-meena", "u-solo": "u-solo" };
  const managerOf = (id: string) => managers[id] ?? null;
  it("reviewer, else engagement reviewer; the holder's manager when the reviewer holds the step; never the holder", () => {
    expect(escalationTarget({ reviewerId: "u-ravi" }, "u-priya", managerOf)).toBe("u-ravi");
    expect(escalationTarget({ reviewerId: null, engagement: { reviewerId: "u-anil" } }, "u-priya", managerOf)).toBe("u-anil");
    expect(escalationTarget({ reviewerId: "u-ravi" }, "u-ravi", managerOf)).toBe("u-meena");
    expect(escalationTarget({ reviewerId: null, engagement: null }, "u-solo", managerOf)).toBeNull();
    expect(escalationTarget({ reviewerId: null }, null, managerOf)).toBeNull();
    expect(escalationTarget({ reviewerId: "u-ravi" }, "u-priya", managerOf, (id) => id !== "u-ravi")).toBe("u-meena");
  });
});

// ------------------------------------------------------------------ cron with fake timers

function world() {
  const w = new CoachWorld();
  w.clock = () => new Date();
  w.addUser("u-priya", { name: "Priya S", managerId: "u-meena" });
  w.addUser("u-ravi", { name: "Ravi K", managerId: "u-meena" });
  w.addUser("u-meena", { name: "Meena R", level: "MANAGER" });
  return w;
}
const deps = (w: CoachWorld) => ({ db: w.db, now: () => new Date() });

/** Runs the reminders cron at every half hour from 09:00 to 19:00 IST on the given day. */
async function walkDay(w: CoachWorld, key: string) {
  for (let m = 9 * 60; m <= 19 * 60; m += 30) {
    vi.setSystemTime(ist(key, `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`));
    await runReminders(deps(w));
  }
}

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

describe("reminders cron", () => {
  it("a job due today: T−2h at 16:00, T−30m at 17:30, one escalation from 18:00 — however often the cron fires", async () => {
    const w = world();
    const job = w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-04") });
    await walkDay(w, "2026-11-04");
    const reminders = w.events("reminder");
    expect(reminders.map((e) => [e.userId, iso(e.createdAt as Date), (e.payload as { slot: string }).slot])).toEqual([
      ["u-priya", iso(ist("2026-11-04", "16:00")), "T−2h"],
      ["u-priya", iso(ist("2026-11-04", "17:30")), "T−30m"],
    ]);
    expect(reminders.map((e) => e.dedupeKey)).toEqual([`reminder:${job.id}:u-priya:2026-11-04@t-120`, `reminder:${job.id}:u-priya:2026-11-04@t-30`]);
    expect(reminders[0].payload).toMatchObject({ reason: "internal-due", state: "IN_PREP", message: "GSTR-3B 2026-10 for ACME01 is due internally today at 18:00 IST, in about 2 hours." });

    const esc = w.events("escalation");
    expect(esc).toHaveLength(1);
    expect(esc[0]).toMatchObject({ userId: "u-ravi", jobTaskId: job.id, dedupeKey: `escalation:${job.id}:2026-11-04` });
    expect(iso(esc[0].createdAt as Date)).toBe(iso(ist("2026-11-04", "18:00")));
    expect(esc[0].payload).toMatchObject({ reason: "internal-overdue", holderId: "u-priya", message: "GSTR-3B 2026-10 for ACME01 passed its internal due date (04 Nov 2026) and is still IN_PREP with Priya S." });
    expect(w.auditEvent.rows).toEqual([expect.objectContaining({ action: "escalate", entity: "JobTask", entityId: job.id, meta: { to: "u-ravi", reason: "internal-overdue", day: "2026-11-04" } })]);

    // Next working day: one more escalation, no more reminders.
    await walkDay(w, "2026-11-05");
    expect(w.events("reminder")).toHaveLength(2);
    expect(w.events("escalation").map((e) => e.dedupeKey)).toEqual([`escalation:${job.id}:2026-11-04`, `escalation:${job.id}:2026-11-05`]);
  });

  it("a late run sends only the latest slot, never two at once", async () => {
    const w = world();
    w.addJob({ state: "AGENT_DONE", internalDueOn: day("2026-11-04") });
    vi.setSystemTime(ist("2026-11-04", "17:40"));
    expect(await runReminders(deps(w))).toMatchObject({ reminders: 1 });
    expect(w.events("reminder").map((e) => (e.payload as { slot: string }).slot)).toEqual(["T−30m"]);
  });

  it("the reviewer is reminded while IN_REVIEW; overdue then goes to the manager", async () => {
    const w = world();
    w.addJob({ state: "IN_REVIEW", internalDueOn: day("2026-11-04") });
    vi.setSystemTime(ist("2026-11-04", "16:05"));
    await runReminders(deps(w));
    expect(w.events("reminder").map((e) => e.userId)).toEqual(["u-ravi"]);
    vi.setSystemTime(ist("2026-11-04", "18:05"));
    await runReminders(deps(w));
    expect(w.events("escalation").map((e) => e.userId)).toEqual(["u-meena"]);
  });

  it("weekends: due Sunday → reminded Friday; Saturday and Sunday runs do nothing", async () => {
    const w = world();
    w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-08") });
    await walkDay(w, "2026-11-06");
    expect(w.events("reminder").map((e) => iso(e.createdAt as Date))).toEqual([iso(ist("2026-11-06", "16:00")), iso(ist("2026-11-06", "17:30"))]);
    expect(w.events("escalation")).toHaveLength(1);
    for (const k of ["2026-11-07", "2026-11-08"]) {
      vi.setSystemTime(ist(k, "10:00"));
      expect(await runReminders(deps(w))).toMatchObject({ skipped: "outside-working-time" });
    }
    expect(w.events()).toHaveLength(3);
  });

  it("IST boundaries: nothing before 09:00 or from 19:00 IST, even when the UTC date already says tomorrow", async () => {
    const w = world();
    w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-05") });
    for (const t of [new Date("2026-11-04T18:30:00Z") /* Thu 00:00 IST */, ist("2026-11-05", "08:59"), ist("2026-11-05", "19:00")]) {
      vi.setSystemTime(t);
      expect(await runReminders(deps(w))).toMatchObject({ skipped: "outside-working-time" });
    }
    vi.setSystemTime(new Date("2026-11-05T10:30:00Z")); // Thu 16:00 IST
    expect(await runReminders(deps(w))).toMatchObject({ reminders: 1 });
  });

  it("a firm holiday (calendar data): no runs that day", async () => {
    const w = world();
    w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-03") });
    vi.setSystemTime(ist("2026-11-04", "10:00"));
    expect(await runReminders({ ...deps(w), calendar: { ...DEFAULT_CALENDAR, holidays: ["2026-11-04"] } })).toMatchObject({ skipped: "outside-working-time" });
    expect(w.events()).toEqual([]);
  });

  it("filed jobs belong to the close-loop reconciler: no coach reminder or escalation for FILED_BY_HUMAN / CLOSING (or DRAFT / DONE)", async () => {
    const w = world();
    for (const state of ["FILED_BY_HUMAN", "CLOSING", "DRAFT", "DONE"] as const) w.addJob({ state, internalDueOn: day("2026-11-03") });
    w.addJob({ state: "CLOSING", internalDueOn: day("2026-11-04") });
    for (const t of ["16:00", "17:30", "18:00"]) {
      vi.setSystemTime(ist("2026-11-04", t));
      expect(await runReminders(deps(w))).toMatchObject({ checked: 0, reminders: 0, escalations: 0 });
    }
    expect(w.events()).toEqual([]);
  });

  it("nobody to escalate to: recorded, nothing written; inactive holders get no reminder", async () => {
    const w = world();
    w.addUser("u-solo", { managerId: null });
    w.addUser("u-left", { active: false });
    const orphan = w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-03"), assigneeId: "u-solo", reviewerId: null, engagement: null });
    w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-04"), assigneeId: "u-left" });
    w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-04"), assigneeId: null });
    vi.setSystemTime(ist("2026-11-04", "16:00"));
    const s = await runReminders(deps(w));
    expect(s).toMatchObject({ checked: 3, reminders: 0, escalations: 0, unescalated: [orphan.id] });
    expect(w.events()).toEqual([]);
  });

  it("a due date far ahead is not even read", async () => {
    const w = world();
    w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-30") });
    vi.setSystemTime(ist("2026-11-04", "16:00"));
    expect(await runReminders(deps(w))).toMatchObject({ checked: 0 });
  });

  it("a later run skips nudges already sent with one read, not one failed insert each", async () => {
    const w = world();
    w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-04") });
    w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-03") });
    vi.setSystemTime(ist("2026-11-04", "16:00"));
    expect(await runReminders(deps(w))).toMatchObject({ reminders: 1, escalations: 1 });
    const inserts = vi.spyOn(w.db.coachEvent, "createMany");
    const reads = vi.spyOn(w.db.coachEvent, "findMany");
    vi.setSystemTime(ist("2026-11-04", "16:30"));
    expect(await runReminders(deps(w))).toMatchObject({ reminders: 0, escalations: 0 });
    expect(inserts).not.toHaveBeenCalled();
    expect(reads).toHaveBeenCalledTimes(1);
    expect(w.events("reminder")).toHaveLength(1);
    expect(w.events("escalation")).toHaveLength(1);
  });

  it("dedupeKey idempotency: two runs at the same moment write one reminder and one escalation", async () => {
    const w = world();
    w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-04") });
    w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-03") });
    vi.setSystemTime(ist("2026-11-04", "16:00"));
    const [a, b] = await Promise.all([runReminders(deps(w)), runCoachJob("reminders", deps(w))]);
    expect([a, b].map((x) => ("reminders" in x ? x.reminders + x.escalations : 0)).reduce((x, y) => x + y)).toBe(2);
    expect(w.events("reminder")).toHaveLength(1);
    expect(w.events("escalation")).toHaveLength(1);
    expect(w.auditEvent.rows).toHaveLength(1);
  });
});
