// Cycle-time math: stage split, median / p90 / bottleneck, grouping and display.
import type { JobTaskState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  STAGES,
  bottleneck,
  cycleTimes,
  formatDayKey,
  formatDuration,
  formatShare,
  median,
  parseCycleRange,
  percentile,
  summariseCycleTimes,
  type CycleEvent,
  type CycleJob,
  type CycleTimes,
} from "./cycle-time";
import { cycleTimes as fromHooks } from "./hooks";

const H = 3_600_000;
const T = (h: number) => new Date(Date.UTC(2026, 10, 2, 4, 30) + h * H);
const ev = (from: JobTaskState | null, to: JobTaskState, h: number, note: string | null = null): CycleEvent => ({ fromState: from, toState: to, createdAt: T(h), note });

/** ASSIGNED 0 → IN_PREP 2 → AGENT_DONE 5 → IN_REVIEW 6 → APPROVED 9 → FILED 10 → CLOSING 10 → DONE 12 */
const golden = [
  ev("DRAFT", "ASSIGNED", 0),
  ev("ASSIGNED", "IN_PREP", 2),
  ev("IN_PREP", "AGENT_DONE", 5),
  ev("AGENT_DONE", "IN_REVIEW", 6),
  ev("IN_REVIEW", "APPROVED", 9),
  ev("APPROVED", "FILED_BY_HUMAN", 10),
  ev("FILED_BY_HUMAN", "CLOSING", 10),
  ev("CLOSING", "DONE", 12),
];

const times = (over: Partial<CycleTimes>): CycleTimes => ({ assignedToDone: 0, queue: 0, prep: 0, review: 0, waitOnClient: 0, filing: 0, filingToDone: 0, done: true, ...over });

describe("cycleTimes", () => {
  it("splits a straight-through job into stages that add up to assigned → done", () => {
    const t = cycleTimes(golden);
    expect(t).toEqual({ assignedToDone: 12 * H, queue: 2 * H, prep: 4 * H, review: 3 * H, waitOnClient: 0, filing: 1 * H, filingToDone: 2 * H, done: true });
    expect(STAGES.reduce((n, s) => n + t[s], 0)).toBe(t.assignedToDone);
    expect(fromHooks).toBe(cycleTimes);
  });

  it("order of input does not matter; DRAFT time is not counted", () => {
    const shuffled = [golden[5], golden[0], golden[7], golden[2], golden[1], golden[4], golden[3], golden[6]];
    expect(cycleTimes([ev(null, "DRAFT", -5), ...shuffled])).toEqual(cycleTimes(golden));
  });

  it("time entered with a 'waiting on client' note counts as wait-on-client, not prep", () => {
    const t = cycleTimes([
      ev("DRAFT", "ASSIGNED", 0),
      ev("ASSIGNED", "IN_PREP", 1),
      ev("IN_PREP", "IN_REVIEW", 3),
      ev("IN_REVIEW", "IN_PREP", 4, "Waiting on client for the purchase register"),
      ev("IN_PREP", "IN_REVIEW", 28),
      ev("IN_REVIEW", "APPROVED", 29),
      ev("APPROVED", "FILED_BY_HUMAN", 30),
      ev("FILED_BY_HUMAN", "CLOSING", 30),
      ev("CLOSING", "DONE", 31),
    ]);
    expect(t).toMatchObject({ queue: 1 * H, prep: 2 * H, review: 2 * H, waitOnClient: 24 * H, filing: 1 * H, filingToDone: 1 * H, assignedToDone: 31 * H });
  });

  it.each([
    ["waiting for client docs", true],
    ["wait on the client", true],
    ["WAITING ON CLIENT", true],
    ["client waiting", false],
    ["awaiting review", false],
  ])("marker %s → %s", (note, waits) => {
    const t = cycleTimes([ev(null, "ASSIGNED", 0, note), ev("ASSIGNED", "IN_PREP", 1)]);
    expect(t.waitOnClient > 0).toBe(waits);
  });

  it("an open job has no assigned → done; its open interval runs to `until`", () => {
    const open = golden.slice(0, 5);
    expect(cycleTimes(open)).toMatchObject({ assignedToDone: null, done: false, filing: 0 });
    expect(cycleTimes(open, T(15))).toMatchObject({ filing: 6 * H });
  });

  it("a job created already assigned starts at its first event; an empty history is all zero", () => {
    expect(cycleTimes([ev(null, "IN_PREP", 0), ev("IN_PREP", "IN_REVIEW", 2), ev("CLOSING", "DONE", 5)]).assignedToDone).toBe(5 * H);
    expect(cycleTimes([])).toMatchObject({ assignedToDone: null, done: false, prep: 0 });
    expect(cycleTimes([ev("CLOSING", "DONE", 1)])).toMatchObject({ done: false, assignedToDone: null });
  });
});

describe("median / percentile", () => {
  it.each([
    [[], null, null],
    [[5], 5, 5],
    [[1, 2], 1.5, 2],
    [[3, 1, 2], 2, 3],
    [[1, 2, 3, 4], 2.5, 4],
    [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5.5, 9],
    [[10, 1, 9, 2, 8, 3, 7, 4, 6, 5, 100], 6, 10],
    [Array.from({ length: 20 }, (_, i) => i + 1), 10.5, 18],
  ])("%j → median %s, p90 %s", (values, med, p90) => {
    expect(median(values)).toBe(med);
    expect(percentile(values, 90)).toBe(p90);
  });

  it("percentile bounds", () => {
    expect(percentile([4, 2, 9], 0)).toBe(2);
    expect(percentile([4, 2, 9], 100)).toBe(9);
    expect(percentile([4, 2, 9], 50)).toBe(4);
  });
});

