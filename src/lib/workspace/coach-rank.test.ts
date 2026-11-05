// The Daily Coach ranking as the next-task ranker: same order as the coach board for the same
// jobs, the coach's inputs taken from the candidate, and one plain sentence for the first job.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBoard, type RankInput } from "@/lib/agents/coach/rank";
import { DEFAULT_CALENDAR } from "@/lib/agents/coach/config";
import { coachRank, coachRankWith, coachReason, toRankInput } from "./coach-rank";
import type { NextTaskCandidate } from "./next-task";

const NOW = new Date("2026-11-05T05:30:00.000Z"); // Thursday 11:00 IST
const day = (s: string) => new Date(`${s}T00:00:00+05:30`);

function cand(id: string, over: Partial<NextTaskCandidate> = {}): NextTaskCandidate {
  return {
    id,
    state: "ASSIGNED",
    service: "GST",
    assigneeId: "u-priya",
    reviewerId: "u-ravi",
    title: `Job ${id}`,
    period: "2026-10",
    fy: "2026-27",
    internalDueOn: null,
    statutoryDueOn: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    clientCode: "ACME01",
    clientName: "Acme",
    latestRun: null,
    action: { kind: "run-agent", label: "Run agent", href: "/agents/gst", agent: "gst", runId: null },
    part: "Preparer",
    ...over,
  };
}
const ids = (ranked: ReturnType<typeof coachRank>) => ranked.map((r) => ("candidate" in r ? r.candidate.id : r.id));

afterEach(() => vi.unstubAllEnvs());

describe("toRankInput", () => {
  it("takes the coach's inputs from the candidate: dates, client, role from the action, people waiting", () => {
    const review = cand("r", { state: "IN_REVIEW", action: { kind: "review", label: "Review pack", href: "/agents/gst/runs/x", agent: "gst", runId: "x" }, part: "Reviewer" });
    expect(toRankInput(review)).toMatchObject({ id: "r", role: "review", waitingOnMe: 1, clientCode: "ACME01", service: "GST", state: "IN_REVIEW" });
    expect(toRankInput(cand("p", { internalDueOn: day("2026-11-10") }))).toMatchObject({ role: "prepare", waitingOnMe: 0, internalDueOn: day("2026-11-10") });
    // A reviewer reviewing their own pack keeps nobody else waiting.
    expect(toRankInput({ ...review, assigneeId: "u-ravi" }).waitingOnMe).toBe(0);
  });
});

describe("coachRank", () => {
  const set = [
    cand("later", { internalDueOn: day("2026-11-20"), statutoryDueOn: day("2026-11-25") }),
    cand("soon", { internalDueOn: day("2026-11-10"), statutoryDueOn: day("2026-11-12") }),
    cand("stat-overdue", { statutoryDueOn: day("2026-11-01") }),
    cand("int-overdue", { internalDueOn: day("2026-11-02"), statutoryDueOn: day("2026-11-11") }),
    cand("no-date"),
  ];

  it("orders jobs exactly as the coach board does (My day and /focus agree)", () => {
    const inputs: RankInput[] = set.map(toRankInput);
    const board = buildBoard(inputs, NOW, { calendar: DEFAULT_CALENDAR });
    expect(ids(coachRank(set, NOW))).toEqual(board.all.map((r) => r.id));
    expect(ids(coachRank(set, NOW))).toEqual(["stat-overdue", "int-overdue", "soon", "later", "no-date"]);
  });

  it("gives the first job one plain reason, only when there is a choice", () => {
    const ranked = coachRank(set, NOW) as unknown as { candidate: NextTaskCandidate; reason: string | null }[];
    expect(ranked[0].reason).toBe("It comes first because its statutory due date has passed.");
    expect(ranked.slice(1).every((r) => r.reason === null)).toBe(true);
    expect((coachRank([set[1]], NOW) as unknown as { reason: string | null }[])[0].reason).toBeNull();
    expect(coachReason({ overdue: "internal" })).toBe("It comes first because its internal due date has passed.");
    expect(coachReason({ overdue: null })).toMatch(/^It comes first on your board: .+\.$/);
  });

  it("a waiting reviewer's pack moves up (blocking others), as on the board", () => {
    const a = cand("a", { internalDueOn: day("2026-11-12") });
    const b = cand("b", {
      internalDueOn: day("2026-11-12"),
      state: "IN_REVIEW",
      action: { kind: "review", label: "Review pack", href: "/agents/gst/runs/y", agent: "gst", runId: "y" },
    });
    expect(ids(coachRank([a, b], NOW))).toEqual(["b", "a"]);
  });

  it("uses the firm calendar: FIRM_OS_HOLIDAYS counts like on the board; options pass through", () => {
    const x = cand("x", { internalDueOn: day("2026-11-09") }); // Monday
    vi.stubEnv("FIRM_OS_HOLIDAYS", "2026-11-06");
    expect(ids(coachRank([x], NOW))).toEqual(["x"]);
    const priority = coachRankWith({ clientPriority: { ZED01: 3 } });
    const low = cand("low", { internalDueOn: day("2026-11-12") });
    const high = cand("high", { internalDueOn: day("2026-11-12"), clientCode: "ZED01" });
    expect(ids(priority([low, high], NOW))).toEqual(["high", "low"]);
  });
});
