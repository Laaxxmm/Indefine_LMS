// The person's board: which jobs are theirs (prepare vs review queue), links to the place the next
// step is done, filed jobs listed apart and unranked.
import { describe, expect, it } from "vitest";
import { parseDayKey } from "@/lib/ist";
import { CoachWorld } from "../../../../tests/fakes/coach-world";
import { WAITING_FOR_YOU, hasOpenJobs, linkFor, loadBoard, toRankInputs } from "./board";

const day = (k: string) => parseDayKey(k) as Date;
const WED_9 = new Date("2026-11-04T09:00:00+05:30");

describe("linkFor", () => {
  const run = { id: "run-9", agent: "gst" };
  it("prepare steps go to Waiting for you; pack steps open the latest run", () => {
    expect(linkFor("ASSIGNED", run)).toEqual({ href: WAITING_FOR_YOU, label: "Open in Waiting for you" });
    expect(linkFor("IN_PREP", null)).toEqual({ href: WAITING_FOR_YOU, label: "Open in Waiting for you" });
    expect(linkFor("AGENT_DONE", run)).toEqual({ href: "/agents/gst/runs/run-9", label: "Open pack to submit" });
    expect(linkFor("IN_REVIEW", run)).toEqual({ href: "/agents/gst/runs/run-9", label: "Review pack" });
    expect(linkFor("APPROVED", run)).toEqual({ href: "/agents/gst/runs/run-9", label: "Open pack to file" });
    expect(linkFor("CLOSING", run)).toEqual({ href: "/agents/gst/runs/run-9", label: "Open pack to close" });
    expect(linkFor("IN_REVIEW", null)).toEqual({ href: "/agents", label: "Open agent runs" });
  });
});

describe("loadBoard", () => {
  function world() {
    const w = new CoachWorld();
    const prep = w.addJob({ state: "IN_PREP", internalDueOn: day("2026-11-04"), assigneeId: "u-priya", reviewerId: "u-ravi" });
    const review = w.addJob({ state: "IN_REVIEW", internalDueOn: day("2026-11-06"), assigneeId: "u-ravi", reviewerId: "u-priya", firmClient: { clientCode: "BETA02", client: null } });
    const notMine = w.addJob({ state: "IN_REVIEW", internalDueOn: day("2026-11-04"), assigneeId: "u-priya", reviewerId: "u-ravi" });
    const filed = w.addJob({ state: "CLOSING", internalDueOn: day("2026-11-02"), assigneeId: "u-priya" });
    const done = w.addJob({ state: "DONE", assigneeId: "u-priya" });
    w.addRun(review.id, "gst", new Date("2026-11-03T05:00:00Z"));
    w.addRun(review.id, "gst", new Date("2026-11-03T06:00:00Z"));
    w.addRun(filed.id, "gst", new Date("2026-11-01T06:00:00Z"));
    return { w, prep, review, notMine, filed, done };
  }

  it("ranks the jobs where the next move is the person's, with parts, dates and links", async () => {
    const { w, prep, review, filed } = world();
    const b = await loadBoard(w.db, "u-priya", WED_9);
    expect(b.all.map((r) => r.id)).toEqual([prep.id, review.id]);
    expect(b.mustToday.map((r) => r.id)).toEqual([prep.id]);
    expect(b.thisWeek.map((r) => r.id)).toEqual([review.id]);
    expect(b.mustToday[0]).toMatchObject({ part: "Preparer", internalDue: "04 Nov 2026", statutoryDue: "—", clientName: "Acme Traders", link: { href: WAITING_FOR_YOU } });
    const latestReviewRun = w.agentRun.rows.filter((r) => r.jobTaskId === review.id).at(-1);
    expect(b.thisWeek[0]).toMatchObject({ part: "Reviewer", clientName: "", link: { href: `/agents/gst/runs/${latestReviewRun?.id}`, label: "Review pack" } });
    expect(b.filed).toEqual([expect.objectContaining({ id: filed.id, state: "CLOSING", link: expect.objectContaining({ label: "Open pack to close" }) })]);
    expect(b.counts).toMatchObject({ open: 2, mustToday: 1, thisWeek: 1 });
    expect(hasOpenJobs(b)).toBe(true);
  });

  it("a reviewer does not see a job still being prepared; nobody sees DONE jobs", async () => {
    const { w, notMine } = world();
    const ravi = await loadBoard(w.db, "u-ravi", WED_9);
    expect(ravi.all.map((r) => r.id)).toContain(notMine.id);
    expect(ravi.all.every((r) => r.state !== "IN_PREP")).toBe(true);
    expect(ravi.filed).toEqual([]);
    expect([...ravi.all, ...ravi.filed].some((r) => r.state === "DONE")).toBe(false);
  });

  it("someone with no Firm OS jobs has an empty board", async () => {
    const { w } = world();
    const b = await loadBoard(w.db, "u-nobody", WED_9);
    expect(hasOpenJobs(b)).toBe(false);
    expect(b.counts.open).toBe(0);
  });

  it("toRankInputs marks the review someone is waiting on", () => {
    const { w } = world();
    const rows = w.jobTask.rows as unknown as Parameters<typeof toRankInputs>[0];
    const inputs = toRankInputs(rows, "u-priya");
    expect(inputs.map((i) => [i.role, i.waitingOnMe])).toEqual([
      ["prepare", 0],
      ["review", 1],
    ]);
  });
});
