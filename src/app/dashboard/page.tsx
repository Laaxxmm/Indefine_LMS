import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCourseStatusForUser } from "@/lib/kra";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const userId = session.user.id;
  const role = session.user.role;
  const sp = await searchParams;

  const courses = await prisma.course.findMany({
    where: { published: true },
    include: {
      modules: {
        include: {
          videos: {
            orderBy: { order: "asc" },
            include: {
              progresses: { where: { userId } },
              quiz: { include: { attempts: { where: { userId } } } },
            },
          },
        },
        orderBy: { order: "asc" },
      },
      deadlines: true,
    },
    orderBy: { order: "asc" },
  });

  const allVideos = courses.flatMap((c) => c.modules.flatMap((m) => m.videos));
  const completed = allVideos.filter((v) => v.progresses[0]?.completed).length;

  const statuses = await getCourseStatusForUser(userId);
  const statusByCourse = new Map(statuses.map((s) => [s.courseId, s]));
  const upcoming = statuses
    .flatMap((s) =>
      s.deadlines
        .filter((d) => d.state === "pending")
        .map((d) => ({ ...d, courseTitle: s.courseTitle, courseId: s.courseId }))
    )
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];
  const daysUntil = upcoming
    ? Math.ceil((upcoming.dueAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  // Pick active module (defaults to first module of first course with videos)
  const allModules = courses.flatMap((c) =>
    c.modules.map((m) => ({ ...m, courseTitle: c.title }))
  );
  const modulesWithVideos = allModules.filter((m) => m.videos.length > 0);
  const activeModuleId =
    sp.module && modulesWithVideos.some((m) => m.id === sp.module)
      ? sp.module
      : modulesWithVideos[0]?.id;
  const activeModule = modulesWithVideos.find((m) => m.id === activeModuleId);

  return (
    <main className="min-h-screen px-6 py-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">Welcome, {session.user.name}</h1>
          <p className="text-white/60 mt-1 text-sm">
            {completed} / {allVideos.length} videos completed across {modulesWithVideos.length} modules
          </p>
        </div>
        <div className="flex items-center gap-2">
          {role === "ADMIN" && (
            <Link
              href="/admin"
              className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
            >
              Admin
            </Link>
          )}
          <Link
            href="/leaderboard"
            className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm"
          >
            Leaderboard
          </Link>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {upcoming && daysUntil != null && (
        <div
          className={`mb-6 rounded-xl border p-4 flex items-center justify-between ${
            daysUntil <= 3
              ? "bg-red-500/10 border-red-500/30"
              : daysUntil <= 7
                ? "bg-yellow-500/10 border-yellow-500/30"
                : "bg-white/5 border-white/10"
          }`}
        >
          <div>
            <p className="text-xs text-white/60 uppercase tracking-wide">Next deadline</p>
            <p className="font-semibold mt-0.5">
              {upcoming.courseTitle}{" "}
              <span className="text-white/50 font-normal text-sm">
                · {upcoming.kind.toLowerCase()}
              </span>
            </p>
            <p className="text-sm text-white/70">
              Due {upcoming.dueAt.toLocaleDateString()} ·{" "}
              {daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `${daysUntil} days remaining`}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-white/60">On-time</p>
            <p className="font-bold text-lg">{upcoming.pointsOnTime} pt</p>
          </div>
        </div>
      )}

      {modulesWithVideos.length === 0 ? (
        <div className="rounded-xl bg-white/5 border border-white/10 p-8 text-center">
          <p className="text-white/70 mb-4">
            No videos yet. {role === "ADMIN" ? "Sync your SharePoint folder to get started." : "Check back soon."}
          </p>
          {role === "ADMIN" && (
            <Link
              href="/admin"
              className="inline-block px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600"
            >
              Open admin
            </Link>
          )}
        </div>
      ) : (
        <>
          <ModuleTabs
            modules={modulesWithVideos}
            activeId={activeModuleId!}
            statusByCourse={statusByCourse}
          />
          {activeModule && <ModulePane module={activeModule} />}
        </>
      )}
    </main>
  );
}

function ModuleTabs({
  modules,
  activeId,
}: {
  modules: {
    id: string;
    title: string;
    courseTitle: string;
    videos: { progresses: { completed: boolean }[] }[];
  }[];
  activeId: string;
  statusByCourse: Map<string, unknown>;
}) {
  return (
    <div className="border-b border-white/10 mb-6 overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {modules.map((m) => {
          const total = m.videos.length;
          const done = m.videos.filter((v) => v.progresses[0]?.completed).length;
          const isActive = m.id === activeId;
          return (
            <Link
              key={m.id}
              href={`/dashboard?module=${m.id}`}
              scroll={false}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition flex items-center gap-2 ${
                isActive
                  ? "border-brand-500 text-white"
                  : "border-transparent text-white/60 hover:text-white hover:border-white/30"
              }`}
            >
              <span>{m.title}</span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  isActive ? "bg-brand-500/20 text-brand-500" : "bg-white/10 text-white/60"
                }`}
              >
                {done}/{total}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ModulePane({
  module: mod,
}: {
  module: {
    id: string;
    title: string;
    description: string | null;
    courseTitle: string;
    videos: {
      id: string;
      title: string;
      durationSeconds: number | null;
      progresses: { percent: number; completed: boolean }[];
      quiz: {
        id: string;
        title: string;
        passPercent: number;
        attempts: { passed: boolean; percent: number }[];
      } | null;
    }[];
  };
}) {
  const totalVideos = mod.videos.length;
  const doneVideos = mod.videos.filter((v) => v.progresses[0]?.completed).length;
  const overallPct = totalVideos > 0 ? (doneVideos / totalVideos) * 100 : 0;

  const quizzes = mod.videos.filter((v) => v.quiz);
  const passedQuizzes = quizzes.filter(
    (v) => v.quiz!.attempts.some((a) => a.passed)
  ).length;

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wide text-white/50 mb-1">
          {mod.courseTitle}
        </p>
        <h2 className="text-2xl font-bold">{mod.title}</h2>
        {mod.description && (
          <p className="text-white/60 mt-1 text-sm">{mod.description}</p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden max-w-md">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{ width: `${overallPct}%` }}
            />
          </div>
          <span className="text-sm text-white/60">
            {Math.round(overallPct)}% module progress
          </span>
        </div>
      </div>

      <section className="mb-10">
        <h3 className="text-lg font-semibold mb-4">
          Videos <span className="text-white/40 font-normal text-sm">({totalVideos})</span>
        </h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {mod.videos.map((v, i) => {
            const p = v.progresses[0];
            const pct = Math.round(p?.percent ?? 0);
            const passed = v.quiz?.attempts.some((a) => a.passed);
            return (
              <Link
                key={v.id}
                href={`/video/${v.id}`}
                className="group rounded-xl bg-white/5 border border-white/10 p-4 hover:bg-white/10 hover:border-white/20 transition"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-brand-500/20 text-brand-500 flex items-center justify-center text-xs font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm leading-snug line-clamp-2 mb-1">
                      {prettifyName(v.title)}
                    </h4>
                    <div className="flex items-center gap-2 text-xs text-white/50">
                      {v.durationSeconds && (
                        <span>{formatDuration(v.durationSeconds)}</span>
                      )}
                      {v.quiz && (
                        <>
                          <span>·</span>
                          <span>Quiz</span>
                        </>
                      )}
                    </div>
                  </div>
                  {p?.completed && (
                    <span className="text-[10px] bg-green-500/20 text-green-300 px-2 py-1 rounded-full shrink-0">
                      Done
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 transition-all"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-white/50 tabular-nums w-10 text-right">
                    {pct}%
                  </span>
                </div>
                {v.quiz && (
                  <p className="text-[10px] mt-2 text-white/50">
                    {passed ? (
                      <span className="text-green-300">Quiz passed</span>
                    ) : (
                      "Quiz pending"
                    )}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      {quizzes.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold mb-4">
            Quizzes{" "}
            <span className="text-white/40 font-normal text-sm">
              ({passedQuizzes}/{quizzes.length} passed)
            </span>
          </h3>
          <div className="rounded-xl bg-white/5 border border-white/10 divide-y divide-white/10">
            {quizzes.map((v) => {
              const best = v.quiz!.attempts.reduce<
                { passed: boolean; percent: number } | null
              >((acc, a) => (acc == null || a.percent > acc.percent ? a : acc), null);
              const watched = v.progresses[0]?.percent ?? 0;
              const unlocked = watched >= 90;
              return (
                <div
                  key={v.quiz!.id}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {prettifyName(v.title)}
                    </p>
                    <p className="text-xs text-white/50 mt-0.5">
                      Pass {v.quiz!.passPercent}%
                      {best && ` · best ${best.percent.toFixed(0)}%`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {best?.passed && (
                      <span className="text-xs text-green-300">Passed</span>
                    )}
                    {unlocked ? (
                      <Link
                        href={`/quiz/${v.quiz!.id}`}
                        className="text-xs px-3 py-1.5 rounded bg-brand-500 hover:bg-brand-600"
                      >
                        {best ? "Retake" : "Start"}
                      </Link>
                    ) : (
                      <span className="text-xs text-white/40">
                        Watch 90% to unlock
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function prettifyName(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}
