// Weekly cycle-time summary: the pure figures (close-loop cycle-time functions), the Friday 16:00 IST
// cron (once per person per week), and who may read it: the person and their manager, never peers,
// and never anyone's break data.
import { describe, expect, it } from "vitest";
import type { JobTaskState } from "@prisma/client";
import { parseDayKey } from "@/lib/ist";
import { CoachWorld } from "../../../../tests/fakes/coach-world";
import { canViewCoachEvent } from "./access";
import { isSummaryTime, runCoachJob, runWeeklySummary } from "./cron";
import { weeklySummary } from "./summary";
import { loadCoachPage } from "./views";

const ist = (k: string, hhmm: string) => new Date(`${k}T${hhmm}:00+05:30`);
const day = (k: string) => parseDayKey(k) as Date;
const FRI_16 = ist("2026-11-06", "16:00");
const MON = day("2026-11-02");
const H = 60 * 60_000;

/** ASSIGNED at `start`, IN_PREP +1h, IN_REVIEW +prepH, APPROVED +reviewH, FILED +1h, CLOSING, DONE +1h. */
function history(start: Date, prepH: number, reviewH: number) {
  const t = (h: number) => new Date(start.getTime() + h * H);
  const steps: [JobTaskState | null, JobTaskState, number][] = [
    [null, "ASSIGNED", 0],
    ["ASSIGNED", "IN_PREP", 1],
    ["IN_PREP", "IN_REVIEW", 1 + prepH],
    ["IN_REVIEW", "APPROVED", 1 + prepH + reviewH],
    ["APPROVED", "FILED_BY_HUMAN", 2 + prepH + reviewH],
    ["FILED_BY_HUMAN", "CLOSING", 2 + prepH + reviewH],
    ["CLOSING", "DONE", 3 + prepH + reviewH],
  ];
  return steps.map(([fromState, toState, h]) => ({ fromState, toState, createdAt: t(h), note: null }));
}

describe("weeklySummary (pure)", () => {
  it("done count, median assignment → done, longest stage, open and past due", () => {
    const s = weeklySummary({
      weekStart: MON,
      done: [
        { id: "a", events: history(ist("2026-11-02", "10:00"), 2, 10) },
        { id: "b", events: history(ist("2026-11-03", "10:00"), 4, 20) },
      ],
      open: 5,
      overdue: 1,
    });
    expect(s).toMatchObject({ weekOf: "2026-11-02", done: 2, medianMs: 21 * H, open: 5, overdue: 1, bottleneck: { stage: "review", label: "Review" } });
    expect(s.message).toBe("Week of 02 Nov 2026: 2 jobs done; median from assignment to done 21h. Longest stage: Review (" + Math.round(s.bottleneck!.share * 100) + "% of a typical job). Open: 5, past internal due: 1.");
  });

  it("a quiet week says so; a job not DONE is not counted", () => {
    const open = history(ist("2026-11-02", "10:00"), 2, 2).slice(0, 3);
    const s = weeklySummary({ weekStart: MON, done: [{ id: "x", events: open }], open: 2, overdue: 0 });
    expect(s).toMatchObject({ done: 0, medianMs: null, bottleneck: null });
    expect(s.message).toBe("Week of 02 Nov 2026: no jobs reached DONE. Open: 2, past internal due: 0.");
    expect(weeklySummary({ weekStart: MON, done: [{ id: "a", events: history(ist("2026-11-02", "10:00"), 1, 1) }], open: 0, overdue: 0 }).message).toMatch(/: 1 job done;/);
  });
});

function world() {
  const w = new CoachWorld();
  w.addUser("u-meena", { name: "Meena R", level: "MANAGER" });
  w.addUser("u-priya", { name: "Priya S", managerId: "u-meena" });
  w.addUser("u-ravi", { name: "Ravi K", managerId: "u-meena" });
  w.addUser("u-anil", { name: "Anil P", managerId: "u-other" });
  w.addJob({ state: "DONE", assigneeId: "u-priya", doneAt: ist("2026-11-05", "12:00"), events: history(ist("2026-11-03", "10:00"), 3, 5) });
  w.addJob({ state: "DONE", assigneeId: "u-priya", doneAt: ist("2026-10-30", "12:00"), events: history(ist("2026-10-28", "10:00"), 3, 5) });
  w.addJob({ state: "IN_PREP", assigneeId: "u-priya", internalDueOn: day("2026-11-04") });
  w.addJob({ state: "CLOSING", assigneeId: "u-ravi" });
  w.addJob({ state: "DONE", assigneeId: "u-gone", doneAt: ist("2026-11-05", "12:00"), events: [] });
  return w;
}

