import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadYearRecap } from "@/lib/year-recap";
import { TIER_META } from "@/lib/trajectory";
import {
  ArrowLeft,
  Trophy,
  PlayCircle,
  GraduationCap,
  Rocket,
  Heart,
  Flame,
  Clock,
  Snowflake,
  Sparkles,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function YearRecap() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const recap = await loadYearRecap(session.user.id);
  if (!recap) redirect("/dashboard");

  const tier = TIER_META[recap.current.tier];
  const trajectoryDelta =
    recap.history.length >= 2
      ? Math.round(
          recap.history[recap.history.length - 1].totalScore -
            recap.history[0].totalScore
        )
      : 0;

  return (
    <main className="min-h-screen relative overflow-hidden text-white bg-gradient-to-br from-ink via-violet-900 to-rose-900">
      <div className="absolute top-0 -left-40 w-[40rem] h-[40rem] bg-brand-500/30 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 -right-40 w-[40rem] h-[40rem] bg-rose-500/20 rounded-full blur-3xl pointer-events-none" />

      {/* Top bar */}
      <header className="relative z-10 px-6 py-4 flex items-center justify-between text-white/90">
        <Link
          href="/dashboard"
          className="text-sm inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 backdrop-blur border border-white/15 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <span className="text-xs uppercase tracking-[0.3em] font-semibold text-white/60">
          Year-in-Review
        </span>
      </header>

      <div className="relative z-10 px-6 py-8 max-w-5xl mx-auto text-white">
        {/* Hero */}
        <div className="text-center mb-12 animate-slide-up">
          <p className="text-7xl mb-3">{recap.topMomentEmoji}</p>
          <p className="text-sm uppercase tracking-[0.3em] font-bold text-white/70 mb-3">
            {recap.cycleName}
          </p>
          <h1 className="font-display text-5xl sm:text-7xl font-extrabold tracking-tighter mb-4">
            {firstName(recap.user.name)}&apos;s
            <br />
            <span className="bg-gradient-to-r from-amber-300 via-rose-300 to-violet-300 bg-clip-text text-transparent">
              year of growth
            </span>
          </h1>
          <p className="text-xl text-white/85 max-w-xl mx-auto">
            Four quarters, one trajectory. Here&apos;s how it unfolded.
          </p>
        </div>

        {/* Quarters timeline */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
          {[1, 2, 3, 4].map((q) => {
            const entry = recap.history.find((h) => h.quarter === q);
            if (!entry) {
              return (
                <div
                  key={q}
                  className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-5 text-center opacity-60"
                >
                  <p className="text-xs uppercase tracking-wider font-bold text-white/50 mb-2">
                    Q{q}
                  </p>
                  <p className="text-2xl font-display font-bold text-white/40">—</p>
                  <p className="text-xs text-white/40 mt-2">Yet to come</p>
                </div>
              );
            }
            const tt = TIER_META[entry.tier];
            return (
              <div
                key={q}
                className={`rounded-2xl backdrop-blur border p-5 text-center transition ${
                  entry.frozen
                    ? "bg-white/10 border-white/20"
                    : "bg-amber-500/15 border-amber-300/40"
                }`}
              >
                <div className="flex items-center justify-center gap-1 mb-2">
                  <p className="text-xs uppercase tracking-wider font-bold text-white/70">
                    Q{q}
                  </p>
                  {entry.frozen ? (
                    <Snowflake className="w-3 h-3 text-sky-300" />
                  ) : (
                    <span className="text-[9px] uppercase tracking-wider font-bold text-amber-300">
                      Live
                    </span>
                  )}
                </div>
                <p className={`font-display text-3xl font-extrabold mb-1 ${tt.fg.replace("text-", "text-")}`}>
                  <span className="text-white">{Math.round(entry.totalScore)}</span>
                </p>
                <p className="text-sm font-bold text-amber-300">{tt.label}</p>
                <div className="grid grid-cols-3 gap-1 mt-3">
                  {entry.tracks.slice(0, 6).map((t) => (
                    <div key={t.kind} className="text-center" title={t.label}>
                      <p className="text-base">{t.emoji}</p>
                      <p className="text-[10px] text-white/70 tabular-nums">
                        {Math.round(t.scorePct)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Stats grid */}
        <div className="rounded-3xl bg-white/5 backdrop-blur border border-white/10 p-6 sm:p-8 mb-10">
          <h2 className="font-display text-2xl font-extrabold tracking-tight mb-5">
            By the numbers
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat icon={PlayCircle} label="Videos" value={recap.totals.videos} />
            <Stat
              icon={GraduationCap}
              label="Quizzes passed"
              value={recap.totals.quizzesPassed}
            />
            <Stat
              icon={Rocket}
              label="Initiatives"
              value={recap.totals.initiativesPitched}
              sub={
                recap.totals.initiativesShipped > 0
                  ? `${recap.totals.initiativesShipped} shipped`
                  : undefined
              }
            />
            <Stat
              icon={Heart}
              label="Endorsements"
              value={recap.totals.endorsements}
            />
            <Stat
              icon={Flame}
              label="Best streak"
              value={`${recap.totals.bestStreak}d`}
            />
            <Stat
              icon={Clock}
              label="Hours learned"
              value={`${Math.round(recap.totals.hours * 10) / 10}h`}
            />
          </div>
        </div>

        {/* Trajectory delta */}
        {recap.history.length >= 2 && (
          <div className="rounded-3xl bg-gradient-to-br from-amber-400/20 to-rose-500/20 backdrop-blur border border-amber-300/30 p-6 sm:p-8 mb-10 text-center">
            <Trophy className="w-10 h-10 mx-auto mb-3 text-amber-300" />
            <p className="text-sm uppercase tracking-[0.3em] font-bold text-white/70 mb-2">
              Trajectory delta
            </p>
            <p className="font-display text-5xl sm:text-6xl font-extrabold tracking-tighter">
              {trajectoryDelta >= 0 ? "+" : ""}
              {trajectoryDelta}
              <span className="text-2xl text-white/70 font-bold ml-2">pts</span>
            </p>
            <p className="text-white/85 mt-2">
              Q1 → Q{recap.history.length} score growth
            </p>
          </div>
        )}

        {/* Final tier */}
        <div className="rounded-3xl bg-gradient-to-br from-amber-400 via-rose-400 to-violet-500 p-1 mb-10">
          <div className="rounded-3xl bg-ink p-8 text-center">
            <Sparkles className="w-10 h-10 mx-auto mb-3 text-amber-300" />
            <p className="text-sm uppercase tracking-[0.3em] font-bold text-white/70 mb-2">
              Where you stand
            </p>
            <p className="font-display text-6xl sm:text-7xl font-extrabold tracking-tighter mb-3 bg-gradient-to-r from-amber-300 to-rose-300 bg-clip-text text-transparent">
              {tier.label}
            </p>
            <p className="text-2xl text-white/90 font-semibold">
              {Math.round(recap.current.totalScore)}
              <span className="text-base text-white/60 font-bold"> /100</span>
            </p>
            <p className="text-base text-white/80 italic mt-4 max-w-md mx-auto">
              {tier.blurb}
            </p>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex justify-center gap-3 flex-wrap">
          <Link
            href="/recap"
            className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 backdrop-blur border border-white/15 text-sm font-semibold inline-flex items-center gap-2 transition"
          >
            <Sparkles className="w-4 h-4" />
            Watch quarterly recap
          </Link>
          <Link
            href="/dashboard"
            className="px-5 py-3 rounded-xl bg-white text-ink font-semibold inline-flex items-center gap-2 hover:bg-white/95 transition shadow-lift"
          >
            <GraduationCap className="w-4 h-4" />
            Back to dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-4 text-center">
      <Icon className="w-5 h-5 mx-auto mb-2 opacity-80" />
      <p className="font-display text-2xl font-extrabold tabular-nums leading-none">
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wider font-bold text-white/70 mt-1.5">
        {label}
      </p>
      {sub && <p className="text-[10px] text-white/60 mt-0.5">{sub}</p>}
    </div>
  );
}

function firstName(s: string): string {
  return s.split(" ")[0] ?? s;
}