describe("bottleneck", () => {
  it.each([
    ["review dominates", [times({ prep: 1, review: 8, filing: 1 }), times({ prep: 2, review: 6, filing: 2 })], "review", 0.7],
    ["median, not mean: one huge wait does not win", [times({ prep: 6, waitOnClient: 4 }), times({ prep: 7, waitOnClient: 3 }), times({ prep: 0, waitOnClient: 100 })], "prep", 0.6],
    ["tie goes to the earlier stage", [times({ queue: 5, prep: 5 })], "queue", 0.5],
    ["filed to done", [times({ prep: 1, filingToDone: 3 })], "filingToDone", 0.75],
  ])("%s", (_n, rows, stage, share) => {
    const b = bottleneck(rows)!;
    expect(b.stage).toBe(stage);
    expect(b.share).toBeCloseTo(share, 5);
  });

  it("nothing to measure → null", () => {
    expect(bottleneck([])).toBeNull();
    expect(bottleneck([times({})])).toBeNull();
  });
});

describe("summariseCycleTimes", () => {
  const job = (id: string, service: string, who: string | null, client: string, totalH: number, over: Partial<CycleTimes> = {}): CycleJob => ({
    jobTaskId: id,
    service,
    assigneeId: who,
    assigneeName: who ? `Name ${who}` : null,
    clientCode: client,
    times: times({ assignedToDone: totalH * H, prep: totalH * H * 0.6, review: totalH * H * 0.4, ...over }),
  });
  const jobs = [
    job("1", "GST", "u1", "ACME01", 10),
    job("2", "GST", "u1", "ACME01", 20),
    job("3", "GST", "u2", "BETA02", 30, { review: 25 * H, prep: 5 * H }),
    job("4", "TDS", "u2", "BETA02", 4),
    job("5", "TDS", null, "ACME01", 8),
    job("open", "GST", "u1", "ACME01", 0, { done: false, assignedToDone: null }),
  ];
  const s = summariseCycleTimes(jobs);

  it("counts DONE jobs only, with median and p90 overall", () => {
    expect(s.overall).toMatchObject({ jobs: 5, medianMs: 10 * H, p90Ms: 30 * H });
    expect(s.overall.bottleneck?.stage).toBe("prep");
  });

  it("groups per service, person and client, largest groups first", () => {
    expect(s.byService.map((g) => [g.key, g.jobs, g.medianMs])).toEqual([
      ["GST", 3, 20 * H],
      ["TDS", 2, 6 * H],
    ]);
    expect(s.byPerson.map((g) => [g.label, g.jobs])).toEqual([
      ["Name u2", 2],
      ["Name u1", 2],
      ["Unassigned", 1],
    ]);
    expect(s.byPerson.find((g) => g.key === "u2")?.bottleneck?.stage).toBe("review");
    expect(s.byClient.map((g) => [g.key, g.jobs])).toEqual([
      ["ACME01", 3],
      ["BETA02", 2],
    ]);
  });

  it("stage table has every stage in order", () => {
    expect(s.stages.map((x) => x.stage)).toEqual([...STAGES]);
    expect(s.stages.find((x) => x.stage === "review")?.medianMs).toBe(4 * H);
  });

  it("an unknown assignee name and an empty input", () => {
    const u = summariseCycleTimes([{ ...jobs[0], assigneeName: null }]);
    expect(u.byPerson[0].label).toBe("Unknown person");
    expect(summariseCycleTimes([]).overall).toMatchObject({ jobs: 0, medianMs: null, p90Ms: null, bottleneck: null });
  });
});

describe("display helpers", () => {
  it.each([
    [null, "–"],
    [30_000, "under 1m"],
    [45 * 60_000, "45m"],
    [5 * H, "5h"],
    [5 * H + 20 * 60_000, "5h 20m"],
    [3 * 24 * H, "3d"],
    [3 * 24 * H + 4 * H + 59 * 60_000, "3d 4h"],
  ])("formatDuration(%s) = %s", (ms, label) => {
    expect(formatDuration(ms)).toBe(label);
  });

  it("formatShare and formatDayKey", () => {
    expect(formatShare(0.456)).toBe("46%");
    expect(formatDayKey("2026-11-05")).toBe("05 Nov 2026");
    expect(formatDayKey("bad")).toBe("bad");
  });

  it("parseCycleRange: default 90 days, swapped bounds, capped at a year", () => {
    const now = new Date("2026-11-05T20:00:00.000Z"); // 06 Nov 01:30 IST
    expect(parseCycleRange(undefined, undefined, now)).toMatchObject({ fromKey: "2026-08-09", toKey: "2026-11-06" });
    const r = parseCycleRange("2026-11-01", "2026-10-01", now);
    expect([r.fromKey, r.toKey]).toEqual(["2026-10-01", "2026-11-01"]);
    expect(r.to.toISOString()).toBe("2026-11-01T18:30:00.000Z");
    expect(parseCycleRange("2020-01-01", "2026-11-05", now).fromKey).toBe("2025-11-05");
  });
});
