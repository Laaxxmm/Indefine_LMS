// Parked live sessions (Gemini gate): the admin list and "Mark reviewed" (an AuditEvent that
// un-parks nothing). Reasons are kinds, never values; one row per parked record.
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { ParkedDb } from "./parked";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

// Compile-time: the real Prisma client satisfies the narrow interface (the page casts it).
export const _prismaFits = (p: PrismaClient): ParkedDb => p;

const { PARKED_REVIEWED_ACTION, PARKED_WHAT_TO_DO, loadParkedItems, markParkedReviewed } = await import("./parked");
const { GEMINI_PARKED_ACTION, PARKED_MESSAGE } = await import("@/lib/auto-quiz").then(async (m) => ({ ...m, PARKED_MESSAGE: (await import("@/lib/ai/legacy-gate")).PARKED_MESSAGE }));

type Row = { id: string; actorId: string | null; action: string; entity: string; entityId: string | null; meta?: unknown; createdAt: Date };

function world() {
  const audits: Row[] = [];
  let t = Date.parse("2026-11-05T05:00:00Z");
  const at = () => new Date((t += 60_000));
  const park = (entity: string, entityId: string, reasons: string[]) =>
    audits.push({ id: `a${audits.length}`, actorId: "system:gemini-gate", action: GEMINI_PARKED_ACTION, entity, entityId, meta: { reasons, message: PARKED_MESSAGE }, createdAt: at() });
  const inList = (v: string | null, c?: { in: string[] }) => !c || (v !== null && c.in.includes(v));
  const db = {
    auditEvent: {
      create: async ({ data }: { data: Omit<Row, "id" | "createdAt"> }) => {
        audits.push({ id: `a${audits.length}`, ...data, createdAt: at() });
        return { id: `a${audits.length - 1}` };
      },
      findMany: async ({ where, orderBy }: { where: { action: string; entity?: { in: string[] }; entityId?: { in: string[] } }; orderBy?: { createdAt: "desc" | "asc" } }) => {
        const rows = audits.filter((a) => a.action === where.action && inList(a.entity, where.entity) && inList(a.entityId, where.entityId));
        return orderBy?.createdAt === "desc" ? [...rows].reverse() : rows;
      },
    },
    liveSession: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        [{ id: "ls-1", title: "GST refunds walk-through", startAt: new Date("2026-11-03T05:30:00Z"), recordedVideoId: "v-1" }, { id: "ls-2", title: "TDS basics", startAt: new Date("2026-11-04T05:30:00Z"), recordedVideoId: null }].filter((s) => where.id.in.includes(s.id)),
    },
    video: { findMany: async () => [] },
    user: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => [{ id: "u-admin", name: "Asha Admin", email: "asha@indefine.test" }].filter((u) => where.id.in.includes(u.id)) },
  };
  return { db, audits, park };
}

describe("parked live sessions", () => {
  it("lists each parked session once (latest parking), newest first, with reasons as kinds and the video page link", async () => {
    const w = world();
    w.park("LiveSession", "ls-1", ["PAN"]);
    w.park("LiveSession", "ls-2", ["numbers spoken as words"]);
    w.park("LiveSession", "ls-1", ["PAN", "phone"]); // parked again later
    const items = await loadParkedItems(w.db as never);
    expect(items.map((i) => [i.entityId, i.title, i.reasons, i.videoHref, i.reviewed])).toEqual([
      ["ls-1", "GST refunds walk-through", ["PAN", "phone"], "/admin/video/v-1", null],
      ["ls-2", "TDS basics", ["numbers spoken as words"], null, null],
    ]);
    expect(items[0].heldAt).toEqual(new Date("2026-11-03T05:30:00Z"));
  });

  it("Mark reviewed writes one AuditEvent by the admin, is idempotent, and un-parks nothing", async () => {
    const w = world();
    w.park("LiveSession", "ls-1", ["PAN"]);
    expect(await markParkedReviewed(w.db as never, "u-admin", "LiveSession", "ls-1")).toEqual({ ok: true, already: false });
    expect(await markParkedReviewed(w.db as never, "u-admin", "LiveSession", "ls-1")).toEqual({ ok: true, already: true });
    const reviews = w.audits.filter((a) => a.action === PARKED_REVIEWED_ACTION);
    expect(reviews).toEqual([expect.objectContaining({ actorId: "u-admin", entity: "LiveSession", entityId: "ls-1", meta: { parkedAt: expect.any(String) } })]);
    expect(w.audits.filter((a) => a.action === GEMINI_PARKED_ACTION)).toHaveLength(1); // still parked
    const [item] = await loadParkedItems(w.db as never);
    expect(item.reviewed).toEqual({ by: "Asha Admin", at: reviews[0].createdAt });
    // Parked again after the review: waiting for review again.
    w.park("LiveSession", "ls-1", ["phone"]);
    expect((await loadParkedItems(w.db as never))[0].reviewed).toBeNull();
  });

  it("refuses anything that is not a parked session, writing nothing", async () => {
    const w = world();
    w.park("LiveSession", "ls-1", ["PAN"]);
    for (const [entity, id] of [["LiveSession", "ls-2"], ["Client", "ls-1"], ["LiveSession", ""]]) {
      expect(await markParkedReviewed(w.db as never, "u-admin", entity, id)).toEqual({ ok: false, error: "That session is not on the parked list. Refresh the page and try again." });
    }
    expect(w.audits.filter((a) => a.action === PARKED_REVIEWED_ACTION)).toEqual([]);
  });

  it("the what-to-do text is plain sentences", () => {
    for (const s of PARKED_WHAT_TO_DO.split(/(?<=\.) /)) expect(s).toMatch(/^[A-Z].*\.$/);
    expect(PARKED_WHAT_TO_DO).not.toMatch(/gemini\.parked|AuditEvent|entity/i);
  });
});
