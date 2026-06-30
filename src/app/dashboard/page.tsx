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
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-7xl mx-auto">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-accent-violet flex items-center justify-center shadow-pop">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs text-ink-faint leading-none">Indefine LMS</p>
            <p className="text-sm font-semibold leading-tight mt-0.5">
              {session.user.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {reportCount > 0 && (
            <Link
              href="/team"
              className="px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border text-sm flex items-center gap-2 shadow-soft transition"
            >
              <Users className="w-4 h-4 text-ink-mute" />
              <span className="hidden sm:inline">My team</span>
              <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">
                {reportCount}
              </span>
            </Link>
          )}
          {role === "ADMIN" && (
            <Link
              href="/admin"
              className="px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border text-sm flex items-center gap-2 shadow-soft transition"
            >
              <ShieldCheck className="w-4 h-4 text-ink-mute" />
              Admin
            </Link>
          )}
          <Link
            href="/recap/year"
            className="px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-sm flex items-center gap-2 shadow-soft transition"
            title="Year-in-Review"
          >
            <Sparkles className="w-4 h-4 text-amber-700" />
            <span className="hidden sm:inline text-amber-800 font-semibold">
              Recap
            </span>
          </Link>
          <Link
            href="/initiatives"
            className="px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border text-sm flex items-center gap-2 shadow-soft transition"
          >
            <Rocket className="w-4 h-4 text-ink-mute" />
            <span className="hidden sm:inline">Initiatives</span>
          </Link>
          <Link
            href="/leaderboard"
            className="px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border text-sm flex items-center gap-2 shadow-soft transition"
          >
            <Trophy className="w-4 h-4 text-ink-mute" />
            <span className="hidden sm:inline">Leaderboard</span>
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border text-sm flex items-center gap-2 shadow-soft transition">
              <LogOut className="w-4 h-4 text-ink-mute" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>

      {/* Weekly check-in CTA */}
      {showCheckinBanner && (
        <Link
          href="/checkin"
          className={`block mb-6 rounded-2xl p-5 border shadow-soft hover:shadow-lift transition relative overflow-hidden ${
            urgency === "loud"
              ? "bg-amber-50 border-amber-200"
              : "bg-white border-border"
          }`}
        >
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                urgency === "loud"
                  ? "bg-amber-500 text-white"
                  : "bg-amber-50 text-amber-600"
              }`}
            >
              <MessageCircle className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint">
                Weekly check-in · 90 seconds
                {checkinStreak.current > 0 && (
                  <span className="text-amber-600 ml-2">
                    🔥 {checkinStreak.current}-week streak
                  </span>
                )}
              </p>
              <p className="font-display text-lg font-bold mt-0.5">
                {urgency === "loud"
                  ? "It's reflection time — how was your week?"
                  : "Take a breath and reflect →"}
              </p>
              <p className="text-sm text-ink-mute mt-0.5">
                Three short answers about what worked, what blocked you, and
                what&apos;s next.
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-ink-faint hidden sm:block" />
          </div>
        </Link>
      )}

      {/* Wizard CTA */}
      {!wizardDone && trajectory.cycle && (
        <Link
          href="/wizard"
          className="block mb-6 rounded-2xl bg-brand-50 border border-brand-100 p-5 hover:bg-brand-100/60 transition"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-bold text-brand-600">
                Set your trajectory · {trajectory.cycle.name}
              </p>
              <p className="font-display text-lg font-bold mt-0.5 text-ink">
                Take the 5-minute Growth Wizard →
              </p>
              <p className="text-sm text-ink-mute mt-0.5">
                Pick your strengths, set 3 quarterly quests, pitch a bold idea.
                Make this year yours.
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-brand-400 hidden sm:block" />
          </div>
        </Link>
      )}

      {/* Trajectory hero — Three rings + Tier */}
      {trajectory.cycle && (
        <section className={`rounded-3xl ${tier.bg} ${tier.glow} border border-border p-6 sm:p-8 mb-6 relative overflow-hidden animate-fade-in`}>
          <div className="grid lg:grid-cols-[auto_1fr_auto] gap-6 items-center">
            {/* Rings */}
            <div className="relative flex items-center justify-center">
              <TrajectoryRings
                mastery={trajectory.rings.mastery}
                delivery={trajectory.rings.delivery}
                growth={trajectory.rings.growth}
                size={170}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint">
                  Tier
                </p>
                <p className={`font-display text-xl font-extrabold ${tier.fg}`}>
                  {tier.label}
                </p>
              </div>
            </div>

            {/* Mid — narrative + next move */}
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint mb-1">
                Trajectory · Q{trajectory.quarter} · {trajectory.cycle.name}
              </p>
              <h2 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight mb-1">
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
              <p className="text-ink-soft mb-4 max-w-md">{tier.blurb}</p>

              {focusTrack && (
                <div className="rounded-xl bg-muted border border-border p-3 max-w-md">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint mb-1">
                    Next move · {focusTrack.emoji} {focusTrack.label}
                  </p>
                  <p className="text-sm font-medium text-ink">{focusTrack.nextMove}</p>
                </div>
              )}
            </div>

            {/* Right — ring legend + score */}
            <div className="lg:min-w-[180px] rounded-xl bg-muted border border-border p-4">
              <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint mb-2">
                Total score
              </p>
              <p className="font-display text-3xl font-extrabold tabular-nums">
                {Math.round(trajectory.totalScore)}
                <span className="text-base text-ink-faint font-semibold">/100</span>
              </p>
              <div className="mt-3 pt-3 border-t border-border">
                <RingLegend
                  mastery={trajectory.rings.mastery}
                  delivery={trajectory.rings.delivery}
                  growth={trajectory.rings.growth}
                />
              </div>
            </div>
          </div>

          {/* Track tiles */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 mt-5">
            {trajectory.tracks.map((t) => (
              <div
                key={t.kind}
                className="rounded-lg bg-muted border border-border px-3 py-2.5"
                title={t.nextMove}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium">
                    <span className="mr-1">{t.emoji}</span>
                    {t.label}
                  </span>
                </div>
                <div className="flex items-end justify-between gap-2">
                  <p className="font-display text-lg font-bold tabular-nums leading-none">
                    {Math.round(t.scorePct)}
                  </p>
                  <p className="text-[10px] text-ink-faint">{t.weight}% wt</p>
                </div>
                <div className="mt-1.5 h-0.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500"
                    style={{ width: `${t.scorePct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Welcome hero */}
      <section className="rounded-3xl bg-white border border-border shadow-soft p-6 sm:p-8 mb-6 animate-fade-in">
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-center">
          <div>
            <p className="text-sm text-ink-mute mb-1">{greeting()},</p>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-2 text-ink">
              {firstName(session.user.name)} 👋
            </h1>
            <p className="text-ink-soft max-w-md mb-5 leading-relaxed">
              {streak.activeToday
                ? `You're on a ${streak.current}-day streak — keep the momentum going.`
                : streak.current > 0
                  ? `${streak.current}-day streak — watch one video today to keep it alive.`
                  : "Watch a video today to start your learning streak."}
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px] max-w-md">
                <div className="flex items-center justify-between text-xs text-ink-mute mb-1.5 font-medium">
                  <span>Level {level.level}</span>
                  <span>
                    {level.pointsIntoLevel} / {level.pointsForNextLevel} XP
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full transition-all"
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

      {/* Attendance & daily punch */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <Clock className="w-5 h-5 text-brand-500" />
            Attendance & daily punch
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <a
            href="https://streamlining.greythr.com/"
            target="_blank"
            rel="noreferrer"
            className="group rounded-2xl bg-white border border-border hover:border-brand-200 hover:shadow-lift shadow-soft p-5 flex items-center gap-4 transition"
          >
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
              <Fingerprint className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-ink-faint font-semibold">
                Punch in / out
              </p>
              <p className="font-semibold">greytHR</p>
              <p className="text-sm text-ink-mute">Mark your daily attendance</p>
            </div>
            <ExternalLink className="w-4 h-4 text-ink-faint group-hover:text-brand-500 transition shrink-0" />
          </a>

          <a
            href="https://practice.turia.in/"
            target="_blank"
            rel="noreferrer"
            className="group rounded-2xl bg-white border border-border hover:border-brand-200 hover:shadow-lift shadow-soft p-5 flex items-center gap-4 transition"
          >
            <div className="w-12 h-12 rounded-xl bg-brand-100 text-brand-600 flex items-center justify-center shrink-0">
              <Clock className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wide text-ink-faint font-semibold">
                Practice portal
              </p>
              <p className="font-semibold">Turia</p>
              <p className="text-sm text-ink-mute">Log in to your workspace</p>
            </div>
            <ExternalLink className="w-4 h-4 text-ink-faint group-hover:text-brand-500 transition shrink-0" />
          </a>
        </div>
      </section>

      {/* Deadline + Assignments row */}
      {(upcoming || myAssignments.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          {upcoming && daysUntil != null && (
            <div
              className={`rounded-2xl p-5 flex items-center gap-4 shadow-soft border ${
                daysUntil <= 3
                  ? "bg-rose-50 border-rose-200"
                  : daysUntil <= 7
                    ? "bg-amber-50 border-amber-200"
                    : "bg-white border-border"
              }`}
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  daysUntil <= 3
                    ? "bg-rose-100 text-rose-600"
                    : daysUntil <= 7
                      ? "bg-amber-100 text-amber-600"
                      : "bg-muted text-ink-mute"
                }`}
              >
                <Calendar className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wide text-ink-faint font-semibold">
                  Next deadline · {upcoming.kind.toLowerCase()}
                </p>
                <p className="font-semibold mt-0.5 truncate">
                  {upcoming.courseTitle}
                </p>
                <p className="text-sm text-ink-mute mt-0.5">
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
              className="rounded-2xl bg-white border border-border p-5 flex items-center gap-4 hover:border-brand-200 hover:shadow-lift shadow-soft transition"
            >
              <div className="w-12 h-12 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center shrink-0">
                <Target className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <p className="text-xs uppercase tracking-wide text-ink-faint font-semibold">
                  My assignments
                </p>
                <p className="font-semibold mt-0.5">
                  {myAssignments.filter((a) => a.status === "PENDING").length}{" "}
                  pending
                </p>
                <p className="text-sm text-ink-mute mt-0.5">
                  {myAssignments.reduce(
                    (s, a) => s + (a.status === "COMPLETED" ? a.points : 0),
                    0
                  )}{" "}
                  / {myAssignments.reduce((s, a) => s + a.points, 0)} pts earned
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-ink-faint" />
            </Link>
          )}
        </div>
      )}

      {/* Achievements */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-bold flex items-center gap-2">
            <Award className="w-5 h-5 text-accent-gold" />
            Achievements
          </h2>
          <span className="text-xs text-ink-faint">
            {unlockedCount} / {achievements.length} unlocked
          </span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
          {achievements.map((a) => {
            const Icon = ICON_MAP[a.icon] ?? Sparkles;
            return (
              <div
                key={a.id}
                className={`group relative rounded-2xl border p-3 flex flex-col items-center gap-2 transition shadow-soft ${
                  a.unlocked
                    ? "bg-white border-border"
                    : "bg-muted/60 border-border/60 opacity-70"
                }`}
                title={a.description}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    a.unlocked ? ACHIEVEMENT_TINT[a.color] : "bg-white text-ink-faint"
                  }`}
                >
                  {a.unlocked ? (
                    <Icon className="w-5 h-5" />
                  ) : (
                    <Lock className="w-4 h-4" />
                  )}
                </div>
                <p className="text-[10px] text-center font-semibold leading-tight">
                  {a.title}
                </p>
                {a.progress && !a.unlocked && (
                  <div className="w-full h-0.5 bg-ink/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-ink/40"
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

      {/* Courses */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl font-bold">Your courses</h2>
          {modulesWithVideos.length > 0 && (
            <span className="text-xs text-ink-faint">
              {modulesWithVideos.length} module
              {modulesWithVideos.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {modulesWithVideos.length === 0 ? (
          <div className="rounded-2xl bg-white border border-dashed border-border p-12 text-center shadow-soft">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <PlayCircle className="w-8 h-8 text-ink-faint" />
            </div>
            <p className="text-ink mb-1 font-medium">No courses yet</p>
            <p className="text-ink-mute text-sm mb-5">
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
                  className="group card-hover rounded-2xl bg-white border border-border hover:border-brand-200 hover:shadow-lift shadow-soft p-5 flex flex-col relative overflow-hidden"
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
                      <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
                        Complete
                      </span>
                    )}
                  </div>

                  <p className="text-[10px] uppercase tracking-wide text-ink-faint font-semibold mb-1">
                    {m.course.title}
                  </p>
                  <h3 className="font-display text-lg font-bold mb-3 leading-tight">
                    {m.title}
                  </h3>

                  <div className="flex items-center gap-3 text-xs text-ink-mute mb-4 flex-wrap">
                    <span>{total} video{total === 1 ? "" : "s"}</span>
                    {totalQuizzes > 0 && (
                      <>
                        <span className="text-ink-faint">·</span>
                        <span>{totalQuizzes} quiz{totalQuizzes === 1 ? "" : "zes"}</span>
                      </>
                    )}
                    {totalDuration > 0 && (
                      <>
                        <span className="text-ink-faint">·</span>
                        <span>{formatTotalDuration(totalDuration)}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-auto">
                    <div className="flex items-center justify-between text-xs text-ink-mute mb-1.5">
                      <span>
                        {done}/{total} videos
                        {totalQuizzes > 0 &&
                          ` · ${passedQuizzes}/${totalQuizzes} quizzes`}
                      </span>
                      <span className="font-semibold text-ink">
                        {Math.round(pct)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{ width: `${pct}%`, background: accent.bar }}
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-brand-600 group-hover:translate-x-0.5 transition">
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

      {/* Assignments full list */}
      {myAssignments.length > 0 && (
        <section id="assignments" className="mb-8">
          <h2 className="font-display text-xl font-bold mb-4">My assignments</h2>
          <div className="rounded-2xl bg-white border border-border divide-y divide-border shadow-soft overflow-hidden">
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
                            ? "bg-brand-50 text-brand-700"
                            : a.kind === "MODULE"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-violet-50 text-violet-700"
                        }`}
                      >
                        {a.kind}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${
                          a.status === "COMPLETED"
                            ? "bg-emerald-50 text-emerald-700"
                            : overdue
                              ? "bg-rose-50 text-rose-700"
                              : "bg-muted text-ink-mute"
                        }`}
                      >
                        {a.status === "COMPLETED"
                          ? "Done"
                          : overdue
                            ? "Overdue"
                            : "Pending"}
                      </span>
                      <span className="text-xs text-amber-600 font-bold">
                        +{a.points} pt
                      </span>
                    </div>
                    <p className="font-medium truncate">{a.title}</p>
                    {a.dueAt && a.status === "PENDING" && (
                      <p className="text-xs text-ink-mute mt-0.5">
                        Due {a.dueAt.toLocaleDateString()}
                      </p>
                    )}
                    {a.description && (
                      <p className="text-xs text-ink-mute mt-1 line-clamp-2">
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
                        className="text-xs px-3 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium shrink-0 flex items-center gap-1.5 shadow-pop transition"
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
    </main>
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
      className={`rounded-2xl bg-muted border border-border p-3.5 ${dim ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-brand-100 text-brand-600 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-[10px] uppercase tracking-wide text-ink-mute font-semibold">
          {label}
        </span>
      </div>
      <p className="font-display text-xl font-extrabold leading-none text-ink">{value}</p>
      <p className="text-[10px] text-ink-faint mt-1">{sub}</p>
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
