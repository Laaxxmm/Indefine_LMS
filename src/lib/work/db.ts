// Database operations for the tech work tracker. Every write runs in a transaction
// that also appends a WorkEvent, so the timeline is complete by construction.
// The rules themselves live in ./core.ts; this file only applies them.
import { Prisma, type WorkEventKind, type WorkStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AUTO_PAUSE_DAYS, PICK_CAP, PLAN_CAP, STALE_DAYS, WIP_CAP, WORK_STATUS_LABELS, autoDone, gateStep, keptPromise, nextStatus, precheckTaskIds, trackerEmails, wipAllows, wipAllowsMany, type Actor, type PickGroup, type Result, type TaskAction, type WorkAction } from "./core";
import { addDays, isWeekend, istDayKey, istDayStart, istMonthStart, istWeekStart } from "@/lib/ist";

type Tx = Prisma.TransactionClient;
const fail = (error: string): Result<never> => ({ ok: false, error });
function okr<T>(data: T): Result<T> {
  return { ok: true, data };
}
const NONE: Record<string, never> = {};

/** Append a timeline row. Human actions also bump lastTouchedAt; cron sweeps pass bump=false. */
export async function touch(
  tx: Tx,
  workId: string,
  e: { kind: WorkEventKind; taskId?: string; userId?: string | null; detail?: string | null },
  at: Date = new Date(),
  bump = true,
): Promise<void> {
  await tx.workEvent.create({
    data: { workId, taskId: e.taskId ?? null, userId: e.userId ?? null, kind: e.kind, detail: e.detail ?? null, at },
  });
  if (bump) await tx.work.update({ where: { id: workId }, data: { lastTouchedAt: at } });
}

export type TrackerUser = { id: string; email: string; name: string };

/** Tracker users in env order (lead first). Emails with no User row yet are skipped. */
export async function trackerUsers(): Promise<TrackerUser[]> {
  const emails = trackerEmails();
  if (emails.length === 0) return [];
  const rows = await prisma.user.findMany({
    where: { OR: emails.map((e) => ({ email: { equals: e, mode: "insensitive" as const } })) },
    select: { id: true, email: true, name: true },
  });
  return emails.flatMap((e) => {
    const u = rows.find((r) => r.email.toLowerCase() === e);
    return u ? [{ id: u.id, email: u.email, name: u.name ?? u.email }] : [];
  });
}

// ---------------- works ----------------

export async function createWork(input: { title: string; why?: string }, actor: Actor, now = new Date()): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const work = await tx.work.create({
      data: { title: input.title, why: input.why || null, ownerId: actor.id, createdById: actor.id },
      select: { id: true, title: true },
    });
    await touch(tx, work.id, { kind: "WORK_CREATED", userId: actor.id, detail: work.title }, now);
    return { id: work.id };
  });
}

const WIP_MESSAGE = `${WIP_CAP} works already active, pause or finish one first`;

/** Refuses when the owner already has WIP_CAP active works. */
async function wipCheck(tx: Tx, ownerId: string): Promise<string | null> {
  const active = await tx.work.count({ where: { ownerId, status: "ACTIVE" } });
  return wipAllows(active) ? null : WIP_MESSAGE;
}

export async function changeWorkStatus(
  workId: string,
  action: WorkAction,
  actor: Actor,
  reason?: string,
  now = new Date(),
): Promise<Result<{ status: WorkStatus }>> {
  const why = reason?.trim() ?? "";
  if (action === "obsolete" && !why) return fail("Give a reason for marking it obsolete");
  return prisma.$transaction(async (tx) => {
    const work = await tx.work.findUnique({ where: { id: workId } });
    if (!work) return fail("Work not found");
    if (!actor.isLead && work.ownerId !== actor.id) return fail("Only the owner or the lead can change this");
    const to = nextStatus(action, work.status);
    if (!to) return fail(`Cannot ${action} work that is ${WORK_STATUS_LABELS[work.status].toLowerCase()}`);
    if (to === "ACTIVE") {
      const wipError = await wipCheck(tx, work.ownerId);
      if (wipError) return fail(wipError);
    }
    await tx.work.update({
      where: { id: workId },
      data: {
        status: to,
        doneAt: to === "DONE" ? now : to === "ACTIVE" ? null : undefined,
        obsoleteReason: to === "OBSOLETE" ? why : action === "reopen" ? null : undefined,
      },
    });
    await touch(
      tx,
      workId,
      {
        kind: action === "reopen" ? "WORK_REOPENED" : "WORK_STATUS",
        userId: actor.id,
        detail: `${WORK_STATUS_LABELS[work.status]} → ${WORK_STATUS_LABELS[to]}${why ? `: ${why}` : ""}`,
      },
      now,
    );
    return okr({ status: to });
  });
}

