import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCourseStatusForUser } from "@/lib/kra";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const userId = session.user.id;
  const role = session.user.role;

  const myAssignments = await prisma.assignment.findMany({
    where: { userId },
    include: { video: true },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
  });

  const modules = await prisma.module.findMany({
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
  });

  const modulesWithVideos = modules.filter((m) => m.videos.length > 0);
  const allVideos = modulesWithVideos.flatMap((m) => m.videos);
  const totalCompleted = allVideos.filter(
    (v) => v.progresses[0]?.completed
  ).length;

  const statuses = await getCourseStatusForUser(userId);
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

  return (
    <main className="min-h-screen px-6 py-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            Welcome, {session.user.name}
          </h1>
          <p className="text-white/60 mt-1 text-sm">
            {totalCompleted} / {allVideos.length} videos completed across{" "}
            {modulesWithVideos.length} module
            {modulesWithVideos.length === 1 ? "" : "s"}
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
            <p className="text-xs text-white/60 uppercase tracking-wide">
              Next deadline
            </p>
            <p className="font-semibold mt-0.5">
              {upcoming.courseTitle}{" "}
              <span className="text-white/50 font-normal text-sm">
                · {upcoming.kind.toLowerCase()}
              </span>
            </p>
            <p className="text-sm text-white/70">
              Due {upcoming.dueAt.toLocaleDateString()} ·{" "}
              {daysUntil === 0
                ? "today"
                : daysUntil === 1
                  ? "tomorrow"
                  : `${daysUntil} days remaining`}
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="text-white/60">On-time</p>
            <p className="font-bold text-lg">{upcoming.pointsOnTime} pt</p>
          </div>
        </div>
      )}

      {myAssignments.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3">
            My assignments{" "}
            <span className="text-white/40 font-normal text-sm">
              ({myAssignments.filter((a) => a.status === "PENDING").length}{" "}
              pending ·{" "}
              {myAssignments.reduce(
                (s, a) => s + (a.status === "COMPLETED" ? a.points : 0),
                0
              )}{" "}
              / {myAssignments.reduce((s, a) => s + a.points, 0)} pts earned)
            </span>
          </h2>
          <div className="rounded-xl bg-white/5 border border-white/10 divide-y divide-white/5 overflow-hidden">
            {myAssignments.map((a) => {
              const overdue =
                a.status === "PENDING" && a.dueAt && a.dueAt < new Date();
              return (
                <div
                  key={a.id}
                  className="px-4 py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          a.kind === "VIDEO"
                            ? "bg-blue-500/20 text-blue-300"
                            : "bg-purple-500/20 text-purple-300"
                        }`}
                      >
                        {a.kind}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          a.status === "COMPLETED"
                            ? "bg-green-500/20 text-green-300"
                            : overdue
                              ? "bg-red-500/20 text-red-300"
                              : "bg-white/10 text-white/70"
                        }`}
                      >
                        {a.status === "COMPLETED"
                          ? "Done"
                          : overdue
                            ? "Overdue"
                            : "Pending"}
                      </span>
                      <span className="text-xs text-white/60">
                        {a.points} pt
                      </span>
                    </div>
                    <p className="text-sm font-medium truncate">{a.title}</p>
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
                        className="text-xs px-3 py-1.5 rounded bg-brand-500 hover:bg-brand-600 shrink-0"
                      >
                        Open video
                      </Link>
                    )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <h2 className="text-lg font-semibold mb-4">Courses</h2>

      {modulesWithVideos.length === 0 ? (
        <div className="rounded-xl bg-white/5 border border-white/10 p-8 text-center">
          <p className="text-white/70 mb-4">
            No courses yet.{" "}
            {role === "ADMIN"
              ? "Sync your SharePoint folder to get started."
              : "Check back soon."}
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
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {modulesWithVideos.map((m) => {
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
            // Resume from the next unfinished video, or start at the first.
            const nextVideo =
              m.videos.find((v) => !v.progresses[0]?.completed) ?? m.videos[0];

            return (
              <Link
                key={m.id}
                href={`/video/${nextVideo.id}`}
                className="group rounded-xl bg-white/5 border border-white/10 p-5 hover:bg-white/10 hover:border-white/20 transition flex flex-col"
              >
                <p className="text-[10px] uppercase tracking-wide text-white/50 mb-1">
                  {m.course.title}
                </p>
                <h3 className="text-lg font-semibold mb-3">{m.title}</h3>

                <div className="flex items-center gap-3 text-xs text-white/60 mb-4">
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                    {total} video{total === 1 ? "" : "s"}
                  </span>
                  {totalQuizzes > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                      {totalQuizzes} quiz
                      {totalQuizzes === 1 ? "" : "zes"}
                    </span>
                  )}
                  {totalDuration > 0 && (
                    <span>{formatTotalDuration(totalDuration)}</span>
                  )}
                </div>

                <div className="mt-auto">
                  <div className="flex items-center justify-between text-xs text-white/60 mb-1.5">
                    <span>
                      {done}/{total} videos
                      {totalQuizzes > 0 &&
                        ` · ${passedQuizzes}/${totalQuizzes} quizzes`}
                    </span>
                    <span className="font-medium">{Math.round(pct)}%</span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-white/50 mt-3 group-hover:text-white">
                    {done === 0 ? "Start course →" : "Continue →"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

function formatTotalDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
