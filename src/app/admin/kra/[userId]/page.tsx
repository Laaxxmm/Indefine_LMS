import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getCourseStatusForUser } from "@/lib/kra";
import PrintButton from "./PrintButton";
import { isAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function EmployeeKraDetail({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const { userId } = await params;
  const sp = await searchParams;
  const from = parseDate(sp.from);
  const to = parseDate(sp.to);
  const toEnd = to ? new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1) : undefined;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) notFound();

  const courseStatuses = await getCourseStatusForUser(userId, { from, to: toEnd });

  // Pull all attempts in window for the per-quiz table
  const attempts = await prisma.quizAttempt.findMany({
    where: {
      userId,
      submittedAt:
        from || toEnd ? { gte: from, lte: toEnd } : { not: null },
    },
    include: { quiz: { include: { video: true } } },
    orderBy: { submittedAt: "desc" },
  });

  const bestPerQuiz = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) {
    const cur = bestPerQuiz.get(a.quizId);
    if (!cur || a.percent > cur.percent) bestPerQuiz.set(a.quizId, a);
  }

  const totalDeadlinePts = courseStatuses.reduce(
    (s, c) => s + c.deadlines.reduce((ds, d) => ds + d.pointsAwarded, 0),
    0
  );

  return (
    <main className="min-h-screen px-6 py-10 max-w-4xl mx-auto print:py-4">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link
          href={`/admin/kra?from=${sp.from ?? ""}&to=${sp.to ?? ""}`}
          className="text-sm text-ink-mute hover:text-ink"
        >
          ← KRA report
        </Link>
        <PrintButton />
      </div>

      <div className="rounded-2xl bg-white border border-border shadow-soft p-6 mb-6 print:bg-white print:text-black print:border-black">
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em]">{user.name ?? user.email}</h1>
        <p className="text-ink-mute print:text-gray-700">{user.email}</p>
        <p className="text-sm mt-2 text-ink-mute print:text-gray-700">
          KRA window: {sp.from ?? "—"} to {sp.to ?? "—"}
        </p>
      </div>

      <Section title="Course completion">
        <table className="w-full text-sm">
          <thead className="text-ink-mute print:text-gray-700">
            <tr>
              <th className="text-left p-2">Course</th>
              <th className="text-right p-2">Videos</th>
              <th className="text-right p-2">Quizzes</th>
              <th className="text-right p-2">Status</th>
              <th className="text-right p-2">Completed at</th>
            </tr>
          </thead>
          <tbody>
            {courseStatuses.map((c) => (
              <tr key={c.courseId} className="border-t border-border print:border-gray-300">
                <td className="p-2">{c.courseTitle}</td>
                <td className="p-2 text-right">
                  {c.videosCompleted} / {c.totalVideos}
                </td>
                <td className="p-2 text-right">
                  {c.quizzesPassed} / {c.totalQuizzes}
                </td>
                <td className="p-2 text-right">
                  {c.completed ? "Completed" : "In progress"}
                </td>
                <td className="p-2 text-right">
                  {c.completedAt ? c.completedAt.toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Deadlines">
        <table className="w-full text-sm">
          <thead className="text-ink-mute print:text-gray-700">
            <tr>
              <th className="text-left p-2">Course</th>
              <th className="text-left p-2">Kind</th>
              <th className="text-right p-2">Due</th>
              <th className="text-right p-2">State</th>
              <th className="text-right p-2">Points</th>
            </tr>
          </thead>
          <tbody>
            {courseStatuses.flatMap((c) =>
              c.deadlines.map((d) => (
                <tr key={d.id} className="border-t border-border print:border-gray-300">
                  <td className="p-2">{c.courseTitle}</td>
                  <td className="p-2">{d.kind.toLowerCase()}</td>
                  <td className="p-2 text-right">
                    {d.dueAt.toLocaleDateString()}
                  </td>
                  <td className="p-2 text-right capitalize">{d.state}</td>
                  <td className="p-2 text-right font-semibold">
                    {d.pointsAwarded}
                  </td>
                </tr>
              ))
            )}
            <tr className="border-t-2 border-ink/30 print:border-black font-semibold">
              <td className="p-2" colSpan={4}>
                Total deadline points
              </td>
              <td className="p-2 text-right">{totalDeadlinePts}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Quiz attempts (best per quiz)">
        <table className="w-full text-sm">
          <thead className="text-ink-mute print:text-gray-700">
            <tr>
              <th className="text-left p-2">Video</th>
              <th className="text-right p-2">Score</th>
              <th className="text-right p-2">Result</th>
              <th className="text-right p-2">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(bestPerQuiz.values()).map((a) => (
              <tr key={a.id} className="border-t border-border print:border-gray-300">
                <td className="p-2">{a.quiz.video.title}</td>
                <td className="p-2 text-right">{a.percent.toFixed(0)}%</td>
                <td className="p-2 text-right">
                  {a.passed ? "Passed" : "Not passed"}
                </td>
                <td className="p-2 text-right">
                  {a.submittedAt?.toLocaleDateString() ?? "—"}
                </td>
              </tr>
            ))}
            {bestPerQuiz.size === 0 && (
              <tr>
                <td className="p-2 text-ink-faint" colSpan={4}>
                  No quiz attempts in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white border border-border shadow-soft p-5 mb-5 print:bg-white print:text-black print:border-black">
      <h2 className="font-display text-lg font-bold mb-3">{title}</h2>
      {children}
    </section>
  );
}
