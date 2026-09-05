import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/work/actor";
import { PLAN_CAP, addDays, daysUntouched, istDayKey, istWeekStart, parseDayKey } from "@/lib/work/core";
import { gateState, planCandidates, trackerUsers, weekStats } from "@/lib/work/db";
import { WeekPanels, type Column } from "./WeekPanels";

export const dynamic = "force-dynamic";

// ?w=YYYY-MM-DD (any day) shows that IST week read-only. No param = current week.
export default async function WeekPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await currentActor();
  if (!actor) redirect("/");
  const now = new Date();
  const gate = await gateState(actor.id, now);
  if (gate.step !== "today") redirect("/work");

  const sp = await searchParams;
  const thisWeek = istWeekStart(now);
  const requested = parseDayKey(sp.w);
  const weekStart = requested ? istWeekStart(requested) : thisWeek;
  const isCurrent = weekStart.getTime() === thisWeek.getTime();
  const users = await trackerUsers();
  const myCandidates = isCurrent ? await planCandidates(actor) : [];

  const columns: Column[] = await Promise.all(
    users.map(async (u) => {
      const mine = u.id === actor.id;
      const [plan, stats] = await Promise.all([
        prisma.weekPlanWork.findMany({ where: { userId: u.id, weekStart }, include: { work: { select: { id: true, title: true, status: true } } } }),
        weekStats(u.id, weekStart, now),
      ]);
      return {
        user: { id: u.id, name: u.name },
        mine,
        plan: plan.map((p) => ({ id: p.work.id, title: p.work.title, status: p.work.status })),
        candidates: mine && isCurrent ? myCandidates.map((w) => ({ id: w.id, title: w.title, status: w.status, owner: w.owner.name ?? w.owner.email })) : null,
        kept: stats.kept,
        shippedWeek: stats.shippedWeek,
        shippedMonth: stats.shippedMonth,
        stale: stats.stale.map((s) => ({ id: s.id, title: s.title, days: daysUntouched(s.lastTouchedAt, now) })),
        reviewed: stats.reviewed,
      };
    }),
  );

  const label = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  const nav = "px-3 py-1.5 rounded-lg text-[12.5px] font-semibold text-ink-mute hover:bg-muted hover:text-ink";
  return (
    <div>
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Week</p>
          <h1 className="font-display font-extrabold text-3xl tracking-[-0.03em] mt-1">{label(weekStart)} – {label(addDays(weekStart, 6))}</h1>
          <p className="text-ink-mute text-[14px] mt-1">Plan on Monday, up to {PLAN_CAP} works each. Review on Friday: kept promises, shipped, stale.</p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/work/week?w=${istDayKey(addDays(weekStart, -7))}`} className={nav}>← Previous</Link>
          {!isCurrent && <Link href="/work/week" className={nav}>This week</Link>}
          {!isCurrent && <Link href={`/work/week?w=${istDayKey(addDays(weekStart, 7))}`} className={nav}>Next →</Link>}
        </div>
      </div>
      <WeekPanels columns={columns} isCurrent={isCurrent} cap={PLAN_CAP} />
    </div>
  );
}
