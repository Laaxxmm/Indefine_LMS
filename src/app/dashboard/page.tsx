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

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold">Welcome, {session.user.name}</h1>
          <p className="text-white/60 mt-1">
            {completed} / {allVideos.length} videos completed
          </p>
        </div>
        <div className="flex items-center gap-3">
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
          className={`mb-8 rounded-xl border p-5 flex items-center justify-between ${
            daysUntil <= 3
              ? "bg-red-500/10 border-red-500/30"
              : daysUntil <= 7
                ? "bg-yellow-500/10 border-yellow-500/30"
                : "bg-white/5 border-white/10"
          }`}
        >
          <div>
            <p className="text-sm text-white/60">Next deadline</p>
            <p className="font-semibold mt-1">
              {upcoming.courseTitle}
              <span className="text-white/50 font-normal"> • {upcoming.kind.toLowerCase()}</span>
            </p>
            <p className="text-sm text-white/70 mt-1">
              Due {upcoming.dueAt.toLocaleDateString()} •{" "}
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

      {courses.length === 0 && (
        <div className="rounded-xl bg-white/5 border border-white/10 p-8 text-center">
          <p className="text-white/70 mb-4">
            No courses yet. {role === "ADMIN" ? "Sync your OneDrive folder to get started." : "Check back soon."}
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
      )}

      <div className="space-y-10">
        {courses.map((course) => {
          const status = statusByCourse.get(course.id);
          return (
          <section key={course.id}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl font-semibold">{course.title}</h2>
                {course.description && (
                  <p className="text-white/60 mt-1">{course.description}</p>
                )}
              </div>
              {status && status.deadlines.length > 0 && (
                <div className="text-right text-xs text-white/60 shrink-0">
                  {status.deadlines.slice(0, 2).map((d) => (
                    <div key={d.id} className="flex items-center justify-end gap-2 mb-0.5">
                      <span
                        className={
                          d.state === "on-time"
                            ? "text-green-300"
                            : d.state === "late"
                              ? "text-yellow-300"
                              : d.state === "missed"
                                ? "text-red-300"
                                : "text-white/70"
                        }
                      >
                        {d.kind.toLowerCase()}: {d.state}
                      </span>
                      <span>{d.dueAt.toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {course.modules.flatMap((m) => m.videos).map((v) => {
                const p = v.progresses[0];
                const passed = v.quiz?.attempts.some((a) => a.passed);
                return (
                  <Link
                    key={v.id}
                    href={`/video/${v.id}`}
                    className="rounded-xl bg-white/5 border border-white/10 p-4 hover:bg-white/10 transition"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium line-clamp-2">{v.title}</h3>
                      {p?.completed && (
                        <span className="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded">
                          Done
                        </span>
                      )}
                    </div>
                    <div className="mt-3 h-1.5 bg-white/10 rounded">
                      <div
                        className="h-1.5 bg-brand-500 rounded"
                        style={{ width: `${Math.min(100, p?.percent ?? 0)}%` }}
                      />
                    </div>
                    <p className="text-xs text-white/50 mt-2">
                      {Math.round(p?.percent ?? 0)}% watched
                      {v.quiz && ` • Quiz ${passed ? "passed" : "pending"}`}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
          );
        })}
      </div>
    </main>
  );
}