// ---------------- tasks ----------------

export async function createTask(
  workId: string,
  input: { title: string; assigneeId: string },
  actor: Actor,
  now = new Date(),
): Promise<Result<{ id: string }>> {
  if (!actor.isLead && input.assigneeId !== actor.id) return fail("You can only add tasks for yourself");
  const users = await trackerUsers();
  if (!users.some((u) => u.id === input.assigneeId)) return fail("Assignee must be a tracker user");
  return prisma.$transaction(async (tx) => {
    const work = await tx.work.findUnique({ where: { id: workId }, select: { status: true, _count: { select: { tasks: true } } } });
    if (!work) return fail("Work not found");
    if (!actor.isLead && work.status !== "ACTIVE") return fail("Tasks can only be added to work that is Working");
    const task = await tx.workTask.create({
      data: { workId, title: input.title, assigneeId: input.assigneeId, createdById: actor.id, order: work._count.tasks },
      select: { id: true, title: true },
    });
    await touch(tx, workId, { kind: "TASK_CREATED", taskId: task.id, userId: actor.id, detail: task.title }, now);
    return okr({ id: task.id });
  });
}

/** done / drop / reopen / review. Also closes today's pick and may finish the work. */
export async function taskAction(taskId: string, action: TaskAction, actor: Actor, now = new Date()): Promise<Result<{ workDone: boolean }>> {
  const day = istDayStart(now);
  return prisma.$transaction(async (tx) => {
    const task = await tx.workTask.findUnique({ where: { id: taskId }, include: { work: { select: { status: true } } } });
    if (!task) return fail("Task not found");
    if (!actor.isLead && task.assigneeId !== actor.id) return fail("Not your task");
    const ev = (kind: WorkEventKind) => touch(tx, task.workId, { kind, taskId, userId: actor.id, detail: task.title }, now);

    switch (action) {
      case "done":
        if (task.status !== "TODO") return fail("Task is not open");
        await tx.workTask.update({ where: { id: taskId }, data: { status: "DONE", doneAt: now, reviewedAt: actor.isLead ? now : null } });
        await tx.dayPick.updateMany({ where: { taskId, day, outcome: null }, data: { outcome: "DONE" } });
        await ev("TASK_DONE");
        break;
      case "drop":
        if (!actor.isLead) return fail("Only the lead can drop a task");
        if (task.status !== "TODO") return fail("Task is not open");
        await tx.workTask.update({ where: { id: taskId }, data: { status: "DROPPED", doneAt: now } });
        await tx.dayPick.updateMany({ where: { taskId, outcome: null }, data: { outcome: "CARRIED" } });
        await ev("TASK_DROPPED");
        break;
      case "reopen":
        if (task.status === "TODO") return fail("Task is already open");
        if (task.work.status === "DONE" || task.work.status === "OBSOLETE") return fail("Reopen the work first");
        await tx.workTask.update({ where: { id: taskId }, data: { status: "TODO", doneAt: null, reviewedAt: null } });
        await ev("TASK_REOPENED");
        break;
      case "review":
        if (!actor.isLead) return fail("Only the lead reviews");
        if (task.status !== "DONE" || task.reviewedAt) return fail("Nothing to review");
        await tx.workTask.update({ where: { id: taskId }, data: { reviewedAt: now } });
        await ev("TASK_REVIEWED");
        break;
    }

    let workDone = false;
    if (task.work.status === "ACTIVE" && action !== "reopen") {
      const tasks = await tx.workTask.findMany({ where: { workId: task.workId }, select: { status: true, reviewedAt: true } });
      if (autoDone(tasks)) {
        await tx.work.update({ where: { id: task.workId }, data: { status: "DONE", doneAt: now } });
        await touch(tx, task.workId, { kind: "WORK_STATUS", userId: null, detail: "Working → Done, all tasks finished" }, now);
        workDone = true;
      }
    }
    return okr({ workDone });
  });
}

