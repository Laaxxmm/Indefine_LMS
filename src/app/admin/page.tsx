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

  const videos = await prisma.video.findMany({
    include: { quiz: { include: { questions: true } }, module: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Admin</h1>
        <div className="flex items-center gap-3">
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
          <Link href="/dashboard" className="text-sm text-white/60 hover:text-white">
            ← Dashboard
          </Link>
        </div>
      </div>

      <section className="rounded-xl bg-white/5 border border-white/10 p-6 mb-8">
        <h2 className="text-lg font-semibold mb-2">Sync OneDrive</h2>
        <p className="text-white/60 text-sm mb-4">
          Pull the latest video list from the configured OneDrive folder.
        </p>
        <form action={syncAction}>
          <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600">
            Sync now
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-4">Videos ({videos.length})</h2>
        <div className="space-y-2">
          {videos.map((v) => (
            <div
              key={v.id}
              className="rounded-lg bg-white/5 border border-white/10 p-4 flex items-center justify-between"
            >
              <div>
                <p className="font-medium">{v.title}</p>
                <p className="text-xs text-white/50">
                  {v.module.title} •{" "}
                  {v.quiz
                    ? `${v.quiz.questions.length} quiz questions`
                    : "No quiz"}
                </p>
              </div>
              <Link
                href={`/admin/video/${v.id}`}
                className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/15"
              >
                Edit quiz
              </Link>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
