import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/access";
import { SpotCheckWorld } from "../../../tests/fakes/spot-check-world";
import { SPOT_CHECK_NOTE_MAX, listSpotChecks, markSpotChecked, type SpotCheckDb } from "./spot-checks";

// Compile-time: the app's Prisma client is what the page and route pass.
export const _prismaFits = (p: (typeof import("@/lib/prisma"))["prisma"]): SpotCheckDb => p;

const u = (id: string, o: { level?: string; role?: string; active?: boolean } = {}): SessionUser =>
  ({ id, role: "EMPLOYEE", level: "EXECUTIVE", department: "GENERAL", active: true, ...o }) as unknown as SessionUser;
const partner = u("u-partner", { level: "PARTNER" });
const NOW = new Date("2026-11-05T06:30:00Z");

describe("listSpotChecks", () => {
  it("partners only: staff, managers, admins (IT) and deactivated partners get 403", async () => {
    const w = new SpotCheckWorld();
    w.selected();
    for (const who of [u("u-priya"), u("u-mgr", { level: "MANAGER" }), u("u-it", { role: "ADMIN" }), u("u-p2", { level: "PARTNER", active: false }), null]) {
      expect(await listSpotChecks(w.db, who)).toMatchObject({ ok: false, status: 403 });
      expect(await markSpotChecked(w.db, who, "sync-1", null, NOW)).toMatchObject({ ok: false, status: 403 });
    }
    expect(w.syncs[0].spotChecked).toBe(false);
  });

  it("lists selected closes still to check (oldest first) with job, Turia ref, minutes and who confirmed; nothing selected → empty", async () => {
    expect(await listSpotChecks(new SpotCheckWorld().db, partner)).toEqual({ ok: true, data: { pending: [], checked: [] } });
    const w = new SpotCheckWorld();
    w.selected({ id: "s-late" }, new Date("2026-11-03T05:00:00Z"), { clientCode: "BETA02", title: "GSTR-1" });
    w.selected({ id: "s-early" }, new Date("2026-11-02T05:00:00Z"));
    const r = await listSpotChecks(w.db, partner);
    expect(r.ok && r.data.pending.map((p) => p.syncId)).toEqual(["s-early", "s-late"]);
    expect(r.ok && r.data.pending[0]).toEqual({
      syncId: "s-early",
      jobTaskId: "job-s-early",
      job: { title: "GSTR-3B", period: "2026-10", fy: "2026-27", service: "GST", clientCode: "ACME01" },
      turiaRef: "TT-4411",
      minutesLogged: 90,
      confirmedBy: "Priya Raman",
      selectedAt: "02 Nov 2026 10:30",
      checked: null,
    });
  });
});

describe("markSpotChecked", () => {
  it("records the check once (who, when, note) and writes a spot-check AuditEvent; then it moves to Checked", async () => {
    const w = new SpotCheckWorld();
    const id = w.selected();
    expect(await markSpotChecked(w.db, partner, id, "  Ref and 90 min match Turia  ", NOW)).toEqual({ ok: true, data: { syncId: id, checkedAt: NOW.toISOString() } });
    expect(w.syncs[0]).toMatchObject({ spotChecked: true, spotCheckedById: "u-partner", spotCheckedAt: NOW, spotCheckNote: "Ref and 90 min match Turia" });
    expect(w.audits.at(-1)).toMatchObject({ actorId: "u-partner", action: "spot-check", entity: "TuriaSync", entityId: id, meta: { jobTaskId: `job-${id}`, hasNote: true } });

    const list = await listSpotChecks(w.db, partner);
    expect(list.ok && list.data.pending).toEqual([]);
    expect(list.ok && list.data.checked[0].checked).toEqual({ by: "Lakshmanan A", at: "05 Nov 2026 12:00", note: "Ref and 90 min match Turia" });

    // A second check is refused and changes nothing.
    expect(await markSpotChecked(w.db, partner, id, "again", NOW)).toMatchObject({ ok: false, status: 409 });
    expect(w.syncs[0].spotCheckNote).toBe("Ref and 90 min match Turia");
    expect(w.audits.filter((a) => a.action === "spot-check")).toHaveLength(1);
  });

  it("an empty note is stored as none", async () => {
    const w = new SpotCheckWorld();
    const id = w.selected();
    await markSpotChecked(w.db, partner, id, "   ", NOW);
    expect(w.syncs[0].spotCheckNote).toBeNull();
    expect(w.audits.at(-1)?.meta).toMatchObject({ hasNote: false });
  });

  it("refuses a close that was not selected (404), a missing one (404) and an over-long note (400)", async () => {
    const w = new SpotCheckWorld();
    const id = w.selected();
    w.syncs.push({ ...w.syncs[0], id: "not-selected" });
    expect(await markSpotChecked(w.db, partner, "not-selected", null, NOW)).toMatchObject({ ok: false, status: 404, error: "This Turia close was not selected for a spot check" });
    expect(await markSpotChecked(w.db, partner, "missing", null, NOW)).toMatchObject({ ok: false, status: 404 });
    expect(await markSpotChecked(w.db, partner, id, "x".repeat(SPOT_CHECK_NOTE_MAX + 1), NOW)).toMatchObject({ ok: false, status: 400 });
    expect(w.syncs.every((s) => !s.spotChecked)).toBe(true);
  });
});
