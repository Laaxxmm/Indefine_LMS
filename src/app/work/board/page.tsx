import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/work/actor";
import { daysUntouched, isStale } from "@/lib/work/core";
import { gateState } from "@/lib/work/db";
import { Board } from "./Board";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const actor = await currentActor();
  if (!actor) redirect("/");
  const now = new Date();
  const gate = await gateState(actor.id, now);
  if (gate.step !== "today") redirect("/work");

  const works = await prisma.work.findMany({
    orderBy: { lastTouchedAt: "desc" },
    select: {
      id: true, title: true, status: true, ownerId: true, lastTouchedAt: true,
      owner: { select: { name: true, email: true } },
      tasks: { where: { status: "TODO" }, select: { id: true } },
    },
  });
  const cards = works.map((w) => ({
    id: w.id,
    title: w.title,
    status: w.status,
    ownerId: w.ownerId,
    owner: w.owner.name ?? w.owner.email,
    openTasks: w.tasks.length,
    days: daysUntouched(w.lastTouchedAt, now),
    stale: isStale(w.status, w.lastTouchedAt, now),
  }));

  return (
    <div>
      <div className="mb-6">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Board</p>
        <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">All work</h1>
        <p className="text-ink-mute text-[14px] mt-1">Cards move themselves when you plan, finish tasks or go quiet. Drag or use the buttons to move one by hand.</p>
      </div>
      <Board cards={cards} isLead={actor.isLead} meId={actor.id} />
    </div>
  );
}