// ---------------- week plan ----------------

/** Replace the actor's plan for the current week. Lead may plan INBOX works, which activates them. */
export async function setWeekPlan(workIds: string[], actor: Actor, now = new Date()): Promise<Result> {
  const weekStart = istWeekStart(now);
  const ids = [...new Set(workIds)];
  if (ids.length > PLAN_CAP) return fail(`Pick at most ${PLAN_CAP} works for the week`);
  return prisma.$transaction(async (tx) => {
    const works = await tx.work.findMany({ where: { id: { in: ids } } });
    if (works.length !== ids.length) return fail("Unknown work");

    // First pass (no writes): validate every work, collecting Ideas that the lead is
    // activating. Any refusal here must happen before anything below is written.
    const toActivate: typeof works = [];
    for (const w of works) {
      if (w.status === "ACTIVE") continue;
      if (w.status === "INBOX" && actor.isLead) {
        toActivate.push(w);
        continue;
      }
      return fail(`"${w.title}" is ${WORK_STATUS_LABELS[w.status].toLowerCase()}, only Working items can be planned`);
    }
    const byOwner = new Map<string, typeof works>();
    for (const w of toActivate) {
      byOwner.set(w.ownerId, [...(byOwner.get(w.ownerId) ?? []), w]);
    }
    for (const [ownerId, group] of byOwner) {
      const active = await tx.work.count({ where: { ownerId, status: "ACTIVE" } });
      if (!wipAllowsMany(active, group.length)) return fail(`Only ${WIP_CAP} works can be active at once, ${active} already are`);
    }

    // Second pass: all checks passed, now write.
    for (const w of toActivate) {
      await tx.work.update({ where: { id: w.id }, data: { status: "ACTIVE", doneAt: null } });
      await touch(tx, w.id, { kind: "WORK_STATUS", userId: actor.id, detail: "Ideas → Working, added to the week plan" }, now);
    }
    const existing = await tx.weekPlanWork.findMany({ where: { userId: actor.id, weekStart }, select: { workId: true } });
    const have = new Set(existing.map((e) => e.workId));
    await tx.weekPlanWork.deleteMany({ where: { userId: actor.id, weekStart, workId: { notIn: ids } } });
    for (const id of ids) {
      if (have.has(id)) continue;
      await tx.weekPlanWork.create({ data: { userId: actor.id, weekStart, workId: id } });
      await touch(tx, id, { kind: "WEEK_PLANNED", userId: actor.id, detail: istDayKey(weekStart) }, now);
    }
    return okr(NONE);
  });
}

// ---------------- day picks ----------------

export async function addPicks(taskIds: string[], actor: Actor, now = new Date()): Promise<Result> {
  if (isWeekend(now)) return fail("No picks on weekends");
  const day = istDayStart(now);
  const weekStart = istWeekStart(now);
  const ids = [...new Set(taskIds)];
  return prisma.$transaction(async (tx) => {
    const existingPicks = await tx.dayPick.findMany({ where: { userId: actor.id, day }, select: { taskId: true } });
    const already = new Set(existingPicks.map((p) => p.taskId));
    const newIds = ids.filter((id) => !already.has(id));
    if (existingPicks.length + newIds.length > PICK_CAP) {
      return fail(`Only ${PICK_CAP} picks a day, ${existingPicks.length} already picked`);
    }
    if (newIds.length === 0) return okr(NONE);
    const tasks = await tx.workTask.findMany({
      where: { id: { in: newIds } },
      include: { work: { select: { status: true, title: true, weekPlans: { where: { userId: actor.id, weekStart }, select: { id: true } } } } },
    });
    if (tasks.length !== newIds.length) return fail("Unknown task");
    for (const t of tasks) {
      if (t.assigneeId !== actor.id) return fail(`"${t.title}" is not your task`);
      if (t.status !== "TODO") return fail(`"${t.title}" is not open`);
      if (t.work.status !== "ACTIVE") return fail(`"${t.work.title}" is not Working`);
      if (t.work.weekPlans.length === 0) return fail(`"${t.work.title}" is not in your plan this week`);
    }
    for (const t of tasks) {
      await tx.dayPick.create({ data: { userId: actor.id, day, taskId: t.id } });
      await touch(tx, t.workId, { kind: "PICKED", taskId: t.id, userId: actor.id, detail: t.title }, now);
    }
    return okr(NONE);
  });
}

