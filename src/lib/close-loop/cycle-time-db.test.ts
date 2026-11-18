// The cycle-time read: DONE jobs in range → CycleJob with names and stage times.
import { describe, expect, it, vi } from "vitest";
import { MAX_CYCLE_JOBS, loadCycleJobs, type CycleTimeDb } from "./cycle-time-db";

const T = (h: number) => new Date(Date.UTC(2026, 10, 2, 4, 30) + h * 3_600_000);
const FROM = new Date("2026-10-01T00:00:00Z");
const TO = new Date("2026-11-06T00:00:00Z");

function db(rows: unknown[], users = [{ id: "u-priya", name: "Priya Raman" }]) {
  const jobs = vi.fn(async () => rows);
  const people = vi.fn(async () => users);
  return { jobs, people, client: { jobTask: { findMany: jobs }, user: { findMany: people } } as unknown as CycleTimeDb };
}

describe("loadCycleJobs", () => {
  it("queries DONE jobs in [from, to) and maps them with assignee names and stage times", async () => {
    const d = db([
      {
        id: "j1",
        service: "GST",
        assigneeId: "u-priya",
        firmClient: { clientCode: "ACME01" },
        events: [
          { fromState: "DRAFT", toState: "ASSIGNED", createdAt: T(0), note: null },
          { fromState: "ASSIGNED", toState: "IN_PREP", createdAt: T(1), note: null },
          { fromState: "CLOSING", toState: "DONE", createdAt: T(5), note: "{}" },
        ],
      },
      { id: "j2", service: "TDS", assigneeId: null, firmClient: { clientCode: "BETA02" }, events: [] },
      { id: "j3", service: "TDS", assigneeId: "u-gone", firmClient: { clientCode: "BETA02" }, events: [] },
    ]);
    const r = await loadCycleJobs(FROM, TO, d.client);
    expect(d.jobs).toHaveBeenCalledWith(expect.objectContaining({ where: { state: "DONE", doneAt: { gte: FROM, lt: TO } }, take: MAX_CYCLE_JOBS }));
    expect(d.people).toHaveBeenCalledWith({ where: { id: { in: ["u-priya", "u-gone"] } }, select: { id: true, name: true } });
    expect(r.capped).toBe(false);
    expect(r.jobs[0]).toMatchObject({ jobTaskId: "j1", service: "GST", assigneeName: "Priya Raman", clientCode: "ACME01", times: { assignedToDone: 5 * 3_600_000, queue: 3_600_000, done: true } });
    expect(r.jobs[1]).toMatchObject({ assigneeId: null, assigneeName: null, times: { done: false } });
    expect(r.jobs[2].assigneeName).toBeNull();
  });

  it("skips the user lookup when nobody is assigned and reports the cap", async () => {
    const rows = Array.from({ length: MAX_CYCLE_JOBS }, (_, i) => ({ id: `j${i}`, service: "GST", assigneeId: null, firmClient: { clientCode: "ACME01" }, events: [] }));
    const d = db(rows);
    const r = await loadCycleJobs(FROM, TO, d.client);
    expect(d.people).not.toHaveBeenCalled();
    expect(r.capped).toBe(true);
  });
});
