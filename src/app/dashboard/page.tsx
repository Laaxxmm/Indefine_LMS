import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { computeKraScores, getCourseStatusForUser } from "@/lib/kra";
import { computeLevel, computeStreak } from "@/lib/gamification";
import { computeAchievements } from "@/lib/gamification";
import { computeTrajectory, ensureDefaultCycle, TIER_META } from "@/lib/trajectory";
import { OnboardingTour, type TourStep } from "@/components/OnboardingTour";
import { Logo } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { JoinMeetingButton } from "@/components/JoinMeetingButton";
import { NeoTrackChip } from "@/components/NeoTrackChip";
import {
  checkinUrgency,
  computeCheckinStreak,
  currentWeekStart,
} from "@/lib/checkins";
import { formatIst } from "@/lib/live-format";
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
  ArrowRight,
  Clock,
  Fingerprint,
  ExternalLink,
  Radio,
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
    body: "Your Trajectory tracks the six areas that make up your KRA and rolls them into a tier.",
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

// Per-track accent colors for the trajectory tiles.
const TRACK_COLOR: Record<string, string> = {
  MASTERY: "#5B4BE6",
  DELIVERY: "#17B978",
  INITIATIVE: "#FF6B4A",
  COLLABORATION: "#0EA5E9",
  VISION: "#FFB020",
  CRAFT: "#8B5CF6",
};