// ---------------- review ----------------

export function staleWorksFor(ownerId: string, now = new Date()) {
  return prisma.work.findMany({
    where: { ownerId, status: "ACTIVE", lastTouchedAt: { lte: addDays(now, -STALE_DAYS) } },
    orderBy: { lastTouchedAt: "asc" },
    select: { id: true, title: true, lastTouchedAt: true },
  });
}

export async function completeReview(actor: Actor, now = new Date()): Promise<Result> {
  const weekStart = istWeekStart(now);
  const stale = await staleWorksFor(actor.id, now);
  if (stale.length > 0) return fail(`${stale.length} stale work${stale.length > 1 ? "s" : ""} still need a decision`);
  return prisma.$transaction(async (tx) => {
    const dup = await tx.weekReview.findUnique({ where: { userId_weekStart: { userId: actor.id, weekStart } } });
    if (dup) return okr(NONE);
    await tx.weekReview.create({ data: { userId: actor.id, weekStart, doneAt: now } });
    const plan = await tx.weekPlanWork.findMany({ where: { userId: actor.id, weekStart }, select: { workId: true } });
    for (const p of plan) await touch(tx, p.workId, { kind: "WEEK_REVIEWED", userId: actor.id, detail: istDayKey(weekStart) }, now);
    return okr(NONE);
  });
}

// ---------------- nightly close ----------------

/** Flip unfinished picks up to and including today to CARRIED (so a missed cron run
 *  cannot leave picks open forever) and auto-pause works untouched 28 days. */
export async function closeDay(now = new Date()): Promise<{ carried: number; paused: number }> {
  const day = istDayStart(now);
  const open = await prisma.dayPick.findMany({
    where: { day: { lte: day }, outcome: null, task: { status: "TODO" } },
    select: { id: true, taskId: true, userId: true, task: { select: { workId: true, title: true } } },
  });
  for (const p of open) {
    await prisma.$transaction(async (tx) => {
      await tx.dayPick.update({ where: { id: p.id }, data: { outcome: "CARRIED" } });
      await touch(tx, p.task.workId, { kind: "CARRIED", taskId: p.taskId, userId: p.userId, detail: p.task.title }, now, false);
    });
  }
  const tired = await prisma.work.findMany({
    where: { status: "ACTIVE", lastTouchedAt: { lte: addDays(now, -AUTO_PAUSE_DAYS) } },
    select: { id: true },
  });
  for (const w of tired) {
    await prisma.$transaction(async (tx) => {
      await tx.work.update({ where: { id: w.id }, data: { status: "PARKED" } });
      await touch(tx, w.id, { kind: "AUTO_PAUSED", userId: null, detail: `Untouched ${AUTO_PAUSE_DAYS} days` }, now, false);
    });
  }
  return { carried: open.length, paused: tired.length };
}

// ---------------- page queries ----------------

export async function gateState(userId: string, now = new Date()) {
  const weekStart = istWeekStart(now);
  const day = istDayStart(now);
  const [planned, picked, open, candidates] = await Promise.all([
    prisma.weekPlanWork.count({ where: { userId, weekStart } }),
    prisma.dayPick.count({ where: { userId, day } }),
    prisma.workTask.count({ where: { assigneeId: userId, status: "TODO", work: { status: "ACTIVE" } } }),
    prisma.workTask.count({
      where: { assigneeId: userId, status: "TODO", work: { status: "ACTIVE", weekPlans: { some: { userId, weekStart } } }, picks: { none: { userId, day } } },
    }),
  ]);
  const weekend = isWeekend(now);
  const flags = { weekend, hasOpenTasks: open > 0, planned: planned > 0, picked: picked > 0, hasCandidates: candidates > 0 };
  return { ...flags, pickCount: picked, step: gateStep(flags) };
}

