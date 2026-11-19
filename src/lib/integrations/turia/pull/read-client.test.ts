// The read-only Turia client's parsing and error handling (the allowlist itself is guarded in
// tests/unit/turia-pull-readonly.test.ts), and the calendar wiring used for statutory due dates.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CALENDAR } from "@/lib/agents/core";
import { TuriaSessionError } from "@/lib/neo-centra/turia";
import { calendarDue } from "./defaults";
import { createTuriaReader } from "./read-client";

describe("taskPage", () => {
  it("returns task/list rows, and an empty page for Turia's 404 past the last page", async () => {
    const post = vi.fn(async (_e: string, _a: string, data?: Record<string, unknown>) => {
      if (data?.page === 3) throw new Error("Turia API error: 404 on task/list");
      return { tasks: { tasks: [{ id: 1 }] } };
    });
    const r = createTuriaReader(post);
    expect(await r.taskPage(1, 100, "createdon")).toEqual([{ id: 1 }]);
    expect(post.mock.calls[0][2]).toMatchObject({ page: 1, perPage: 100, sortColumn: "createdon", sort: "desc" });
    expect(await r.taskPage(3, 100, "createdon")).toEqual([]);
  });

  it("a 404 on the first page, or an expired sign-in, is not hidden", async () => {
    await expect(createTuriaReader(async () => Promise.reject(new Error("Turia API error: 404 on task/list"))).taskPage(1, 100, "createdon")).rejects.toThrow(/404/);
    await expect(createTuriaReader(async () => Promise.reject(new TuriaSessionError("expired"))).taskPage(2, 100, "createdon")).rejects.toBeInstanceOf(TuriaSessionError);
  });

  it("an odd answer is an empty page", async () => {
    expect(await createTuriaReader(async () => ({ tasks: "nope" })).taskPage(1, 100, "createdon")).toEqual([]);
    expect(await createTuriaReader(async () => ({})).taskPage(1, 100, "createdon")).toEqual([]);
  });
});

describe("orgUsers", () => {
  it("maps id, name and email; skips rows without an id", async () => {
    const r = createTuriaReader(async () => ({
      users: [{ id: 1, name: " Priya  S ", email: "PRIYA@x.test" }, { userId: "2", firstname: "Ravi", lastname: "K", email: "none" }, { name: "no id" }],
    }));
    expect(await r.orgUsers()).toEqual([
      { id: "1", name: "Priya S", email: "priya@x.test" },
      { id: "2", name: "Ravi K", email: null },
    ]);
    expect(await createTuriaReader(async () => ({ data: "x" })).orgUsers()).toEqual([]);
  });

  it("an error other than the sign-in gives an empty list (people then come from the task rows)", async () => {
    expect(await createTuriaReader(async () => Promise.reject(new Error("Turia API error: 500"))).orgUsers()).toEqual([]);
    await expect(createTuriaReader(async () => Promise.reject(new TuriaSessionError("expired"))).orgUsers()).rejects.toBeInstanceOf(TuriaSessionError);
  });
});

describe("taskMinutes", () => {
  it("sums the hours logged on the task, as minutes", async () => {
    const r = createTuriaReader(async () => ({ tasktimesheets: [{ totalhours: "1.5" }, { totalhours: "₹0.25" }, { totalhours: "-3" }, {}] }));
    expect(await r.taskMinutes("1")).toBe(105);
    expect(await createTuriaReader(async () => ({ tasktimesheets: [] })).taskMinutes("1")).toBeNull();
    expect(await createTuriaReader(async () => ({})).taskMinutes("1")).toBeNull();
  });
});

describe("calendarDue", () => {
  it("gives the statutory due date for a known calendar rule, null otherwise", () => {
    const due = calendarDue(DEFAULT_CALENDAR);
    expect(due("gstr-3b", "2026-27", "2026-10", "MONTHLY")).toBeInstanceOf(Date);
    expect(due("no-such-rule", "2026-27", "2026-10", "MONTHLY")).toBeNull();
    expect(due("gstr-3b", "2026-27", "Q9", "QUARTERLY")).toBeNull();
  });
});