describe("summary cron", () => {
  it("Friday from 16:00 IST only", () => {
    expect(isSummaryTime(FRI_16)).toBe(true);
    expect(isSummaryTime(ist("2026-11-06", "15:59"))).toBe(false);
    expect(isSummaryTime(ist("2026-11-05", "16:00"))).toBe(false);
  });

  it("one summary per person with jobs this week, once per week however often it runs", async () => {
    const w = world();
    const s = await runWeeklySummary({ db: w.db, now: () => FRI_16 });
    expect(s).toMatchObject({ weekOf: "2026-11-02", people: 2, created: 2 });
    const priya = w.events("summary").find((e) => e.userId === "u-priya");
    expect(priya).toMatchObject({ dedupeKey: "summary:u-priya:2026-11-02" });
    expect(priya?.payload).toMatchObject({ done: 1, open: 1, overdue: 1 });
    expect(w.events("summary").find((e) => e.userId === "u-ravi")?.payload).toMatchObject({ done: 0, open: 1, overdue: 0 });

    expect(await runCoachJob("summary", { db: w.db, now: () => ist("2026-11-06", "17:00") })).toMatchObject({ created: 0, existing: 2 });
    expect(w.events("summary")).toHaveLength(2);
    expect(w.auditEvent.rows.map((a) => a.action)).toEqual(["coach-summary"]);
  });

  it("not on other days or before 16:00", async () => {
    const w = world();
    expect(await runWeeklySummary({ db: w.db, now: () => ist("2026-11-06", "09:00") })).toMatchObject({ skipped: "not-friday-afternoon", created: 0 });
    expect(w.events()).toEqual([]);
  });
});

describe("who sees what", () => {
  it("the person sees their own events; the manager only the summary; peers and others nothing", () => {
    const summary = { userId: "u-priya", kind: "summary" };
    const brk = { userId: "u-priya", kind: "break" };
    const owner = { managerId: "u-meena" };
    expect(canViewCoachEvent({ id: "u-priya" }, brk, owner)).toBe(true);
    expect(canViewCoachEvent({ id: "u-meena" }, summary, owner)).toBe(true);
    expect(canViewCoachEvent({ id: "u-meena" }, brk, owner)).toBe(false);
    expect(canViewCoachEvent({ id: "u-meena" }, { userId: "u-priya", kind: "reminder" }, owner)).toBe(false);
    expect(canViewCoachEvent({ id: "u-ravi" }, summary, owner)).toBe(false);
    expect(canViewCoachEvent({ id: "u-meena" }, summary, { managerId: null })).toBe(false);
    expect(canViewCoachEvent(null, summary, owner)).toBe(false);
  });

  it("a manager's /coach shows each report's summary and none of their break data; a peer sees no one else's", async () => {
    const w = world();
    await runWeeklySummary({ db: w.db, now: () => FRI_16 });
    w.coachEvent.insert({ userId: "u-priya", kind: "break", dedupeKey: "break:u-priya:2026-11-06:1", payload: { message: "You have been working for about 1 h 41 min without a pause." } });
    w.activityHeartbeat.insert({ userId: "u-priya", at: FRI_16 });
    w.coachEvent.insert({ userId: "u-priya", kind: "reminder", dedupeKey: "r1", payload: { message: "Priya's reminder" } });

    const meena = await loadCoachPage(w.db, { id: "u-meena" }, ist("2026-11-06", "16:30"));
    expect(meena.team.map((t) => [t.name, t.summary?.weekOf ?? null])).toEqual([
      ["Priya S", "2026-11-02"],
      ["Ravi K", "2026-11-02"],
    ]);
    const all = JSON.stringify(meena);
    expect(all).not.toContain("without a pause");
    expect(all).not.toContain("Priya's reminder");
    expect(meena.notices).toEqual([]);

    const ravi = await loadCoachPage(w.db, { id: "u-ravi" }, ist("2026-11-06", "16:30"));
    expect(ravi.team).toEqual([]);
    expect(ravi.mySummary?.weekOf).toBe("2026-11-02");
    expect(JSON.stringify(ravi)).not.toContain("Priya");

    const priya = await loadCoachPage(w.db, { id: "u-priya" }, ist("2026-11-06", "16:30"));
    expect(priya.notices.map((n) => n.label)).toEqual(["Reminder"]);
    expect(priya.mySummary).toMatchObject({ done: 1 });
  });
});