/** Works the actor may put in a week plan: Working for everyone, plus Ideas for the lead. */
export function planCandidates(actor: Actor) {
  const statuses: WorkStatus[] = actor.isLead ? ["ACTIVE", "INBOX"] : ["ACTIVE"];
  return prisma.work.findMany({
    where: { status: { in: statuses } },
    orderBy: [{ status: "desc" }, { lastTouchedAt: "desc" }],
    select: { id: true, title: true, status: true, owner: { select: { name: true, email: true } } },
  });
}

/** The actor's open tasks in this week's planned Working items, not yet picked today, plus carried ids to pre-check. */
export async function pickCandidates(userId: string, now = new Date()): Promise<{ groups: PickGroup[]; precheck: string[] }> {
  const weekStart = istWeekStart(now);
  const day = istDayStart(now);
  const tasks = await prisma.workTask.findMany({
    where: {
      assigneeId: userId,
      status: "TODO",
      work: { status: "ACTIVE", weekPlans: { some: { userId, weekStart } } },
      picks: { none: { userId, day } },
    },
    orderBy: [{ work: { title: "asc" } }, { order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, work: { select: { id: true, title: true } } },
  });
  const last = await prisma.dayPick.findFirst({ where: { userId, day: { lt: day } }, orderBy: { day: "desc" }, select: { day: true } });
  const lastPicks = last
    ? await prisma.dayPick.findMany({ where: { userId, day: last.day }, select: { taskId: true, outcome: true, task: { select: { status: true } } } })
    : [];
  const precheck = precheckTaskIds(lastPicks.map((p) => ({ taskId: p.taskId, outcome: p.outcome, taskStatus: p.task.status })));
  const groups = new Map<string, PickGroup>();
  for (const t of tasks) {
    const g = groups.get(t.work.id) ?? { workId: t.work.id, workTitle: t.work.title, tasks: [] };
    g.tasks.push({ id: t.id, title: t.title });
    groups.set(t.work.id, g);
  }
  return { groups: [...groups.values()], precheck };
}

export function todayPicks(userId: string, now = new Date()) {
  return prisma.dayPick.findMany({
    where: { userId, day: istDayStart(now) },
    orderBy: { id: "asc" },
    select: { taskId: true, outcome: true, task: { select: { title: true, status: true, work: { select: { id: true, title: true } } } } },
  });
}

export async function weekStats(userId: string, weekStart: Date, now = new Date()) {
  const weekEnd = addDays(weekStart, 7);
  const [picks, shippedWeek, shippedMonth, stale, review] = await Promise.all([
    prisma.dayPick.findMany({ where: { userId, day: { gte: weekStart, lt: weekEnd } }, select: { outcome: true } }),
    prisma.work.count({ where: { ownerId: userId, status: "DONE", doneAt: { gte: weekStart, lt: weekEnd } } }),
    prisma.work.count({ where: { ownerId: userId, status: "DONE", doneAt: { gte: istMonthStart(now) } } }),
    staleWorksFor(userId, now),
    prisma.weekReview.findUnique({ where: { userId_weekStart: { userId, weekStart } } }),
  ]);
  return { kept: keptPromise(picks), shippedWeek, shippedMonth, stale, reviewed: !!review };
}

// ---------------- nudges ----------------

export async function usersMissingPick(now = new Date()): Promise<TrackerUser[]> {
  const day = istDayStart(now);
  const out: TrackerUser[] = [];
  for (const u of await trackerUsers()) {
    const [open, picks] = await Promise.all([
      prisma.workTask.count({ where: { assigneeId: u.id, status: "TODO", work: { status: "ACTIVE" } } }),
      prisma.dayPick.count({ where: { userId: u.id, day } }),
    ]);
    if (open > 0 && picks === 0) out.push(u);
  }
  return out;
}

export async function usersMissingReview(now = new Date()): Promise<TrackerUser[]> {
  const weekStart = istWeekStart(now);
  const users = await trackerUsers();
  const done = await prisma.weekReview.findMany({ where: { weekStart, userId: { in: users.map((u) => u.id) } }, select: { userId: true } });
  const doneIds = new Set(done.map((d) => d.userId));
  return users.filter((u) => !doneIds.has(u.id));
}
