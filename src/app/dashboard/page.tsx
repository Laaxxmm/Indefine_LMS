import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { computeKraScores, getCourseStatusForUser } from "@/lib/kra";
import {
  computeAchievements,
  computeLevel,
  computeStreak,
} from "@/lib/gamification";
import {
  computeTrajectory,
  ensureDefaultCycle,
  TIER_META,
} from "@/lib/trajectory";
import TrajectoryRings, { RingLegend } from "./TrajectoryRings";
import { OnboardingTour, type TourStep } from "@/components/OnboardingTour";
import {
  checkinUrgency,
  computeCheckinStreak,
  currentWeekStart,
} from "@/lib/checkins";
import {
  Flame,
  Sparkles,
  Trophy,
  Zap,
  Calendar,
  PlayCircle,
  GraduationCap,
  Target,
  Footprints,
  Award,
  Lock,
  ArrowRight,
  ShieldCheck,
  LogOut,
  Rocket,
  MessageCircle,
  Users,
  Clock,
  Fingerprint,
  ExternalLink,
} from "lucide-react";

export const dynamic = "force-dynamic";

const TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to Indefine LMS 👋",
    body: "A quick 30-second tour of the essentials. You can replay it any time from the ? button in the corner.",
  },
  {
    selector: "#courses",
    title: "Your training",
    body: "Your courses live here. Click one to start watching — each video's quiz unlocks automatically as you watch.",
  },
  {
    selector: "[data-tour='trajectory']",
    title: "Your growth score",
    body: "Your Trajectory tracks Mastery, Delivery and Growth through the year and rolls them into a tier.",
  },
  {
    selector: "[data-tour='attendance']",
    title: "Daily attendance",
    body: "Punch in and out on greytHR from here — your attendance counts toward your KRA score.",
  },
  {
    selector: "[data-tour='leaderboard']",
    title: "Leaderboard",
    body: "See how you rank. Points come from videos watched, quizzes passed, deadlines and attendance.",
  },
  {
    title: "You're all set 🎉",
    body: "Watch a video today to start your streak. Tap the ? button anytime to see this tour again.",
  },
];

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Flame,
  Sparkles,
  Trophy,
  Zap,
  GraduationCap,
  Target,
  Footprints,
  Award,
};

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const userId = session.user.id;
  const role = session.user.role;

  // Make sure a cycle + targets exist before we score.
  await ensureDefaultCycle();

  const [
    myAssignments,
    modules,
    statuses,
    streak,
    achievements,
    leaderboard,
    trajectory,
  ] = await Promise.all([
    prisma.assignment.findMany({
      where: { userId },
      include: {
        video: true,
        module: {
          include: {
            videos: {
              orderBy: { order: "asc" },
              include: {
                progresses: { where: { userId } },
                quiz: { include: { attempts: { where: { userId, passed: true }, take: 1 } } },
              },
            },
          },
        },
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    }),
    prisma.module.findMany({
      where: { course: { published: true } },
      include: {
        course: true,
        videos: {
          orderBy: { order: "asc" },
          include: {
            progresses: { where: { userId } },
            quiz: { include: { attempts: { where: { userId } } } },
          },
        },
      },
      orderBy: [{ courseId: "asc" }, { order: "asc" }],
    }),
    getCourseStatusForUser(userId),
    computeStreak(userId),
    computeAchievements(userId),
    computeKraScores(),
    computeTrajectory(userId),
  ]);

  const tier = TIER_META[trajectory.tier];
  // Pick top "next move" — the lowest-scoring track's hint
  const focusTrack = [...trajectory.tracks].sort(
    (a, b) => a.scorePct - b.scorePct
  )[0];

  const wizardUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { wizardSubmittedAt: true },
  });
  const wizardDone = !!wizardUser?.wizardSubmittedAt;

  // Weekly check-in state
  const ws = currentWeekStart();
  const [thisWeekCheckin, checkinStreak] = await Promise.all([
    prisma.weeklyCheckin.findUnique({
      where: { userId_weekStart: { userId, weekStart: ws } },
    }),
    computeCheckinStreak(userId),
  ]);
  const urgency = checkinUrgency();
  const showCheckinBanner = !thisWeekCheckin && urgency !== "off";

  const reportCount = await prisma.user.count({
    where: { managerId: userId, active: true },
  });

  const me = leaderboard.find((r) => r.userId === userId);
  const myRank = me ? leaderboard.findIndex((r) => r.userId === userId) + 1 : null;
  const myPoints = me?.totalScore ?? 0;
  const level = computeLevel(myPoints);

  const modulesWithVideos = modules.filter((m) => m.videos.length > 0);
  const allVideos = modulesWithVideos.flatMap((m) => m.videos);
  const totalCompleted = allVideos.filter((v) => v.progresses[0]?.completed).length;
  const overallPct =
    allVideos.length > 0 ? (totalCompleted / allVideos.length) * 100 : 0;

  const upcoming = statuses
    .flatMap((s) =>
      s.deadlines
        .filter((d) => d.state === "pending")
        .map((d) => ({ ...d, courseTitle: s.courseTitle }))
    )
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
  const daysUntil = upcoming
    ? Math.ceil((upcoming.dueAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-slate-200">
    <main className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center shadow-[0_8px_24px_-8px_rgba(239,68,68,0.6)]">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs text-slate-500 leading-none">Indefine LMS</p>
            <p className="text-sm font-semibold leading-tight mt-0.5 text-white">
              {session.user.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {reportCount > 0 && (
            <Link
              href="/team"
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-slate-300 flex items-center gap-2 transition"
            >
              <Users className="w-4 h-4 text-slate-400" />
              <span className="hidden sm:inline">My team</span>
              <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold">
                {reportCount}
              </span>
            </Link>
          )}
          {role === "ADMIN" && (
            <Link
              href="/admin"
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-slate-300 flex items-center gap-2 transition"
            >
              <ShieldCheck className="w-4 h-4 text-slate-400" />
              Admin
            </Link>
          )}
          <Link
            href="/recap/year"
            className="px-3 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-sm flex items-center gap-2 transition"
            title="Year-in-Review"
          >
            <Sparkles className="w-4 h-4 text-red-400" />
            <span className="hidden sm:inline text-red-300 font-semibold">
              Recap
            </span>
          </Link>
          <Link
            href="/initiatives"
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-slate-300 flex items-center gap-2 transition"
          >
            <Rocket className="w-4 h-4 text-slate-400" />
            <span className="hidden sm:inline">Initiatives</span>
          </Link>
          <Link
            href="/leaderboard"
            data-tour="leaderboard"
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-slate-300 flex items-center gap-2 transition"
          >
            <Trophy className="w-4 h-4 text-slate-400" />
            <span className="hidden sm:inline">Leaderboard</span>
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-slate-300 flex items-center gap-2 transition">
              <LogOut className="w-4 h-4 text-slate-400" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>

      {/* Weekly check-in CTA */}
      {showCheckinBanner && (
        <Link
          href="/checkin"
          className={`block mb-6 rounded-2xl p-5 border transition relative overflow-hidden ${
            urgency === "loud"
              ? "bg-red-500/10 border-red-500/30 hover:bg-red-500/15"
              : "bg-[#111a2e] border-white/10 hover:border-white/20"
          }`}
        >
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                urgency === "loud"
                  ? "bg-red-500 text-white"
                  : "bg-red-500/15 text-red-400"
              }`}
            >
              <MessageCircle className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                Weekly check-in · 90 seconds
                {checkinStreak.current > 0 && (
                  <span className="text-red-400 ml-2">
                    🔥 {checkinStreak.current}-week streak
                  </span>
                )}
              </p>
              <p className="font-display text-lg font-bold mt-0.5 text-white">
                {urgency === "loud"
                  ? "It's reflection time — how was your week?"
                  : "Take a breath and reflect →"}
              </p>
              <p className="text-sm text-slate-400 mt-0.5">
                Three short answers about what worked, what blocked you, and
                what&apos;s next.
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-500 hidden sm:block" />
          </div>
        </Link>
      )}

      {/* Wizard CTA */}
      {!wizardDone && trajectory.cycle && (
        <Link
          href="/wizard"
          className="block mb-6 rounded-2xl bg-[#111a2e] border border-white/10 p-5 hover:border-red-500/40 transition"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-bold text-red-400">
                Set your trajectory · {trajectory.cycle.name}
              </p>
              <p className="font-display text-lg font-bold mt-0.5 text-white">
                Take the 5-minute Growth Wizard →
              </p>
              <p className="text-sm text-slate-400 mt-0.5">
                Pick your strengths, set 3 quarterly quests, pitch a bold idea.
                Make this year yours.
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-red-400 hidden sm:block" />
          </div>
        </Link>
      )}

      {/* Trajectory hero — Three rings + Tier */}
      {trajectory.cycle && (
        <section data-tour="trajectory" className="rounded-3xl bg-gradient-to-br from-[#141d33] to-[#0d1424] border border-white/10 p-6 sm:p-8 mb-6 relative overflow-hidden animate-fade-in">
          <div className="absolute -top-20 -right-16 w-64 h-64 bg-red-600/10 rounded-full blur-3xl pointer-events-none" />
          <div className="relative grid lg:grid-cols-[auto_1fr_auto] gap-6 items-center">
            {/* Rings */}
            <div className="relative flex items-center justify-center">
              <TrajectoryRings
                mastery={trajectory.rings.mastery}
                delivery={trajectory.rings.delivery}
                growth={trajectory.rings.growth}
                size={170}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                  Tier
                </p>
                <p className="font-display text-xl font-extrabold text-white">
                  {tier.label}
                </p>
              </div>
            </div>

            {/* Mid — narrative + next move */}
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-bold text-red-400 mb-1">
                Trajectory · Q{trajectory.quarter} · {trajectory.cycle.name}
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight mb-1 text-white">
                {tier.label === "Stellar"
                  ? "You're flying."
                  : tier.label === "Soaring"
                    ? "You're soaring."
                    : tier.label === "Solid"
                      ? "You're solid."
                      : tier.label === "Growing"
                        ? "You're growing."
                        : tier.label === "Focused"
                          ? "Time to refocus."
                          : "Let's recalibrate."}
              </h2>
              <p className="text-slate-400 mb-4 max-w-md">{tier.blurb}</p>

              {focusTrack && (
                <div className="rounded-xl bg-white/5 border border-white/10 p-3 max-w-md">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-1">
                    Next move · {focusTrack.emoji} {focusTrack.label}
                  </p>
                  <p className="text-sm font-medium text-slate-200">{focusTrack.nextMove}</p>
                </div>
              )}
            </div>

            {/* Right — ring legend + score */}
            <div className="lg:min-w-[180px] rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500 mb-2">
                Total score
              </p>
              <p className="font-display text-3xl font-extrabold tabular-nums text-white">
                {Math.round(trajectory.totalScore)}
                <span className="text-base text-slate-500 font-semibold">/100</span>
              </p>
              <div className="mt-3 pt-3 border-t border-white/10">
                <RingLegend
                  mastery={trajectory.rings.mastery}
                  delivery={trajectory.rings.delivery}
                  growth={trajectory.rings.growth}
                />
              </div>
            </div>
          </div>

          {/* Track tiles */}
          <div className="relative grid grid-cols-3 lg:grid-cols-6 gap-2 mt-5">
            {trajectory.tracks.map((t) => (
              <div
                key={t.kind}
                className="rounded-lg bg-white/5 border border-white/10 px-3 py-2.5"
                title={t.nextMove}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium text-slate-300">
                    <span className="mr-1">{t.emoji}</span>
                    {t.label}
                  </span>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <p className="font-display text-lg font-bold tabular-nums leading-none text-white">
                    {Math.round(t.scorePct)}
                  </p>
                  <p className="text-[10px] text-slate-500">{t.weight}% wt</p>
                </div>
                <div className="mt-1.5 h-0.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${t.scorePct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Welcome hero */}
      <section className="rounded-3xl bg-gradient-to-br from-[#1a2138] via-[#131a2e] to-[#0b0f1c] border border-white/10 p-6 sm:p-8 mb-6 animate-fade-in relative overflow-hidden">
        <div className="absolute -top-24 -left-16 w-72 h-72 bg-red-600/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-0 left-0 h-full w-1.5 bg-gradient-to-b from-red-500 to-red-700" />
        <div className="relative grid lg:grid-cols-[1.4fr_1fr] gap-6 items-center">
          <div>
            <p className="text-sm text-slate-400 mb-1">{greeting()},</p>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-2 text-white">
              {firstName(session.user.name)} 👋
            </h1>
            <p className="text-slate-300 max-w-md mb-5 leading-relaxed">
              {streak.activeToday
                ? `You're on a ${streak.current}-day streak — keep the momentum going.`
                : streak.current > 0
                  ? `${streak.current}-day streak — watch one video today to keep it alive.`
                  : "Watch a video today to start your learning streak."}
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px] max-w-md">
                <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-medium">
                  <span>Level {level.level}</span>
                  <span>
                    {level.pointsIntoLevel} / {level.pointsForNextLevel} XP
                  </span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-500 to-red-600 rounded-full transition-all"
                    style={{ width: `${level.pctToNext}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatTile
              icon={Flame}
              label="Streak"
              value={`${streak.current}d`}
              sub={`Best ${streak.best}d`}
              dim={!streak.activeToday}
            />
            <StatTile
              icon={Zap}
              label="Total points"
              value={myPoints}
              sub={myRank ? `Rank #${myRank}` : "Not ranked"}
            />
            <StatTile
              icon={PlayCircle}
              label="Videos"
              value={`${totalCompleted}/${allVideos.length}`}
              sub={`${Math.round(overallPct)}%`}
            />
            <StatTile
              icon={Award}
              label="Badges"
              value={`${unlockedCount}/${achievements.length}`}
              sub="Earned"
            />
          </div>
        </div>
      </section>

      {/* Courses — moved up so employees see the actual training first */}
      <section id="courses" className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-bold text-white">Your courses</h2>
          {modulesWithVideos.length > 0 && (
            <span className="text-xs text-slate-500">
              {modulesWithVideos.length} module
              {modulesWithVideos.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {modulesWithVideos.length === 0 ? (
          <div className="rounded-2xl bg-[#111a2e] border border-dashed border-white/15 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
              <PlayCircle className="w-8 h-8 text-slate-500" />
            </div>
            <p className="text-white mb-1 font-medium">No courses yet</p>
            <p className="text-slate-400 text-sm mb-5">
              {role === "ADMIN"
                ? "Sync your SharePoint folder to import videos."
                : "Check back soon — your admin is setting things up."}
            </p>
            {role === "ADMIN" && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-sm font-medium text-white transition shadow-pop"
              >
                Open admin <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {modulesWithVideos.map((m, idx) => {
              const total = m.videos.length;
              const done = m.videos.filter((v) => v.progresses[0]?.completed).length;
              const pct = total > 0 ? (done / total) * 100 : 0;
              const totalDuration = m.videos.reduce(
                (s, v) => s + (v.durationSeconds ?? 0),
                0
              );
              const totalQuizzes = m.videos.filter((v) => v.quiz).length;
              const passedQuizzes = m.videos.filter((v) =>
                v.quiz?.attempts.some((a) => a.passed)
              ).length;
              const nextVideo =
                m.videos.find((v) => !v.progresses[0]?.completed) ?? m.videos[0];
              const isComplete = done === total;
              const accent = ACCENT_PALETTE[idx % ACCENT_PALETTE.length];

              return (
                <Link
                  key={m.id}
                  href={`/video/${nextVideo.id}`}
                  className="group card-hover rounded-2xl bg-[#111a2e] border border-white/10 hover:border-red-500/40 hover:bg-[#16223c] p-5 flex flex-col relative overflow-hidden transition"
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ background: accent.bar }}
                  />

                  <div className="flex items-start justify-between mb-4">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center"
                      style={{ background: accent.bg, color: accent.fg }}
                    >
                      <PlayCircle className="w-5 h-5" />
                    </div>
                    {isComplete && (
                      <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300">
                        Complete
                      </span>
                    )}
                  </div>

                  <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">
                    {m.course.title}
                  </p>
                  <h3 className="font-display text-lg font-bold mb-3 leading-tight text-white">
                    {m.title}
                  </h3>

                  <div className="flex items-center gap-3 text-xs text-slate-400 mb-4 flex-wrap">
                    <span>{total} video{total === 1 ? "" : "s"}</span>
                    {totalQuizzes > 0 && (
                      <>
                        <span className="text-slate-600">·</span>
                        <span>{totalQuizzes} quiz{totalQuizzes === 1 ? "" : "zes"}</span>
                      </>
                    )}
                    {totalDuration > 0 && (
                      <>
                        <span className="text-slate-600">·</span>
                        <span>{formatTotalDuration(totalDuration)}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-auto">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                      <span>
                        {done}/{total} videos
                        {totalQuizzes > 0 &&
                          ` · ${passedQuizzes}/${totalQuizzes} quizzes`}
                      </span>
                      <span className="font-semibold text-white">
                        {Math.round(pct)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{ width: `${pct}%`, background: accent.bar }}
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-red-400 group-hover:translate-x-0.5 transition">
                      {done === 0 ? "Start course" : "Continue"}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Attendance & daily punch */}
      <section data-tour="attendance" className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-bold flex items-center gap-2 text-white">
            <Clock className="w-5 h-5 text-red-400" />
            Attendance & daily punch
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <a
            href="https://streamlining.greythr.com/"
            target="_blank"
            rel="noreferrer"
            className="group rounded-2xl bg-[#111a2e] border border-white/10 hover:border-red-500/40 hover:bg-[#16223c] p-5 flex items-center gap-4 transition"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
              <Fingerprint className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                Punch in / out
              </p>
              <p className="font-semibold text-white">greytHR</p>
              <p className="text-sm text-slate-400">Mark your daily attendance</p>
            </div>
            <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-red-400 transition shrink-0" />
          </a>

          <a
            href="https://practice.turia.in/"
            target="_blank"
            rel="noreferrer"
            className="group rounded-2xl bg-[#111a2e] border border-white/10 hover:border-red-500/40 hover:bg-[#16223c] p-5 flex items-center gap-4 transition"
          >
            <div className="w-12 h-12 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">
                Practice portal
              </p>
              <p className="font-semibold text-white">Turia</p>
              <p className="text-sm text-slate-400">Log in to your workspace</p>
            </div>
            <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-red-400 transition shrink-0" />
          </a>
        </div>
      </section>

      {/* Deadline + Assignments row */}
      {(upcoming || myAssignments.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          {upcoming && daysUntil != null && (
            <div
              className={`rounded-2xl p-5 flex items-center gap-4 border ${
                daysUntil <= 3
                  ? "bg-red-500/10 border-red-500/30"
                  : daysUntil <= 7
                    ? "bg-amber-500/10 border-amber-500/30"
                    : "bg-[#111a2e] border-white/10"
              }`}
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  daysUntil <= 3
                    ? "bg-red-500/20 text-red-400"
                    : daysUntil <= 7
                      ? "bg-amber-500/20 text-amber-400"
                      : "bg-white/5 text-slate-400"
                }`}
              >
                <Calendar className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                  Next deadline · {upcoming.kind.toLowerCase()}
                </p>
                <p className="font-semibold mt-0.5 truncate text-white">
                  {upcoming.courseTitle}
                </p>
                <p className="text-sm text-slate-400 mt-0.5">
                  {daysUntil === 0
                    ? "Due today"
                    : daysUntil === 1
                      ? "Due tomorrow"
                      : `${daysUntil} days remaining`}{" "}
                  · {upcoming.pointsOnTime} pt
                </p>
              </div>
            </div>
          )}

          {myAssignments.length > 0 && (
            <Link
              href="#assignments"
              className="rounded-2xl bg-[#111a2e] border border-white/10 p-5 flex items-center gap-4 hover:border-red-500/40 hover:bg-[#16223c] transition"
            >
              <div className="w-12 h-12 rounded-xl bg-red-500/15 text-red-400 flex items-center justify-center shrink-0">
                <Target className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                  My assignments
                </p>
                <p className="font-semibold mt-0.5 text-white">
                  {myAssignments.filter((a) => a.status === "PENDING").length}{" "}
                  pending
                </p>
                <p className="text-sm text-slate-400 mt-0.5">
                  {myAssignments.reduce(
                    (s, a) => s + (a.status === "COMPLETED" ? a.points : 0),
                    0
                  )}{" "}
                  / {myAssignments.reduce((s, a) => s + a.points, 0)} pts earned
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-slate-500" />
            </Link>
          )}
        </div>
      )}

      {/* Achievements */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-bold flex items-center gap-2 text-white">
            <Award className="w-5 h-5 text-amber-400" />
            Achievements
          </h2>
          <span className="text-xs text-slate-500">
            {unlockedCount} / {achievements.length} unlocked
          </span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
          {achievements.map((a) => {
            const Icon = ICON_MAP[a.icon] ?? Sparkles;
            return (
              <div
                key={a.id}
                className={`group relative rounded-2xl border p-3 flex flex-col items-center gap-2 transition ${
                  a.unlocked
                    ? "bg-[#111a2e] border-white/10"
                    : "bg-white/[0.03] border-white/5 opacity-60"
                }`}
                title={a.description}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    a.unlocked ? ACHIEVEMENT_TINT[a.color] : "bg-white/5 text-slate-600"
                  }`}
                >
                  {a.unlocked ? (
                    <Icon className="w-5 h-5" />
                  ) : (
                    <Lock className="w-4 h-4" />
                  )}
                </div>
                <p className="text-[10px] text-center font-semibold leading-tight text-slate-200">
                  {a.title}
                </p>
                {a.progress && !a.unlocked && (
                  <div className="w-full h-0.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white/40"
                      style={{
                        width: `${(a.progress.current / a.progress.target) * 100}%`,
                      }}
                    />
                  </div>
                )}

                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-ink text-white rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10 shadow-lift">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-white/70">{a.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Assignments full list */}
      {myAssignments.length > 0 && (
        <section id="assignments" className="mb-8">
          <h2 className="font-display text-xl font-bold mb-4 text-white">My assignments</h2>
          <div className="rounded-2xl bg-[#111a2e] border border-white/10 divide-y divide-white/10 overflow-hidden">
            {myAssignments.map((a) => {
              const overdue =
                a.status === "PENDING" && a.dueAt && a.dueAt < new Date();
              return (
                <div
                  key={a.id}
                  className="px-5 py-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span
                        className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${
                          a.kind === "VIDEO"
                            ? "bg-red-500/20 text-red-300"
                            : a.kind === "MODULE"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-violet-500/20 text-violet-300"
                        }`}
                      >
                        {a.kind}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${
                          a.status === "COMPLETED"
                            ? "bg-emerald-500/20 text-emerald-300"
                            : overdue
                              ? "bg-red-500/20 text-red-300"
                              : "bg-white/10 text-slate-400"
                        }`}
                      >
                        {a.status === "COMPLETED"
                          ? "Done"
                          : overdue
                            ? "Overdue"
                            : "Pending"}
                      </span>
                      <span className="text-xs text-amber-400 font-bold">
                        +{a.points} pt
                      </span>
                    </div>
                    <p className="font-medium truncate text-white">{a.title}</p>
                    {a.dueAt && a.status === "PENDING" && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        Due {a.dueAt.toLocaleDateString()}
                      </p>
                    )}
                    {a.description && (
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                        {a.description}
                      </p>
                    )}
                  </div>
                  {a.status === "PENDING" && (() => {
                    const targetVideoId =
                      a.kind === "VIDEO"
                        ? a.videoId
                        : a.kind === "MODULE" && a.module
                          ? // Resume on first incomplete video, fall back to first.
                            (a.module.videos.find(
                              (v) => !v.progresses[0]?.completed
                            )?.id ?? a.module.videos[0]?.id)
                          : null;
                    if (!targetVideoId) return null;
                    return (
                      <Link
                        href={`/video/${targetVideoId}`}
                        className="text-xs px-3 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white font-medium shrink-0 flex items-center gap-1.5 transition"
                      >
                        {a.kind === "MODULE" ? "Open module" : "Open"}{" "}
                        <ArrowRight className="w-3 h-3" />
                      </Link>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <OnboardingTour steps={TOUR_STEPS} />
      </main>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  dim,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub: string;
  dim?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl bg-white/5 border border-white/10 p-3.5 ${dim ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-red-500/15 text-red-400 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
          {label}
        </span>
      </div>
      <p className="font-display text-xl font-extrabold leading-none text-white">{value}</p>
      <p className="text-[10px] text-slate-500 mt-1">{sub}</p>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function firstName(fullName: string | null | undefined) {
  if (!fullName) return "there";
  return fullName.split(" ")[0];
}

function formatTotalDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const ACCENT_PALETTE = [
  {
    bg: "rgb(238 242 255)",
    fg: "#4f46e5",
    bar: "linear-gradient(90deg, #6366f1, #8b5cf6)",
  },
  {
    bg: "rgb(237 233 254)",
    fg: "#7c3aed",
    bar: "linear-gradient(90deg, #8b5cf6, #ec4899)",
  },
  {
    bg: "rgb(209 250 229)",
    fg: "#059669",
    bar: "linear-gradient(90deg, #10b981, #06b6d4)",
  },
  {
    bg: "rgb(254 243 199)",
    fg: "#d97706",
    bar: "linear-gradient(90deg, #f59e0b, #ef4444)",
  },
  {
    bg: "rgb(254 226 226)",
    fg: "#dc2626",
    bar: "linear-gradient(90deg, #f43f5e, #d946ef)",
  },
];

const ACHIEVEMENT_TINT: Record<string, string> = {
  brand: "bg-brand-100 text-brand-600",
  gold: "bg-amber-100 text-amber-600",
  mint: "bg-emerald-100 text-emerald-600",
  rose: "bg-rose-100 text-rose-600",
  violet: "bg-violet-100 text-violet-600",
};
