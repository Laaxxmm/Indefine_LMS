import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/work/actor";
import { awaitsReview, daysUntouched, eventLine, isStale, taskLane } from "@/lib/work/core";
import { istDayStart, istLabel } from "@/lib/ist";
import { gateState, trackerUsers } from "@/lib/work/db";
import { WorkDetail } from "./WorkDetail";

export const dynamic = "force-dynamic";

export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (!actor) redirect("/");
  const now = new Date();
  const gate = await gateState(actor.id, now);
  if (gate.step !== "today") redirect("/work");
  const { id } = await params;

  const [work, users] = await Promise.all([
    prisma.work.findUnique({
      where: { id },
      include: {
        owner: { select: { name: true, email: true } },
        tasks: {
          orderBy: [{ order: "asc" }, { createdAt: "asc" }],
          include: {
            assignee: { select: { name: true, email: true } },
            picks: { where: { day: istDayStart(now), outcome: null }, select: { id: true } },
          },
        },
        events: { orderBy: { at: "desc" }, take: 100, include: { user: { select: { name: true, email: true } } } },
      },
    }),
    trackerUsers(),
  ]);
  if (!work) notFound();

  const when = (d: Date) => istLabel(d, { day: "numeric", month: "short" });
  return (
    <WorkDetail
      work={{
        id: work.id,
        title: work.title,
        why: work.why,
        status: work.status,
        owner: work.owner.name ?? work.owner.email,
        obsoleteReason: work.obsoleteReason,
        days: daysUntouched(work.lastTouchedAt, now),
        stale: isStale(work.status, work.lastTouchedAt, now),
        canChange: actor.isLead || work.ownerId === actor.id,
      }}
      tasks={work.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assigneeId: t.assigneeId,
        assignee: t.assignee.name ?? t.assignee.email,
        lane: taskLane(t.status, t.picks.length > 0),
        awaitsReview: awaitsReview(t),
      }))}
      users={users.map((u) => ({ id: u.id, name: u.name }))}
      events={work.events.map((e) => ({
        id: e.id,
        line: eventLine({ kind: e.kind, detail: e.detail, actor: e.user ? (e.user.name ?? e.user.email) : null }),
        when: when(e.at),
      }))}
      isLead={actor.isLead}
      meId={actor.id}
    />
  );
}
