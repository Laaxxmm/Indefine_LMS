import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { loadTeam } from "@/lib/coaching";
import { TIER_META } from "@/lib/trajectory";
import TrajectoryRings from "../dashboard/TrajectoryRings";
import {
  ArrowLeft,
  LogOut,
  Users,
  AlertCircle,
  MessageCircle,
  Flame,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const team = await loadTeam(session.user.id);
  if (team.length === 0) redirect("/dashboard");

  // Items from my reports waiting on me.
  const [pendingQuests, pitchedInitiatives] = await Promise.all([
    prisma.quest.count({
      where: { status: "PENDING_APPROVAL", user: { managerId: session.user.id } },
    }),
    prisma.initiative.count({
      where: { status: "PITCHED", user: { managerId: session.user.id } },
    }),
  ]);
  const pendingApprovals = pendingQuests + pitchedInitiatives;

  const totalPrompts = team.reduce((s, r) => s + r.prompts.length, 0);
  const blockedCount = team.filter(
    (r) => r.thisWeekCheckin?.whatBlocked && r.thisWeekCheckin.whatBlocked.trim()
  ).length;
  const noCheckinCount = team.filter((r) => !r.thisWeekCheckin).length;

  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      <header className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="w-10 h-10 rounded-xl bg-white border border-border shadow-soft flex items-center justify-center hover:bg-muted transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-faint font-bold">
              Trajectory · Coaching
            </p>
            <p className="font-display text-sm font-bold mt-0.5">My team</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/team/approvals"
            className="px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft text-sm flex items-center gap-2 transition"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Approvals
            {pendingApprovals > 0 && (
              <span className="text-[10px] font-bold bg-rose-500 text-white rounded-full px-1.5 py-0.5 tabular-nums">
                {pendingApprovals}
              </span>
            )}
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft text-sm flex items-center gap-2 transition">
              <LogOut className="w-4 h-4 text-ink-mute" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>

      {/* Hero */}
      <section className="rounded-3xl bg-gradient-to-br from-accent-mint to-emerald-700 p-6 sm:p-8 mb-6 text-white relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative grid lg:grid-cols-[1.5fr_1fr] gap-4 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/20 backdrop-blur text-xs font-bold mb-3">
              <Users className="w-3.5 h-3.5" />
              {team.length} report{team.length === 1 ? "" : "s"}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-2">
              Coach, don&apos;t grade.
            </h1>
            <p className="text-white/85 max-w-xl">
              Your team&apos;s rings, blockers, and what to focus on this week.
              Each prompt is a small action that lifts someone.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <HeroStat icon={AlertCircle} label="Blocked" value={blockedCount} />
            <HeroStat icon={MessageCircle} label="No check-in" value={noCheckinCount} />
            <HeroStat icon={Flame} label="Prompts" value={totalPrompts} />
          </div>
        </div>
      </section>

      {/* Reports list */}
      <div className="grid lg:grid-cols-2 gap-4">
        {team.map((r) => {
          const tier = TIER_META[r.trajectory.tier];
          return (
            <Link
              key={r.userId}
              href={`/team/${r.userId}`}
              className="group rounded-2xl bg-white border border-border shadow-soft hover:shadow-lift hover:border-brand-200 transition p-5"
            >
              <div className="flex items-start gap-4 mb-3">
                <div className="relative shrink-0">
                  <TrajectoryRings
                    mastery={r.trajectory.rings.mastery}
                    delivery={r.trajectory.rings.delivery}
                    growth={r.trajectory.rings.growth}
                    size={84}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display font-bold truncate">{r.name}</p>
                  <p className="text-xs text-ink-faint">
                    {r.level} · {r.weekStreak}w streak
                  </p>
                  <div className={`inline-flex items-center gap-1 mt-2 text-xs font-bold px-2 py-1 rounded-full border ${tier.bg} ${tier.fg}`}>
                    {tier.label}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-display text-2xl font-extrabold tabular-nums leading-none">
                    {Math.round(r.trajectory.totalScore)}
                  </p>
                  <p className="text-[10px] text-ink-faint uppercase tracking-wide font-semibold">
                    score
                  </p>
                </div>
              </div>

              {r.prompts.length > 0 && (
                <div className="border-t border-border pt-3 space-y-1.5">
                  {r.prompts.slice(0, 2).map((p) => (
                    <div
                      key={p.id}
                      className={`text-xs flex items-start gap-2 px-2.5 py-2 rounded-lg ${
                        p.severity === "alert"
                          ? "bg-rose-50 border border-rose-100"
                          : p.severity === "warn"
                            ? "bg-amber-50 border border-amber-100"
                            : "bg-brand-50 border border-brand-100"
                      }`}
                    >
                      <span className="text-base shrink-0">{p.emoji}</span>
                      <div className="min-w-0">
                        <p
                          className={`font-semibold ${
                            p.severity === "alert"
                              ? "text-rose-700"
                              : p.severity === "warn"
                                ? "text-amber-700"
                                : "text-brand-700"
                          }`}
                        >
                          {p.title}
                        </p>
                        <p className="text-ink-soft mt-0.5">{p.detail}</p>
                      </div>
                    </div>
                  ))}
                  {r.prompts.length > 2 && (
                    <p className="text-[11px] text-ink-faint pl-1">
                      +{r.prompts.length - 2} more
                    </p>
                  )}
                </div>
              )}

              <div className="mt-3 text-xs font-semibold text-brand-600 inline-flex items-center gap-1 group-hover:translate-x-0.5 transition">
                Open scorecard
                <ArrowRight className="w-3.5 h-3.5" />
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}

function HeroStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl bg-white/15 backdrop-blur border border-white/20 p-3 text-center">
      <Icon className="w-4 h-4 mx-auto mb-1 opacity-90" />
      <p className="font-display text-2xl font-extrabold tabular-nums leading-none">
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wider font-bold text-white/80 mt-1">
        {label}
      </p>
    </div>
  );
}
