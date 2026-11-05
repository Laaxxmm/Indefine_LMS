// The person's own coach actions: activity heartbeats and break nudges, dismissing a notice, and
// their preferences (break reminders on/off, snooze, morning board on/off).
//
// ADR-006: heartbeats exist only to nudge the person. Nothing is stored while FIRM_OS_BREAK_NUDGE is
// off or after the person turns break reminders off; a heartbeat carries no data beyond who and
// when; the coach reads at most the last BREAK_POLICY.lookbackHours (≤ 7 days); heartbeats and
// break nudges are not written to AuditEvent (that would turn 7-day data into a permanent record)
// and no screen shows them to anyone but the person. The 7-day purge belongs to the Phase 11
// retention job.
import { istDayKey, istDayStart } from "@/lib/ist";
import { BREAK_POLICY, type BreakPolicy } from "./config";
import { breakMessage, evaluateBreak } from "./breaks";
import { audit, createOnce, dedupeKey, type CoachDb } from "./db";
import { isBreakNudgeEnabled } from "./flags";
import { canDismissCoachEvent } from "@/lib/rbac/policy";

type Env = Record<string, string | undefined>;

export type ActivityDeps = { db: CoachDb; now?: () => Date; env?: Env; policy?: BreakPolicy };

export type CoachResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

export type NudgeView = { id: string; message: string };

export type PreferencesView = { breakNudges: boolean; morningBoard: boolean; snoozeUntil: string | null };

const SEC = 1000;
const MIN = 60 * SEC;
/** Clock skew allowance: a ping that arrives a few seconds early is still "the next minute". */
const PING_TOLERANCE_MS = 5 * SEC;

function ctx(deps: ActivityDeps) {
  const policy = deps.policy ?? BREAK_POLICY;
  return { now: deps.now?.() ?? new Date(), policy, featureOn: isBreakNudgeEnabled(deps.env ?? process.env) };
}

const messageOf = (payload: unknown) => (payload && typeof payload === "object" && typeof (payload as { message?: unknown }).message === "string" ? (payload as { message: string }).message : "");

/** The break nudge to show now: today's latest, undismissed, raised within showForMin, not snoozed. */
export async function currentNudge(db: Pick<CoachDb, "coachEvent">, userId: string, now: Date, policy: BreakPolicy = BREAK_POLICY): Promise<NudgeView | null> {
  const since = Math.max(istDayStart(now).getTime(), now.getTime() - policy.showForMin * MIN);
  const e = await db.coachEvent.findFirst({
    where: { userId, kind: "break", dismissedAt: null, createdAt: { gte: new Date(since) } },
    orderBy: { createdAt: "desc" },
    select: { id: true, payload: true },
  });
  return e ? { id: e.id, message: messageOf(e.payload) } : null;
}

/**
 * One heartbeat from the person's browser. Stores it (at most one a minute), runs the break state
 * machine and raises the n-th nudge of the day once (dedupeKey break:<user>:<istDay>:<n>, so two
 * tabs pinging at once cannot raise two). Returns the nudge to show, if any.
 */
