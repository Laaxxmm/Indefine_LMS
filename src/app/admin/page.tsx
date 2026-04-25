import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { syncOneDriveVideos } from "@/lib/sync";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

async function syncAction() {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Forbidden");
  await syncOneDriveVideos({ fallbackUserId: session.user.id });
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  // Pull modules with their videos and quiz status, ordered as they appear in courses
  const modules = await prisma.module.findMany({
    include: {
      course: true,
      videos: {
        orderBy: { order: "asc" },
        include: {
          quiz: { include: { _count: { select: { questions: true } } } },
        },
      },
    },
    orderBy: [{ courseId: "asc" }, { order: "asc" }],
  });

  const totalVideos = modules.reduce((s, m) => s + m.videos.length, 0);
  const totalQuizzes = modules.reduce(
    (s, m) => s + m.videos.filter((v) => v.quiz).length,
    0
  );
  const totalQuestions = modules.reduce(
    (s, m) =>
      s + m.videos.reduce((vs, v) => vs + (v.quiz?._count.questions ?? 0), 0),
    0
  );

  return (
    <main className="min-h-screen px-6 py-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <h1 className="text-3xl font-bold">Admin</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/courses"
            className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
          >
            Courses & deadlines
          </Link>
          <Link
            href="/admin/kra"
            className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
          >
            KRA report
          </Link>
          <Link href="/dashboard" className="text-sm text-white/60 hover:text-white px-2">
            ← Dashboard
          </Link>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <Stat label="Modules" value={modules.length} />
        <Stat label="Videos" value={totalVideos} />
        <Stat
          label="Quiz questions"
          value={totalQuestions}
          sub={`${totalQuizzes} quizzes`}
        />
      </div>

      <section className="rounded-xl bg-white/5 border border-white/10 p-5 mb-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-semibold">Sync from SharePoint</h2>
            <p className="text-white/60 text-sm mt-1">
              Pulls the latest videos from <code className="text-white/80">L&D</code> and
              creates a module per subfolder.
            </p>
          </div>
          <form action={syncAction}>
            <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 font-medium">
              Sync now
            </button>
          </form>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Manage videos & quizzes
        </h2>
        <p className="text-sm text-white/60 mb-4">
          Click <strong>Add quiz</strong> on any video to create its MCQ quiz, or <strong>Edit</strong> to update an existing one.
        </p>

        {modules.length === 0 && (
          <p className="text-white/60 text-sm py-6 text-center bg-white/5 border border-white/10 rounded-xl">
            No modules yet. Click <strong>Sync now</strong> above.
          </p>
        )}

        <div className="space-y-6">
          {modules
            .filter((m) => m.videos.length > 0)
            .map((m) => (
              <div
                key={m.id}
                className="rounded-xl bg-white/5 border border-white/10 overflow-hidden"
              >
                <div className="px-5 py-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase text-white/50 tracking-wide">
                      {m.course.title}
                    </p>
                    <h3 className="font-semibold">{m.title}</h3>
                  </div>
                  <span className="text-xs text-white/60">
                    {m.videos.length} videos ·{" "}
                    {m.videos.filter((v) => v.quiz).length} with quizzes
                  </span>
                </div>
                <div className="divide-y divide-white/5">
                  {m.videos.map((v, i) => {
                    const qCount = v.quiz?._count.questions ?? 0;
                    return (
                      <div
                        key={v.id}
                        className="px-5 py-3 flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-xs text-white/40 tabular-nums w-6 text-right">
                            {i + 1}.
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {prettifyName(v.title)}
                            </p>
                            <p className="text-xs text-white/50 mt-0.5">
                              {v.quiz
                                ? `${qCount} question${qCount === 1 ? "" : "s"}`
                                : "No quiz yet"}
                            </p>
                          </div>
                        </div>
                        <Link
                          href={`/admin/video/${v.id}`}
                          className={`text-xs px-3 py-1.5 rounded shrink-0 ${
                            v.quiz
                              ? "bg-white/10 hover:bg-white/15"
                              : "bg-brand-500/80 hover:bg-brand-500"
                          }`}
                        >
                          {v.quiz ? "Edit quiz" : "Add quiz"}
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 px-5 py-4">
      <p className="text-xs uppercase text-white/50 tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs text-white/50 mt-1">{sub}</p>}
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
