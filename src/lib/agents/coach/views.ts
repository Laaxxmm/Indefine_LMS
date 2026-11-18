// Read model for /coach: the person's board, their undismissed notices (the coach's and the close
// loop's reminders and escalations, today's board), their latest weekly summary, the latest
// summaries of their direct reports (managers only), and their own preferences. Every query is
// scoped to the viewer; reports' rows are read by kind "summary" only, so no break data of anyone
// else is ever loaded (ADR-006).
import { formatDateTimeIst } from "@/lib/agents/core/format";
import { istDayStart } from "@/lib/ist";
import { canViewCoachEvent } from "./access";
import { loadPreferences, type PreferencesView } from "./activity";
import { loadBoard, type BoardLink, type BoardView } from "./board";
import { NOTICE_DAYS } from "./config";
import type { CoachDb } from "./db";
import type { RankOptions } from "./rank";
import type { WeeklySummary } from "./summary";

const DAY_MS = 24 * 60 * 60_000;
/** Summaries older than this are not shown (one missed Friday is still visible). */
export const SUMMARY_DAYS = 14;

export const NOTICE_LABELS: Record<string, string> = { board: "Morning board", reminder: "Reminder", escalation: "Escalation" };

export type NoticeView = { id: string; kind: string; label: string; message: string; at: string; link: BoardLink | null };
export type SummaryView = WeeklySummary & { at: string };
export type TeamSummaryView = { userId: string; name: string; summary: SummaryView | null };

export interface CoachPageData {
  board: BoardView;
  notices: NoticeView[];
  mySummary: SummaryView | null;
  /** Direct reports (User.managerId = viewer), each with their latest summary. Empty for non-managers. */
  team: TeamSummaryView[];
  prefs: PreferencesView;
}

const messageOf = (payload: unknown): string =>
  payload && typeof payload === "object" && typeof (payload as { message?: unknown }).message === "string" ? (payload as { message: string }).message : "";

function summaryOf(e: { payload: unknown; createdAt: Date } | undefined): SummaryView | null {
  if (!e || !e.payload || typeof e.payload !== "object") return null;
  const p = e.payload as WeeklySummary;
  if (typeof p.weekOf !== "string" || typeof p.message !== "string") return null;
  return { ...p, at: `${formatDateTimeIst(e.createdAt)} IST` };
}

export async function loadCoachPage(db: CoachDb, viewer: { id: string }, now: Date, opts?: Partial<RankOptions>): Promise<CoachPageData> {
  const [board, prefs] = await Promise.all([loadBoard(db, viewer.id, now, opts), loadPreferences(db, viewer.id, now)]);

  const noticeRows = await db.coachEvent.findMany({
    where: { userId: viewer.id, kind: { in: ["board", "reminder", "escalation"] }, dismissedAt: null, createdAt: { gte: new Date(now.getTime() - NOTICE_DAYS * DAY_MS) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, kind: true, jobTaskId: true, payload: true, createdAt: true },
    take: 50,
  });
  const links = new Map<string, BoardLink>([...board.all.map((r) => [r.id, r.link] as const), ...board.filed.map((r) => [r.id, r.link] as const)]);
  const today = istDayStart(now).getTime();
  const notices = noticeRows
    .filter((e) => e.kind !== "board" || e.createdAt.getTime() >= today)
    .map((e) => ({
      id: e.id,
      kind: e.kind,
      label: NOTICE_LABELS[e.kind] ?? e.kind,
      message: messageOf(e.payload),
      at: `${formatDateTimeIst(e.createdAt)} IST`,
      link: e.jobTaskId ? links.get(e.jobTaskId) ?? null : null,
    }));

  const since = new Date(now.getTime() - SUMMARY_DAYS * DAY_MS);
  const mine = await db.coachEvent.findFirst({
    where: { userId: viewer.id, kind: "summary", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { payload: true, createdAt: true },
  });

  const reports = await db.user.findMany({ where: { managerId: viewer.id, active: true }, select: { id: true, name: true, managerId: true }, orderBy: { name: "asc" } });
  let team: TeamSummaryView[] = [];
  if (reports.length > 0) {
    const rows = await db.coachEvent.findMany({
      where: { kind: "summary", userId: { in: reports.map((r) => r.id) }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { userId: true, kind: true, payload: true, createdAt: true },
    });
    const byOwner = new Map(reports.map((r) => [r.id, r]));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const e of rows) if (!latest.has(e.userId) && canViewCoachEvent(viewer, e, byOwner.get(e.userId) ?? null)) latest.set(e.userId, e);
    team = reports.map((r) => ({ userId: r.id, name: r.name ?? "Unnamed", summary: summaryOf(latest.get(r.id)) }));
  }

  return { board, notices, mySummary: summaryOf(mine ?? undefined), team, prefs };
}