const COURSE_ACCENTS = ["#5B4BE6", "#17B978", "#FF6B4A", "#0EA5E9", "#8B5CF6"];

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const userId = session.user.id;
  const role = session.user.role;

  await ensureDefaultCycle();

  const streak = await computeStreak(userId);
  const [myAssignments, modules, statuses, achievements, leaderboard, trajectory] =
    await Promise.all([
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
        // Employees see only what's been allotted to them: modules assigned
        // directly, or modules containing a video assigned to them (live-
        // session recordings are auto-assigned to their attendees on ingest).
        // Admins see the whole library.
        where:
          role === "ADMIN"
            ? { course: { published: true } }
            : {
                course: { published: true },
                OR: [
                  { assignments: { some: { userId } } },
                  { videos: { some: { assignments: { some: { userId } } } } },
                ],
              },
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
      computeAchievements(userId, streak),
      computeKraScores(),
      computeTrajectory(userId),
    ]);

  const tier = TIER_META[trajectory.tier];

  const wizardUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { wizardSubmittedAt: true },
  });
  const wizardDone = !!wizardUser?.wizardSubmittedAt;

  const ws = currentWeekStart();
  const [thisWeekCheckin, checkinStreak] = await Promise.all([
    prisma.weeklyCheckin.findUnique({ where: { userId_weekStart: { userId, weekStart: ws } } }),
    computeCheckinStreak(userId),
  ]);
  const urgency = checkinUrgency();
  const showCheckinBanner = !thisWeekCheckin && urgency !== "off";

  const reportCount = await prisma.user.count({ where: { managerId: userId, active: true } });

  // In-app Teams sessions this user is invited to (live or upcoming).
  // Keep the Join button up to 45 min past the slot — meetings run over.
  const LIVE_GRACE_MS = 45 * 60 * 1000;
  const liveSessions = await prisma.liveSession.findMany({
    where: {
      endAt: { gte: new Date(Date.now() - LIVE_GRACE_MS) },
      status: { notIn: ["CANCELLED", "ENDED", "RECORDING_READY", "INGESTED"] },
    },
    orderBy: { startAt: "asc" },
    take: 25,
  });
  const myLive = liveSessions.filter(
    (s) =>
      Array.isArray(s.attendeeIds) &&
      (s.attendeeIds as string[]).includes(userId)
  );
  const nextLive = myLive[0] ?? null;
  const nextLiveIsLive = nextLive
    ? nextLive.startAt.getTime() <= Date.now() &&
      nextLive.endAt.getTime() + LIVE_GRACE_MS >= Date.now()
    : false;

  const me = leaderboard.find((r) => r.userId === userId);
  const myPoints = me?.totalScore ?? 0;
  const level = computeLevel(myPoints);

  // Rank by activity points (effort) — same basis as the leaderboard.
  const ranked = [...leaderboard].sort((a, b) => b.totalScore - a.totalScore);
  const myRankIdx = ranked.findIndex((r) => r.userId === userId);
  const myRank = myRankIdx >= 0 ? myRankIdx + 1 : null;

  const modulesWithVideos = modules.filter((m) => m.videos.length > 0);
  const allVideos = modulesWithVideos.flatMap((m) => m.videos);
  const totalCompleted = allVideos.filter((v) => v.progresses[0]?.completed).length;
  const overallPct = allVideos.length > 0 ? (totalCompleted / allVideos.length) * 100 : 0;

  // Deadlines shown only for courses the user can actually see.
  const visibleCourseIds = new Set(modulesWithVideos.map((m) => m.courseId));
  const upcoming = statuses
    .filter((s) => role === "ADMIN" || visibleCourseIds.has(s.courseId))
    .flatMap((s) =>
      s.deadlines.filter((d) => d.state === "pending").map((d) => ({ ...d, courseTitle: s.courseTitle }))
    )
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
  const daysUntil = upcoming
    ? Math.ceil((upcoming.dueAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  // "Pick up where you left off" — first module with an incomplete video.
  let resume: {
    module: (typeof modulesWithVideos)[number];
    video: (typeof allVideos)[number];
    index: number;
    total: number;
    done: number;
    pct: number;
  } | null = null;
  for (const m of modulesWithVideos) {
    const idx = m.videos.findIndex((v) => !v.progresses[0]?.completed);
    if (idx >= 0) {
      const done = m.videos.filter((v) => v.progresses[0]?.completed).length;
      resume = {
        module: m,
        video: m.videos[idx],
        index: idx,
        total: m.videos.length,
        done,
        pct: m.videos.length ? (done / m.videos.length) * 100 : 0,
      };
      break;
    }
  }

  const firstNameStr = firstName(session.user.name);
  const initial = (session.user.name ?? "?").slice(0, 1).toUpperCase();

  const statChips: { emoji: string; value: React.ReactNode; label: string }[] = [
    { emoji: "🔥", value: <>{streak.current}<span className="text-base text-ink-faint">d</span></>, label: `Streak · best ${streak.best}d` },
    { emoji: "⚡", value: myPoints, label: myRank ? `Points · rank #${myRank}` : "Points" },
    { emoji: "🎬", value: <>{totalCompleted}<span className="text-base text-ink-faint">/{allVideos.length}</span></>, label: "Videos watched" },
    { emoji: "🏅", value: <>{unlockedCount}<span className="text-base text-ink-faint">/{achievements.length}</span></>, label: "Badges earned" },
  ];

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 flex-wrap max-w-[1240px] mx-auto px-5 sm:px-10 py-[18px]">
        <Logo tagline="LEARN · GROW" size={40} />

        <nav className="flex items-center gap-1 bg-card p-1.5 rounded-full border border-border">
          <span className="px-4 py-2 rounded-full bg-brand-50 text-brand-600 font-bold text-[13.5px]">Home</span>
          <Link href="/dashboard#courses" className="px-4 py-2 rounded-full text-ink-mute font-semibold text-[13.5px] hover:text-ink transition">Courses</Link>
          <Link href="/leaderboard" data-tour="leaderboard" className="px-4 py-2 rounded-full text-ink-mute font-semibold text-[13.5px] hover:text-ink transition">Leaderboard</Link>
          <Link href="/checkin" className="px-4 py-2 rounded-full text-ink-mute font-semibold text-[13.5px] hover:text-ink transition">Check-in</Link>
          <Link href="/recap/year" className="px-4 py-2 rounded-full text-ink-mute font-semibold text-[13.5px] hover:text-ink transition">Recap</Link>
          <Link href="/tools" className="px-4 py-2 rounded-full text-ink-mute font-semibold text-[13.5px] hover:text-ink transition">Tools</Link>
        </nav>

        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border"
            style={{ background: "linear-gradient(135deg,#FFF4E0,#FFE9D6)", borderColor: "#FFE0B8" }}
          >
            <span className="text-[15px]">🔥</span>
            <span className="font-extrabold text-sm text-amber-700">{streak.current}</span>
            <span className="text-[11px] font-bold text-amber-600 tracking-wide">
              DAY{streak.current === 1 ? "" : "S"}
            </span>
          </div>
          <UserMenu
            name={session.user.name ?? "You"}
            initial={initial}
            isAdmin={role === "ADMIN"}
            reportCount={reportCount}
            signOutAction={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          />
        </div>
      </header>

      <div className="max-w-[1240px] mx-auto px-5 sm:px-10 pt-2 pb-16 flex flex-col gap-[22px]">
        {/* Directors: incentive-track status (hidden for everyone else) */}
        <NeoTrackChip />
        {/* Hero + stat chips */}
        <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5">
          <div
            className="relative overflow-hidden rounded-[26px] p-8 sm:p-9 text-white animate-fade-in"
            style={{
              background: "linear-gradient(135deg,#5B4BE6,#7A5CF5 55%,#9B6BF0)",
              boxShadow: "0 20px 50px -20px rgba(91,75,230,0.6)",
            }}
          >
            <div className="absolute right-[-30px] top-[-30px] text-[150px] opacity-[0.14] animate-pulse-soft select-none">🚀</div>
            <div className="relative">
              <p className="text-sm font-semibold opacity-85">{greeting()},</p>
              <h1 className="font-display font-extrabold text-4xl sm:text-[44px] tracking-[-0.03em] leading-none my-1.5">
                {firstNameStr} 👋
              </h1>
              <p className="text-[15px] opacity-90 max-w-[400px]">
                {streak.activeToday
                  ? <>You&apos;re on a <b>{streak.current}-day streak</b> — keep the fire alive.</>
                  : streak.current > 0
                    ? <>You&apos;re on a <b>{streak.current}-day streak</b> — watch one video today to keep it alive.</>
                    : <>Watch a video today to start your learning streak.</>}
              </p>
              <div className="mt-6">
                <div className="flex justify-between text-[12.5px] font-bold mb-2 opacity-90">
                  <span>Level {level.level}</span>
                  <span>{level.pointsIntoLevel} / {level.pointsForNextLevel} XP</span>
                </div>
                <div className="h-2.5 bg-white/25 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${level.pctToNext}%`,
                      background: "linear-gradient(90deg,#FFD84D,#FFB020)",
                      boxShadow: "0 0 12px rgba(255,200,50,0.6)",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            {statChips.map((s, i) => (
              <div key={i} className="bg-card border border-border rounded-[18px] p-[18px]">
                <div className="text-[22px]">{s.emoji}</div>
                <div className="font-display font-extrabold text-[28px] mt-1.5">{s.value}</div>
                <div className="text-xs font-bold text-ink-mute">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Live & upcoming sessions (Teams) */}
        {nextLive && (
          <div className="flex flex-col gap-3">
            <div
              className="rounded-[22px] p-[22px] sm:px-6 flex flex-col sm:flex-row sm:items-center gap-4 text-white relative overflow-hidden"
              style={{ background: "linear-gradient(135deg,#5B4BE6,#8B5CF6 55%,#EC4899)" }}
            >
              <div className="absolute right-[-20px] top-[-24px] text-[120px] opacity-[0.12] select-none pointer-events-none">
                📡
              </div>
              <div className="relative shrink-0 w-12 h-12 rounded-2xl bg-white/20 grid place-items-center">
                <Radio className="w-6 h-6" />
              </div>
              <div className="relative flex-1 min-w-0">
                <div className="text-[11px] font-extrabold tracking-[0.1em] text-white/80 flex items-center gap-1.5">
                  {nextLiveIsLive ? (
                    <>
                      <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                      LIVE NOW · TEAMS
                    </>
                  ) : (
                    "LIVE SESSION · TEAMS"
                  )}
                </div>
                <h3 className="font-display text-xl font-extrabold leading-tight mt-0.5 truncate">
                  {nextLive.title}
                </h3>
                <p className="text-sm text-white/85 mt-1">{formatIst(nextLive.startAt)}</p>
              </div>
              {nextLive.joinUrl && (
                <JoinMeetingButton
                  joinUrl={nextLive.joinUrl}
                  className="relative shrink-0 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-white text-brand-600 font-bold shadow-lift hover:bg-white/95 transition"
                >
                  {nextLiveIsLive ? "Join now" : "Join"}
                  <ExternalLink className="w-4 h-4" />
                </JoinMeetingButton>
              )}
            </div>

            {myLive.length > 1 && (
              <div className="bg-card border border-border rounded-[18px] divide-y divide-border overflow-hidden">
                {myLive.slice(1).map((s) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 grid place-items-center shrink-0">
                      <Radio className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm truncate">{s.title}</p>
                      <p className="text-xs text-ink-mute">{formatIst(s.startAt)}</p>
                    </div>
                    {s.joinUrl && (
                      <JoinMeetingButton
                        joinUrl={s.joinUrl}
                        className="shrink-0 text-xs font-bold text-brand-600 hover:text-brand-700 inline-flex items-center gap-1.5"
                      >
                        Join
                        <ExternalLink className="w-3.5 h-3.5" />
                      </JoinMeetingButton>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Resume card — primary action */}
        {resume && (
          <div className="bg-card border border-border rounded-[22px] p-[22px] sm:px-6 flex flex-col sm:flex-row items-start sm:items-center gap-5 shadow-lift">
            <div
              className="shrink-0 w-full sm:w-28 h-24 sm:h-[78px] rounded-2xl grid place-items-center relative"
              style={{ background: "linear-gradient(135deg,#5B4BE6,#8A6BF5)" }}
            >
              <div className="w-0 h-0 ml-1" style={{ borderLeft: "16px solid #fff", borderTop: "11px solid transparent", borderBottom: "11px solid transparent" }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-extrabold tracking-[0.1em] text-accent-coral">PICK UP WHERE YOU LEFT OFF</div>
              <div className="font-display font-bold text-[22px] mt-0.5 mb-0.5 truncate">
                {resume.module.title} — {prettify(resume.video.title)}
              </div>
              <div className="text-[13px] text-ink-mute font-semibold">
                Lesson {resume.index + 1} of {resume.total} · {Math.round(resume.pct)}% complete
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden mt-2.5 max-w-[420px]">
                <div className="h-full rounded-full" style={{ width: `${resume.pct}%`, background: "linear-gradient(90deg,#5B4BE6,#8A6BF5)" }} />
              </div>
            </div>
            <Link
              href={`/video/${resume.video.id}`}
              className="shrink-0 font-bold text-[15px] text-white bg-brand-500 hover:bg-brand-600 transition px-6 py-3.5 rounded-[14px] shadow-pop w-full sm:w-auto text-center"
            >
              Continue →
            </Link>
          </div>
        )}

        {/* Trajectory */}
        {trajectory.cycle && (
          <div data-tour="trajectory" className="bg-card border border-border rounded-[22px] p-6 sm:p-7">
            <div className="flex items-start justify-between gap-5 flex-wrap">
              <div className="flex gap-5 sm:gap-6 items-center">
                <div
                  className="relative w-[104px] h-[104px] shrink-0 rounded-full grid place-items-center"
                  style={{ background: `conic-gradient(#5B4BE6 0 ${Math.round(trajectory.totalScore)}%, #EAE8F7 ${Math.round(trajectory.totalScore)}% 100%)` }}
                >
                  <div className="w-20 h-20 rounded-full bg-card grid place-items-center text-center">
                    <div>
                      <div className="text-[9px] font-extrabold tracking-[0.1em] text-ink-faint">TIER</div>
                      <div className={`font-display font-extrabold text-base ${tier.fg}`}>{tier.label}</div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-extrabold tracking-[0.1em] text-ink-mute">
                    TRAJECTORY · Q{trajectory.quarter} · {trajectory.cycle.name}
                  </div>
                  <div className="font-display font-extrabold text-[28px] sm:text-[30px] tracking-[-0.02em] my-0.5">
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
                  </div>
                  <div className="text-sm text-ink-mute font-semibold max-w-[360px]">{tier.blurb}</div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-extrabold tracking-[0.1em] text-ink-mute">TOTAL SCORE</div>
                <div className="font-display font-extrabold text-5xl leading-none tracking-[-0.03em]">
                  {Math.round(trajectory.totalScore)}
                  <span className="text-[22px] text-ink-faint">/100</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 mt-6">
              {trajectory.tracks.map((t) => {
                const c = TRACK_COLOR[t.kind] ?? "#5B4BE6";
                return (
                  <div key={t.kind} className="border border-border rounded-2xl p-4" style={{ background: "#FAFAFE" }} title={t.nextMove}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <span>{t.emoji}</span>
                        <span>{t.label}</span>
                      </div>
                      <span className="text-[11px] font-bold text-ink-faint">{t.weight}% wt</span>
                    </div>
                    {t.hasData ? (
                      <>
                        <div className="font-display font-extrabold text-2xl my-2">{Math.round(t.scorePct)}</div>
                        <div className="h-[7px] rounded-full overflow-hidden" style={{ background: "#EEEDF4" }}>
                          <div className="h-full rounded-full" style={{ width: `${t.scorePct}%`, background: c }} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-display font-extrabold text-2xl my-2 text-ink-faint">—</div>
                        <p className="text-[11px] text-ink-faint">Not counted yet — no activity here</p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Nudge banners */}
        {(showCheckinBanner || (!wizardDone && trajectory.cycle)) && (
          <div className="grid sm:grid-cols-2 gap-4">
            {showCheckinBanner && (
              <Link
                href="/checkin"
                className="flex items-center gap-4 rounded-[18px] px-5 py-[18px] border"
                style={{ background: "linear-gradient(135deg,#E9F7F0,#F2FBF7)", borderColor: "#CFEEDF" }}
              >
                <div className="shrink-0 w-[46px] h-[46px] rounded-[13px] bg-white grid place-items-center text-[22px] shadow-soft">💬</div>
                <div className="flex-1">
                  <div className="text-[10.5px] font-extrabold tracking-[0.1em]" style={{ color: "#12946A" }}>
                    WEEKLY CHECK-IN · 90 SECONDS
                    {checkinStreak.current > 0 && <span className="ml-2">🔥 {checkinStreak.current}w</span>}
                  </div>
                  <div className="font-display font-bold text-[17px]">Take a breath and reflect →</div>
                </div>
              </Link>
            )}
            {!wizardDone && trajectory.cycle && (
              <Link
                href="/wizard"
                className="flex items-center gap-4 rounded-[18px] px-5 py-[18px] border"
                style={{ background: "linear-gradient(135deg,#EEEBFF,#F5F2FF)", borderColor: "#DDD6FA" }}
              >
                <div className="shrink-0 w-[46px] h-[46px] rounded-[13px] bg-white grid place-items-center text-[22px] shadow-soft">✨</div>
                <div className="flex-1">
                  <div className="text-[10.5px] font-extrabold tracking-[0.1em] text-brand-600">SET YOUR TRAJECTORY · 5 MIN</div>
                  <div className="font-display font-bold text-[17px]">Take the Growth Wizard →</div>
                </div>
              </Link>
            )}
          </div>
        )}

        {/* Courses */}
        <section id="courses">
          <div className="flex items-baseline justify-between mb-3.5">
            <div className="font-display font-extrabold text-2xl tracking-[-0.02em]">Your courses</div>
            {modulesWithVideos.length > 0 && (
              <span className="text-[13px] font-bold text-ink-mute">
                {modulesWithVideos.length} module{modulesWithVideos.length === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {modulesWithVideos.length === 0 ? (
            <div className="rounded-[20px] bg-card border border-dashed border-border p-12 text-center">
              <div className="text-4xl mb-3">🎬</div>
              <p className="font-semibold mb-1">
                {role === "ADMIN" ? "No courses yet" : "No courses allotted yet"}
              </p>
              <p className="text-ink-mute text-sm">
                {role === "ADMIN"
                  ? "Sync your SharePoint folder to import videos."
                  : "Your admin assigns your training — it'll appear here the moment something is allotted to you."}
              </p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {modulesWithVideos.map((m, idx) => {
                const total = m.videos.length;
                const done = m.videos.filter((v) => v.progresses[0]?.completed).length;
                const pct = total > 0 ? (done / total) * 100 : 0;
                const totalQuizzes = m.videos.filter((v) => v.quiz).length;
                const totalDuration = m.videos.reduce((s, v) => s + (v.durationSeconds ?? 0), 0);
                const nextVideo = m.videos.find((v) => !v.progresses[0]?.completed) ?? m.videos[0];
                const accent = COURSE_ACCENTS[idx % COURSE_ACCENTS.length];
                return (
                  <Link
                    key={m.id}
                    href={`/video/${nextVideo.id}`}
                    className="group bg-card border border-border rounded-[20px] overflow-hidden shadow-lift block hover:-translate-y-0.5 transition"
                  >
                    <div className="h-1.5" style={{ background: accent }} />
                    <div className="p-5">
                      <div className="w-11 h-11 rounded-[13px] grid place-items-center mb-3.5" style={{ background: `${accent}22` }}>
                        <div className="w-0 h-0 ml-1" style={{ borderLeft: `13px solid ${accent}`, borderTop: "9px solid transparent", borderBottom: "9px solid transparent" }} />
                      </div>
                      <div className="text-[10.5px] font-extrabold tracking-[0.1em] text-ink-faint">{m.course.title.toUpperCase()}</div>
                      <div className="font-display font-bold text-xl my-0.5 mb-2 leading-tight">{m.title}</div>
                      <div className="text-[12.5px] text-ink-mute font-semibold">
                        {total} video{total === 1 ? "" : "s"}
                        {totalQuizzes > 0 && ` · ${totalQuizzes} quiz${totalQuizzes === 1 ? "" : "zes"}`}
                        {totalDuration > 0 && ` · ${formatTotalDuration(totalDuration)}`}
                      </div>
                      <div className="flex items-center justify-between my-3.5 mb-2 text-xs font-bold">
                        <span className="text-ink-mute">{done}/{total} done</span>
                        <span>{Math.round(pct)}%</span>
                      </div>
                      <div className="h-[7px] bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: accent }} />
                      </div>
                      <div
                        className="mt-4 w-full border border-border font-bold text-sm py-2.5 rounded-xl text-center transition group-hover:bg-muted"
                        style={{ color: accent }}
                      >
                        {done === 0 ? "Start" : "Continue"} →
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Attendance */}
        <section data-tour="attendance">
          <div className="font-display font-extrabold text-2xl tracking-[-0.02em] mb-3.5">Attendance &amp; daily punch</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <a href="https://streamlining.greythr.com/" target="_blank" rel="noreferrer" className="group bg-card border border-border rounded-[20px] p-5 flex items-center gap-4 hover:-translate-y-0.5 transition shadow-lift">
              <div className="w-12 h-12 rounded-[13px] grid place-items-center text-[22px]" style={{ background: "#E6F7F0" }}>🕑</div>
              <div className="flex-1 min-w-0">
                <div className="text-[10.5px] font-extrabold tracking-[0.1em] text-ink-faint">PUNCH IN / OUT</div>
                <div className="font-display font-bold text-lg">greytHR</div>
                <div className="text-[13px] text-ink-mute font-semibold">Mark your daily attendance</div>
              </div>
              <ExternalLink className="w-4 h-4 text-ink-faint group-hover:text-brand-500 transition shrink-0" />
            </a>
            <a href="https://practice.turia.in/" target="_blank" rel="noreferrer" className="group bg-card border border-border rounded-[20px] p-5 flex items-center gap-4 hover:-translate-y-0.5 transition shadow-lift">
              <div className="w-12 h-12 rounded-[13px] grid place-items-center text-[22px]" style={{ background: "#EEEBFF" }}>💼</div>
              <div className="flex-1 min-w-0">
                <div className="text-[10.5px] font-extrabold tracking-[0.1em] text-ink-faint">PRACTICE PORTAL</div>
                <div className="font-display font-bold text-lg">Turia</div>
                <div className="text-[13px] text-ink-mute font-semibold">Log in to your workspace</div>
              </div>
              <ExternalLink className="w-4 h-4 text-ink-faint group-hover:text-brand-500 transition shrink-0" />
            </a>
          </div>
        </section>

        {/* Deadline + assignments summary */}
        {(upcoming || myAssignments.length > 0) && (
          <div className="grid sm:grid-cols-2 gap-4">
            {upcoming && daysUntil != null && (
              <div
                className="rounded-[20px] p-5 flex items-center gap-4 border"
                style={
                  daysUntil <= 3
                    ? { background: "#FFECEC", borderColor: "#FBD5CB" }
                    : daysUntil <= 7
                      ? { background: "#FFF6E0", borderColor: "#FBEBC4" }
                      : { background: "#fff", borderColor: "#ECECF3" }
                }
              >
                <div className="w-12 h-12 rounded-[13px] grid place-items-center shrink-0 bg-white">
                  <Calendar className="w-6 h-6 text-ink-mute" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10.5px] uppercase tracking-[0.1em] text-ink-faint font-extrabold">Next deadline · {upcoming.kind.toLowerCase()}</div>
                  <div className="font-bold mt-0.5 truncate">{upcoming.courseTitle}</div>
                  <div className="text-sm text-ink-mute font-semibold mt-0.5">
                    {daysUntil === 0 ? "Due today" : daysUntil === 1 ? "Due tomorrow" : `${daysUntil} days left`} · {upcoming.pointsOnTime} pt
                  </div>
                </div>
              </div>
            )}
            {myAssignments.length > 0 && (
              <Link href="#assignments" className="rounded-[20px] bg-card border border-border p-5 flex items-center gap-4 hover:-translate-y-0.5 transition shadow-lift">
                <div className="w-12 h-12 rounded-[13px] grid place-items-center shrink-0" style={{ background: "#EEEBFF" }}>
                  <Target className="w-6 h-6 text-brand-600" />
                </div>
                <div className="flex-1">
                  <div className="text-[10.5px] uppercase tracking-[0.1em] text-ink-faint font-extrabold">My assignments</div>
                  <div className="font-bold mt-0.5">{myAssignments.filter((a) => a.status === "PENDING").length} pending</div>
                  <div className="text-sm text-ink-mute font-semibold mt-0.5">
                    {myAssignments.reduce((s, a) => s + (a.status === "COMPLETED" ? a.points : 0), 0)} / {myAssignments.reduce((s, a) => s + a.points, 0)} pts earned
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-ink-faint" />
              </Link>
            )}
          </div>
        )}

        {/* Achievements */}
        <section>
          <div className="flex items-baseline justify-between mb-3.5">
            <div className="font-display font-extrabold text-2xl tracking-[-0.02em]">🏅 Achievements</div>
            <span className="text-[13px] font-bold text-ink-mute">{unlockedCount} / {achievements.length} unlocked</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
            {achievements.map((a) => {
              const Icon = ICON_MAP[a.icon] ?? Sparkles;
              return (
                <div
                  key={a.id}
                  title={a.description}
                  className={`rounded-2xl border p-4 text-center relative ${a.unlocked ? "" : "border-border bg-card"}`}
                  style={a.unlocked ? { background: "linear-gradient(135deg,#FFF7E6,#FFF0F0)", borderColor: "#FFE0B8" } : {}}
                >
                  {a.unlocked && <div className="absolute top-2 right-2 text-[11px]">✅</div>}
                  <div className={`grid place-items-center ${a.unlocked ? "text-amber-600" : "text-ink-faint opacity-40"}`}>
                    <Icon className="w-7 h-7 mx-auto" />
                  </div>
                  <div className="text-[10px] font-bold mt-1.5 leading-tight text-ink-soft">{a.title}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Assignments full list */}
        {myAssignments.length > 0 && (
          <section id="assignments">
            <div className="font-display font-extrabold text-2xl tracking-[-0.02em] mb-3.5">My assignments</div>
            <div className="rounded-[20px] bg-card border border-border divide-y divide-border overflow-hidden">
              {myAssignments.map((a) => {
                const overdue = a.status === "PENDING" && a.dueAt && a.dueAt < new Date();
                return (
                  <div key={a.id} className="px-5 py-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[10px] uppercase tracking-wide font-extrabold px-2 py-0.5 rounded-full ${a.kind === "VIDEO" ? "bg-brand-50 text-brand-700" : a.kind === "MODULE" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"}`}>{a.kind}</span>
                        <span className={`text-[10px] uppercase tracking-wide font-extrabold px-2 py-0.5 rounded-full ${a.status === "COMPLETED" ? "bg-emerald-50 text-emerald-700" : overdue ? "bg-rose-50 text-rose-700" : "bg-muted text-ink-mute"}`}>
                          {a.status === "COMPLETED" ? "Done" : overdue ? "Overdue" : "Pending"}
                        </span>
                        <span className="text-xs text-amber-600 font-bold">+{a.points} pt</span>
                      </div>
                      <p className="font-semibold truncate">{a.title}</p>
                      {a.dueAt && a.status === "PENDING" && <p className="text-xs text-ink-mute mt-0.5">Due {a.dueAt.toLocaleDateString()}</p>}
                    </div>
                    {a.status === "PENDING" && (() => {
                      const targetVideoId =
                        a.kind === "VIDEO"
                          ? a.videoId
                          : a.kind === "MODULE" && a.module
                            ? (a.module.videos.find((v) => !v.progresses[0]?.completed)?.id ?? a.module.videos[0]?.id)
                            : null;
                      if (!targetVideoId) return null;
                      return (
                        <Link href={`/video/${targetVideoId}`} className="text-xs px-3 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-bold shrink-0 flex items-center gap-1.5 transition">
                          {a.kind === "MODULE" ? "Open module" : "Open"} <ArrowRight className="w-3 h-3" />
                        </Link>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <OnboardingTour steps={TOUR_STEPS} />
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

function prettify(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
}

function formatTotalDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