export async function recordHeartbeat(userId: string, deps: ActivityDeps): Promise<{ recorded: boolean; nudge: NudgeView | null }> {
  const { now, policy, featureOn } = ctx(deps);
  if (!featureOn) return { recorded: false, nudge: null };
  const db = deps.db;
  const pref = await db.coachPreference.findUnique({ where: { userId }, select: { breakNudges: true, snoozeUntil: true } });
  if (pref && !pref.breakNudges) return { recorded: false, nudge: null };

  const t = now.getTime();
  const recent = await db.activityHeartbeat.findFirst({
    where: { userId, at: { gt: new Date(t - policy.heartbeatMinIntervalSec * SEC + PING_TOLERANCE_MS), lte: now } },
    select: { id: true },
  });
  if (!recent) await db.activityHeartbeat.create({ data: { userId, at: now, source: "lms" }, select: { id: true } });

  const lookbackMs = Math.min(policy.lookbackHours * 60, policy.retentionDays * 24 * 60) * MIN;
  const beats = await db.activityHeartbeat.findMany({
    where: { userId, at: { gte: new Date(t - lookbackMs), lte: now } },
    select: { at: true },
    orderBy: { at: "asc" },
    take: 2000,
  });
  const today = await db.coachEvent.findMany({
    where: { userId, kind: "break", createdAt: { gte: istDayStart(now) } },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const st = evaluateBreak(
    { now, heartbeats: beats.map((b) => b.at), nudgesToday: today.map((e) => e.createdAt), prefs: { enabled: true, snoozeUntil: pref?.snoozeUntil ?? null }, featureOn },
    policy,
  );
  if (st.state === "nudge") {
    await createOnce(db, { userId, kind: "break", dedupeKey: dedupeKey.break(userId, istDayKey(now), st.ordinal), payload: { message: breakMessage(st.activeMs) } });
  }
  const snoozed = !!pref?.snoozeUntil && pref.snoozeUntil.getTime() > t;
  return { recorded: !recent, nudge: snoozed ? null : await currentNudge(db, userId, now, policy) };
}

/** Dismiss one of the person's own notices. Someone else's id is "not found". Idempotent. */
export async function dismissEvent(userId: string, eventId: string, deps: Pick<ActivityDeps, "db" | "now">): Promise<CoachResult<{ id: string; dismissedAt: string }>> {
  const now = deps.now?.() ?? new Date();
  const e = await deps.db.coachEvent.findUnique({ where: { id: eventId }, select: { id: true, userId: true, kind: true, dismissedAt: true } });
  if (!e || !canDismissCoachEvent({ id: userId }, e)) return { ok: false, status: 404, error: "Notice not found" };
  if (e.dismissedAt) return { ok: true, data: { id: e.id, dismissedAt: e.dismissedAt.toISOString() } };
  await deps.db.coachEvent.update({ where: { id: e.id }, data: { dismissedAt: now }, select: { id: true } });
  // A break nudge's audit row names no kind (ADR-006: no lasting trace of break activity).
  await audit(deps.db, { actorId: userId, action: "dismiss", entity: "CoachEvent", entityId: e.id, meta: e.kind === "break" ? undefined : { kind: e.kind } });
  return { ok: true, data: { id: e.id, dismissedAt: now.toISOString() } };
}

const view = (p: { breakNudges: boolean; morningBoard: boolean; snoozeUntil: Date | null } | null, now: Date): PreferencesView => ({
  breakNudges: p?.breakNudges ?? true,
  morningBoard: p?.morningBoard ?? true,
  snoozeUntil: p?.snoozeUntil && p.snoozeUntil.getTime() > now.getTime() ? p.snoozeUntil.toISOString() : null,
});

export async function loadPreferences(db: Pick<CoachDb, "coachPreference">, userId: string, now: Date): Promise<PreferencesView> {
  return view(await db.coachPreference.findUnique({ where: { userId }, select: { breakNudges: true, morningBoard: true, snoozeUntil: true } }), now);
}

export type PreferencesInput = { breakNudges?: boolean; morningBoard?: boolean; snoozeMinutes?: number };

/** Change the person's own preferences. snoozeMinutes 0 ends a snooze; turning break reminders off ends it too. */
export async function updatePreferences(userId: string, input: PreferencesInput, deps: Pick<ActivityDeps, "db" | "now" | "policy">): Promise<CoachResult<PreferencesView>> {
  const now = deps.now?.() ?? new Date();
  const policy = deps.policy ?? BREAK_POLICY;
  if (input.snoozeMinutes !== undefined && input.snoozeMinutes !== 0 && !policy.snoozeOptionsMin.includes(input.snoozeMinutes)) {
    return { ok: false, status: 400, error: `Snooze for ${policy.snoozeOptionsMin.join(" or ")} minutes` };
  }
  const data: { breakNudges?: boolean; morningBoard?: boolean; snoozeUntil?: Date | null } = {};
  if (input.breakNudges !== undefined) data.breakNudges = input.breakNudges;
  if (input.morningBoard !== undefined) data.morningBoard = input.morningBoard;
  if (input.snoozeMinutes !== undefined) data.snoozeUntil = input.snoozeMinutes ? new Date(now.getTime() + input.snoozeMinutes * MIN) : null;
  if (input.breakNudges === false) data.snoozeUntil = null;
  if (Object.keys(data).length === 0) return { ok: false, status: 400, error: "Nothing to change" };

  const saved = await deps.db.coachPreference.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: { breakNudges: true, morningBoard: true, snoozeUntil: true },
  });
  await audit(deps.db, { actorId: userId, action: "update", entity: "CoachPreference", entityId: userId, meta: { ...input } });
  return { ok: true, data: view(saved, now) };
}
