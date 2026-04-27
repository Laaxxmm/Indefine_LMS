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

  const [
    myAssignments,
    modules,
    statuses,
    streak,
    achievements,
    leaderboard,
  ] = await Promise.all([
    prisma.assignment.findMany({
      where: { userId },
      include: { video: true },
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
  ]);

  const me = leaderboard.find((r) => r.userId === userId);
  const myRank = me ? leaderboard.findIndex((r) => r.userId === userId) + 1 : null;
  const myPoints = me?.totalScore ?? 0;
  const level = computeLevel(myPoints);

  const modulesWithVideos = modules.filter((m) => m.videos.length > 0);
  const allVideos = modulesWithVideos.flatMap((m) => m.videos);
  const totalCompleted = allVideos.filter(
    (v) => v.progresses[0]?.completed
  ).length;
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
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-accent-violet flex items-center justify-center shadow-glow">
            <GraduationCap className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-xs text-white/50 leading-none">Indefine LMS</p>
            <p className="text-sm font-medium leading-tight">{session.user.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {role === "ADMIN" && (
            <Link
              href="/admin"
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm flex items-center gap-2 transition"
            >
              <ShieldCheck className="w-4 h-4" />
              Admin
            </Link>
          )}
          <Link
            href="/leaderboard"
            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm flex items-center gap-2 transition"
          >
            <Trophy className="w-4 h-4" />
            Leaderboard
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm flex items-center gap-2 transition">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>

      {/* Hero — greeting + headline stats */}
      <section className="rounded-2xl bg-gradient-to-br from-brand-500/10 via-bg-card to-bg-card border border-white/10 p-6 sm:p-8 mb-6 relative overflow-hidden animate-fade-in">
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-brand-500/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative grid lg:grid-cols-[1.4fr_1fr] gap-6 items-center">
          <div>
            <p className="text-sm text-white/60 mb-1">{greeting()},</p>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
              {firstName(session.user.name)} 👋
            </h1>
            <p className="text-white/60 max-w-md mb-5">
              {streak.activeToday
                ? `You're on a ${streak.current}-day streak — keep the momentum going.`
                : streak.current > 0
                  ? `${streak.current}-day streak — watch one video today to keep it alive.`
                  : "Watch a video today to start your learning streak."}
            </p>

            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px] max-w-md">
                <div className="flex items-center justify-between text-xs text-white/60 mb-1.5">
                  <span>Level {level.level}</span>
                  <span>
                    {level.pointsIntoLevel} / {level.pointsForNextLevel} XP
                  </span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-brand-400 to-accent-violet transition-all"
                    style={{ width: `${level.pctToNext}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              icon={Flame}
              label="Streak"
              value={`${streak.current}d`}
              sub={`Best ${streak.best}d`}
              tint="rose"
              dim={!streak.activeToday}
            />
            <StatTile
              icon={Zap}
              label="Total points"
              value={myPoints}
              sub={myRank ? `Rank #${myRank}` : "Not ranked"}
              tint="gold"
            />
            <StatTile
              icon={PlayCircle}
              label="Videos done"
              value={`${totalCompleted}/${allVideos.length}`}
              sub={`${Math.round(overallPct)}%`}
              tint="brand"
            />
            <StatTile
              icon={Award}
              label="Achievements"
              value={`${unlockedCount}/${achievements.length}`}
              sub="Badges earned"
              tint="violet"
            />
          </div>
        </div>
      </section>

      {/* Deadline + Assignments row */}
      {(upcoming || myAssignments.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          {upcoming && daysUntil != null && (
            <div
              className={`rounded-xl border p-5 flex items-center gap-4 ${
                daysUntil <= 3
                  ? "bg-accent-rose/10 border-accent-rose/30"
                  : daysUntil <= 7
                    ? "bg-accent-gold/10 border-accent-gold/30"
                    : "bg-white/5 border-white/10"
              }`}
            >
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  daysUntil <= 3
                    ? "bg-accent-rose/20 text-accent-rose"
                    : daysUntil <= 7
                      ? "bg-accent-gold/20 text-accent-gold"
                      : "bg-white/10 text-white/70"
                }`}
              >
                <Calendar className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wide text-white/50">
                  Next deadline · {upcoming.kind.toLowerCase()}
                </p>
                <p className="font-semibold mt-0.5 truncate">
                  {upcoming.courseTitle}
                </p>
                <p className="text-sm text-white/70 mt-0.5">
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
              className="rounded-xl bg-white/5 border border-white/10 p-5 flex items-center gap-4 hover:bg-white/10 transition"
            >
              <div className="w-12 h-12 rounded-xl bg-accent-violet/20 text-accent-violet flex items-center justify-center shrink-0">
                <Target className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <p className="text-xs uppercase tracking-wide text-white/50">
                  My assignments
                </p>
                <p className="font-semibold mt-0.5">
                  {myAssignments.filter((a) => a.status === "PENDING").length}{" "}
                  pending
                </p>
                <p className="text-sm text-white/70 mt-0.5">
                  {myAssignments.reduce(
                    (s, a) => s + (a.status === "COMPLETED" ? a.points : 0),
                    0
                  )}{" "}
                  / {myAssignments.reduce((s, a) => s + a.points, 0)} pts earned
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-white/40" />
            </Link>
          )}
        </div>
      )}

      {/* Achievements */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Award className="w-5 h-5 text-accent-gold" />
            Achievements
          </h2>
          <span className="text-xs text-white/50">
            {unlockedCount} / {achievements.length} unlocked
          </span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
          {achievements.map((a) => {
            const Icon = ICON_MAP[a.icon] ?? Sparkles;
            return (
              <div
                key={a.id}
                className={`group relative rounded-xl border p-3 flex flex-col items-center gap-2 transition ${
                  a.unlocked
                    ? "bg-accent-gold/5 border-accent-gold/20"
                    : "bg-white/[0.03] border-white/5 opacity-60"
                }`}
                title={a.description}
              >
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    a.unlocked ? ACHIEVEMENT_TINT[a.color] : "bg-white/5 text-white/30"
                  }`}
                >
                  {a.unlocked ? (
                    <Icon className="w-5 h-5" />
                  ) : (
                    <Lock className="w-4 h-4" />
                  )}
                </div>
                <p className="text-[10px] text-center font-medium text-white/80 leading-tight">
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

                {/* Tooltip on hover */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-bg-elev border border-white/10 rounded-lg text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-white/60">{a.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Courses */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Your courses</h2>
          {modulesWithVideos.length > 0 && (
            <span className="text-xs text-white/50">
              {modulesWithVideos.length} module
              {modulesWithVideos.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {modulesWithVideos.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.03] border border-dashed border-white/10 p-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
              <PlayCircle className="w-8 h-8 text-white/40" />
            </div>
            <p className="text-white/70 mb-1 font-medium">No courses yet</p>
            <p className="text-white/50 text-sm mb-5">
              {role === "ADMIN"
                ? "Sync your SharePoint folder to import videos."
                : "Check back soon — your admin is setting things up."}
            </p>
            {role === "ADMIN" && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-sm font-medium transition"
              >
                Open admin <ArrowRight className="w-4 h-4" />
              </Link>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {modulesWithVideos.map((m, idx) => {
              const total = m.videos.length;
              const done = m.videos.filter((v) => v.progresses[0]?.completed)
                .length;
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
                m.videos.find((v) => !v.progresses[0]?.completed) ??
                m.videos[0];
              const isComplete = done === total;
              const accent = ACCENT_PALETTE[idx % ACCENT_PALETTE.length];

              return (
                <Link
                  key={m.id}
                  href={`/video/${nextVideo.id}`}
                  className="group card-hover rounded-2xl bg-bg-card border border-white/10 p-5 hover:border-white/20 flex flex-col relative overflow-hidden"
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ background: accent.bar }}
                  />

                  <div className="flex items-start justify-between mb-4">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center"
                      style={{
                        background: accent.bg,
                        color: accent.fg,
                      }}
                    >
                      <PlayCircle className="w-5 h-5" />
                    </div>
                    {isComplete && (
                      <span className="text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded-full bg-accent-mint/20 text-accent-mint">
                        Complete
                      </span>
                    )}
                  </div>

                  <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">
                    {m.course.title}
                  </p>
                  <h3 className="text-lg font-bold mb-3 leading-tight">
                    {m.title}
                  </h3>

                  <div className="flex items-center gap-3 text-xs text-white/60 mb-4 flex-wrap">
                    <span>
                      {total} video{total === 1 ? "" : "s"}
                    </span>
                    {totalQuizzes > 0 && (
                      <>
                        <span className="text-white/20">·</span>
                        <span>
                          {totalQuizzes} quiz{totalQuizzes === 1 ? "" : "zes"}
                        </span>
                      </>
                    )}
                    {totalDuration > 0 && (
                      <>
                        <span className="text-white/20">·</span>
                        <span>{formatTotalDuration(totalDuration)}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-auto">
                    <div className="flex items-center justify-between text-xs text-white/60 mb-1.5">
                      <span>
                        {done}/{total} videos
                        {totalQuizzes > 0 &&
                          ` · ${passedQuizzes}/${totalQuizzes} quizzes`}
                      </span>
                      <span className="font-semibold text-white/80">
                        {Math.round(pct)}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: accent.bar,
                        }}
                      />
                    </div>
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-white/60 group-hover:text-white transition">
                      {done === 0 ? "Start course" : "Continue"}
                      <ArrowRight className="w-3.5 h-3.5 transition group-hover:translate-x-0.5" />
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
          <h2 className="text-xl font-bold mb-4">My assignments</h2>
          <div className="rounded-2xl bg-bg-card border border-white/10 divide-y divide-white/5 overflow-hidden">
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
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          a.kind === "VIDEO"
                            ? "bg-brand-500/20 text-brand-300"
                            : "bg-accent-violet/20 text-accent-violet"
                        }`}
                      >
                        {a.kind}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          a.status === "COMPLETED"
                            ? "bg-accent-mint/20 text-accent-mint"
                            : overdue
                              ? "bg-accent-rose/20 text-accent-rose"
                              : "bg-white/10 text-white/70"
                        }`}
                      >
                        {a.status === "COMPLETED"
                          ? "Done"
                          : overdue
                            ? "Overdue"
                            : "Pending"}
                      </span>
                      <span className="text-xs text-accent-gold font-semibold">
                        +{a.points} pt
                      </span>
                    </div>
                    <p className="font-medium truncate">{a.title}</p>
                    {a.dueAt && a.status === "PENDING" && (
                      <p className="text-xs text-white/50 mt-0.5">
                        Due {a.dueAt.toLocaleDateString()}
                      </p>
                    )}
                    {a.description && (
                      <p className="text-xs text-white/60 mt-1 line-clamp-2">
                        {a.description}
                      </p>
                    )}
                  </div>
                  {a.kind === "VIDEO" &&
                    a.videoId &&
                    a.status === "PENDING" && (
                      <Link
                        href={`/video/${a.videoId}`}
                        className="text-xs px-3 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 font-medium shrink-0 flex items-center gap-1.5 transition"
                      >
                        Open <ArrowRight className="w-3 h-3" />
                      </Link>
                    )}
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
  tint,
  dim,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub: string;
  tint: "brand" | "gold" | "rose" | "violet";
  dim?: boolean;
}) {
  const tints = {
    brand: "bg-brand-500/15 text-brand-300",
    gold: "bg-accent-gold/15 text-accent-gold",
    rose: "bg-accent-rose/15 text-accent-rose",
    violet: "bg-accent-violet/15 text-accent-violet",
  };
  return (
    <div
      className={`rounded-xl bg-white/5 border border-white/10 p-3.5 ${dim ? "opacity-70" : ""}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${tints[tint]}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <span className="text-[10px] uppercase tracking-wide text-white/50">
          {label}
        </span>
      </div>
      <p className="text-xl font-bold leading-none">{value}</p>
      <p className="text-[10px] text-white/50 mt-1">{sub}</p>
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
    bg: "rgba(59, 130, 246, 0.15)",
    fg: "#60a5fa",
    bar: "linear-gradient(90deg, #3b82f6, #6366f1)",
  },
  {
    bg: "rgba(139, 92, 246, 0.15)",
    fg: "#a78bfa",
    bar: "linear-gradient(90deg, #8b5cf6, #ec4899)",
  },
  {
    bg: "rgba(16, 185, 129, 0.15)",
    fg: "#34d399",
    bar: "linear-gradient(90deg, #10b981, #06b6d4)",
  },
  {
    bg: "rgba(251, 191, 36, 0.15)",
    fg: "#fcd34d",
    bar: "linear-gradient(90deg, #f59e0b, #ef4444)",
  },
  {
    bg: "rgba(244, 63, 94, 0.15)",
    fg: "#fb7185",
    bar: "linear-gradient(90deg, #f43f5e, #d946ef)",
  },
];

const ACHIEVEMENT_TINT: Record<string, string> = {
  brand: "bg-brand-500/20 text-brand-300",
  gold: "bg-accent-gold/20 text-accent-gold",
  mint: "bg-accent-mint/20 text-accent-mint",
  rose: "bg-accent-rose/20 text-accent-rose",
  violet: "bg-accent-violet/20 text-accent-violet",
};
