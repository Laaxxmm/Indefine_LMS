import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { breachClocks, getBreach, listBreaches, recordBreach, updateBreach, type BreachDeps } from "./breach";
import { BREACH_CLOCKS } from "./policy";
import type { PrivacyDb } from "./inventory";
import { USERS } from "./__tests__/fixtures";
import { createMemoryDb, removalCalls, type MemoryDb } from "./__tests__/memory-db";

const HOUR = 3_600_000;
// 05 Nov 2026 10:00 IST
const DETECTED = new Date("2026-11-05T04:30:00.000Z");
const deps = (db: MemoryDb): BreachDeps => ({ db: db as unknown as PrivacyDb, now: () => new Date() });

function freshDb() {
  const db = createMemoryDb({ now: () => new Date() });
  db.seed("user", [{ id: USERS.admin.id, name: "Asha Admin", email: "asha@indefine.test", active: true }]);
  return db;
}

async function record(db: MemoryDb) {
  const r = await recordBreach(USERS.admin, { detectedAt: "2026-11-05T10:00", summary: "Laptop with client KYC scans lost in transit", severity: "high", affectedCount: 12 }, deps(db));
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

describe("breach register: the 72-hour clock (DPDP Rules 2025, legal to verify)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(DETECTED);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down 72 hours from when the firm became aware, then turns overdue", async () => {
    const db = freshDb();
    const id = await record(db);
    let [row] = await listBreaches(db as unknown as PrivacyDb, new Date());
    expect(row).toMatchObject({ id, status: "OPEN", severity: "high", affectedCount: 12, detectedLabel: "05 Nov 2026 10:00 IST" });
    expect(row.board).toMatchObject({ state: "due", hoursLeft: 72, text: "72 hours left", dueLabel: "08 Nov 2026 10:00 IST" });

    vi.advanceTimersByTime(70 * HOUR);
    [row] = await listBreaches(db as unknown as PrivacyDb, new Date());
    expect(row.board).toMatchObject({ state: "due", hoursLeft: 2, text: "2 hours left" });

    vi.advanceTimersByTime(1.5 * HOUR);
    [row] = await listBreaches(db as unknown as PrivacyDb, new Date());
    expect(row.board.text).toBe("Less than 1 hour left");

    vi.advanceTimersByTime(1 * HOUR);
    [row] = await listBreaches(db as unknown as PrivacyDb, new Date());
    expect(row.board).toMatchObject({ state: "overdue", hoursLeft: -1, text: "Overdue by 1 hour" });
    expect(row.principals.state).toBe("overdue");
  });

  it("stops each clock when its notice is recorded, and closes only after both", async () => {
    const db = freshDb();
    const id = await record(db);
    vi.advanceTimersByTime(30 * HOUR);
    const contained = await updateBreach(USERS.admin, id, { action: "contain", note: "Remote wipe triggered; passwords reset" }, deps(db));
    expect(contained).toMatchObject({ ok: true, data: { status: "CONTAINED" } });
    expect(await updateBreach(USERS.admin, id, { action: "close", note: "Closing before notices were sent" }, deps(db))).toMatchObject({ ok: false, status: 409 });

    const board = await updateBreach(USERS.admin, id, { action: "board-notified", at: "2026-11-06T15:30" }, deps(db));
    expect(board.ok && board.data.board).toMatchObject({ state: "done", hoursLeft: null, text: "Done 06 Nov 2026 15:30 IST" });
    expect(board.ok && board.data.status).toBe("CONTAINED");

    vi.advanceTimersByTime(50 * HOUR); // past 72 h: the board clock stays done, the people clock is overdue
    const late = await listBreaches(db as unknown as PrivacyDb, new Date());
    expect(late[0].board.state).toBe("done");
    expect(late[0].principals.state).toBe("overdue");

    const people = await updateBreach(USERS.admin, id, { action: "principals-notified", at: "2026-11-08T12:00" }, deps(db));
    expect(people.ok && people.data).toMatchObject({ status: "NOTIFIED", principals: { state: "done", text: "Done 08 Nov 2026 12:00 IST (late)" } });

    const closed = await updateBreach(USERS.admin, id, { action: "close", note: "All notices sent; laptop encryption made mandatory." }, deps(db));
    expect(closed).toMatchObject({ ok: true, data: { status: "CLOSED" } });
    expect(await updateBreach(USERS.admin, id, { action: "update", severity: "low" }, deps(db))).toMatchObject({ ok: false, status: 409 });

    const detail = await getBreach(db as unknown as PrivacyDb, id, new Date());
    expect(detail?.timeline.map((e) => e.label)).toEqual(["Incident recorded", "Containment step", "Data Protection Board told", "Affected people told", "Incident closed"]);
    expect(detail?.timeline[2]).toMatchObject({ actorName: "Asha Admin", detail: "Sent 06 Nov 2026 15:30 IST" });
    expect(removalCalls(db.calls)).toEqual([]);
  });

  it("refuses bad input with plain sentences", async () => {
    const db = freshDb();
    const bad: [Parameters<typeof recordBreach>[1], RegExp][] = [
      [{ detectedAt: "yesterday", summary: "Something happened here", severity: "high" }, /Enter when the firm became aware/],
      [{ detectedAt: "2026-11-06T10:00", summary: "Something happened here", severity: "high" }, /can't be in the future/],
      [{ detectedAt: "2026-11-05T09:00", summary: "short", severity: "high" }, /at least 10 characters/],
      [{ detectedAt: "2026-11-05T09:00", summary: "Something happened here", severity: "severe" }, /Pick a severity/],
      [{ detectedAt: "2026-11-05T09:00", summary: "Something happened here", severity: "low", affectedCount: -2 }, /whole number/],
    ];
    for (const [input, msg] of bad) {
      const r = await recordBreach(USERS.admin, input, deps(db));
      expect(r).toMatchObject({ ok: false, status: 400 });
      if (!r.ok) expect(r.error).toMatch(msg);
    }
    expect(await recordBreach(USERS.staff, { detectedAt: "2026-11-05T09:00", summary: "Something happened here", severity: "low" }, deps(db))).toMatchObject({ ok: false, status: 403 });
    const id = await record(db);
    expect(await updateBreach(USERS.admin, id, { action: "board-notified", at: "2026-11-05T09:00" }, deps(db))).toMatchObject({ ok: false, status: 400 });
    expect(await updateBreach(USERS.admin, id, { action: "contain", note: "done" }, deps(db))).toMatchObject({ ok: false, status: 400 });
    expect(await updateBreach(USERS.admin, id, { action: "update" }, deps(db))).toMatchObject({ ok: false, status: 400 });
    expect(await updateBreach(USERS.admin, "missing", { action: "update", severity: "low" }, deps(db))).toMatchObject({ ok: false, status: 404 });
    expect(await updateBreach(USERS.admin, id, { action: "update", severity: "medium", affectedCount: 40 }, deps(db))).toMatchObject({ ok: true, data: { severity: "medium", affectedCount: 40 } });
  });

  it("keeps the clock lengths and their legal caveats as data", () => {
    expect(BREACH_CLOCKS.board.hours).toBe(72);
    expect(BREACH_CLOCKS.board.verify).toMatch(/Legal to verify.*Do not treat this as settled law/);
    const c = breachClocks({ detectedAt: DETECTED, boardNotifiedAt: null, principalsNotifiedAt: null }, new Date(DETECTED.getTime() + 72 * HOUR));
    expect(c.board).toMatchObject({ state: "due", hoursLeft: 0 });
  });
});
