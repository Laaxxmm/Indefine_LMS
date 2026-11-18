// Live sessions parked by the Gemini gate (ADR-002, security audit #11), for the admin view at
// /admin/live/parked. When a session's recording or transcript mentions client details that
// masking cannot cover, the automatic quiz writes an AuditEvent `gemini.parked` (reasons as kinds,
// never values) and sends nothing; the cron then leaves the session alone for good.
//
// This module lists those events with the session (or video) they belong to and lets an admin mark
// one reviewed: an AuditEvent `gemini.parked-reviewed` on the same record. Marking reviewed does not
// un-park anything and sends nothing to Gemini; the quiz is then made by hand on the video page.
import { logAudit, type AuditDb } from "@/lib/audit/log";
import { GEMINI_PARKED_ACTION } from "@/lib/auto-quiz";

export const PARKED_REVIEWED_ACTION = "gemini.parked-reviewed";
const ENTITIES = ["LiveSession", "Video"] as const;
export type ParkedEntity = (typeof ENTITIES)[number];
const MAX_ROWS = 200;

type AuditRow = { id: string; entity: string; entityId: string | null; actorId: string | null; meta: unknown; createdAt: Date };

/** The Prisma reads and the one write this module makes (PrismaClient satisfies it). */
export interface ParkedDb extends AuditDb {
  auditEvent: AuditDb["auditEvent"] & {
    findMany(args: {
      where: { action: string; entity?: { in: string[] }; entityId?: { in: string[] } };
      orderBy?: { createdAt: "desc" | "asc" };
      take?: number;
      select: { id: true; entity: true; entityId: true; actorId: true; meta: true; createdAt: true };
    }): PromiseLike<AuditRow[]>;
  };
  liveSession: {
    findMany(args: { where: { id: { in: string[] } }; select: { id: true; title: true; startAt: true; recordedVideoId: true } }): PromiseLike<{ id: string; title: string; startAt: Date; recordedVideoId: string | null }[]>;
  };
  video: {
    findMany(args: { where: { id: { in: string[] } }; select: { id: true; title: true } }): PromiseLike<{ id: string; title: string }[]>;
  };
  user: {
    findMany(args: { where: { id: { in: string[] } }; select: { id: true; name: true; email: true } }): PromiseLike<{ id: string; name: string | null; email: string }[]>;
  };
}

export type ParkedItem = {
  entity: ParkedEntity;
  entityId: string;
  title: string;
  /** When the session took place (live sessions only). */
  heldAt: Date | null;
  parkedAt: Date;
  /** What could not be hidden, as kinds ("PAN", "numbers spoken as words"); never the values. */
  reasons: string[];
  /** Where to make the quiz by hand: the recording's video page, when there is one. */
  videoHref: string | null;
  reviewed: { by: string; at: Date } | null;
};

/** What to do with a parked session, in plain words. */
export const PARKED_WHAT_TO_DO =
  "Nothing was sent to Gemini and no quiz was made. Open the recording's video page, read the transcript, and add the quiz questions by hand, leaving out the client details. The automatic quiz will not try this session again. Mark it reviewed when you have dealt with it.";

const reasonsOf = (meta: unknown): string[] => {
  const r = (meta as { reasons?: unknown } | null)?.reasons;
  return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
};

/** Parked sessions and videos, newest first, each once (its latest parking), with its review if any. */
export async function loadParkedItems(db: ParkedDb): Promise<ParkedItem[]> {
  const events = await db.auditEvent.findMany({
    where: { action: GEMINI_PARKED_ACTION, entity: { in: [...ENTITIES] } },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
    select: { id: true, entity: true, entityId: true, actorId: true, meta: true, createdAt: true },
  });
  const latest = new Map<string, AuditRow>();
  for (const e of events) if (e.entityId && !latest.has(`${e.entity}:${e.entityId}`)) latest.set(`${e.entity}:${e.entityId}`, e);
  const rows = [...latest.values()];
  if (!rows.length) return [];
  const ids = rows.map((r) => r.entityId!);
  const sessionIds = rows.filter((r) => r.entity === "LiveSession").map((r) => r.entityId!);
  const videoIds = rows.filter((r) => r.entity === "Video").map((r) => r.entityId!);
  const [reviews, sessions, videos] = await Promise.all([
    db.auditEvent.findMany({
      where: { action: PARKED_REVIEWED_ACTION, entityId: { in: ids } },
      orderBy: { createdAt: "desc" },
      select: { id: true, entity: true, entityId: true, actorId: true, meta: true, createdAt: true },
    }),
    sessionIds.length ? db.liveSession.findMany({ where: { id: { in: sessionIds } }, select: { id: true, title: true, startAt: true, recordedVideoId: true } }) : Promise.resolve([]),
    videoIds.length ? db.video.findMany({ where: { id: { in: videoIds } }, select: { id: true, title: true } }) : Promise.resolve([]),
  ]);
  const reviewOf = new Map<string, AuditRow>();
  for (const r of reviews) if (r.entityId && !reviewOf.has(`${r.entity}:${r.entityId}`)) reviewOf.set(`${r.entity}:${r.entityId}`, r);
  const reviewers = [...new Set([...reviewOf.values()].map((r) => r.actorId).filter((x): x is string => !!x))];
  const people = reviewers.length ? await db.user.findMany({ where: { id: { in: reviewers } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(people.map((p) => [p.id, p.name ?? p.email]));
  const sessionOf = new Map(sessions.map((s) => [s.id, s]));
  const videoOf = new Map(videos.map((v) => [v.id, v]));

  return rows.map((e) => {
    const id = e.entityId!;
    const entity = e.entity as ParkedEntity;
    const s = entity === "LiveSession" ? sessionOf.get(id) : undefined;
    const v = entity === "Video" ? videoOf.get(id) : undefined;
    const videoId = s?.recordedVideoId ?? v?.id ?? null;
    const review = reviewOf.get(`${entity}:${id}`);
    // A review counts only when it came after the latest parking.
    const reviewed = review && review.createdAt >= e.createdAt ? { by: (review.actorId && nameOf.get(review.actorId)) || "an admin", at: review.createdAt } : null;
    return {
      entity,
      entityId: id,
      title: s?.title ?? v?.title ?? (entity === "LiveSession" ? "A live session that no longer exists" : "A video that no longer exists"),
      heldAt: s?.startAt ?? null,
      parkedAt: e.createdAt,
      reasons: reasonsOf(e.meta),
      videoHref: videoId ? `/admin/video/${videoId}` : null,
      reviewed,
    };
  });
}

export type MarkReviewedResult = { ok: true; already: boolean } | { ok: false; error: string };

export const NOT_PARKED = "That session is not on the parked list. Refresh the page and try again.";

/** One `gemini.parked-reviewed` AuditEvent for a parked record (nothing when it is not parked, or already reviewed since). */
export async function markParkedReviewed(db: ParkedDb, actorId: string, entity: string, entityId: string): Promise<MarkReviewedResult> {
  if (!(ENTITIES as readonly string[]).includes(entity) || !entityId) return { ok: false, error: NOT_PARKED };
  const items = await loadParkedItems(db);
  const item = items.find((i) => i.entity === entity && i.entityId === entityId);
  if (!item) return { ok: false, error: NOT_PARKED };
  if (item.reviewed) return { ok: true, already: true };
  await logAudit(db, { actorId, action: PARKED_REVIEWED_ACTION, entity, entityId, meta: { parkedAt: item.parkedAt.toISOString() } });
  return { ok: true, already: false };
}
