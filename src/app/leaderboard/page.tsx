import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { computeKraScores } from "@/lib/kra";

export const dynamic = "force-dynamic";

export default async function Leaderboard() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const rows = await computeKraScores();

  return (
    <main className="min-h-screen px-6 py-10 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Leaderboard</h1>
        <Link href="/dashboard" className="text-sm text-white/60 hover:text-white">
          ← Dashboard
        </Link>
      </div>
      <p className="text-white/60 text-sm mb-6">
        Score = videos × 10 + best-quiz % / 10 + deadline points + assignment points
      </p>

      <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-white/60">
            <tr>
              <th className="text-left p-3">#</th>
              <th className="text-left p-3">Name</th>
              <th className="text-right p-3">Videos</th>
              <th className="text-right p-3">Quiz pts</th>
              <th className="text-right p-3">Deadline pts</th>
              <th className="text-right p-3">Assignment pts</th>
              <th className="text-right p-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isMe = r.userId === session.user.id;
              return (
                <tr
                  key={r.userId}
                  className={`border-t border-white/5 ${
                    isMe ? "bg-brand-500/10" : ""
                  }`}
                >
                  <td className="p-3 text-white/60">{i + 1}</td>
                  <td className="p-3">
                    {r.name}
                    {isMe && (
                      <span className="ml-2 text-xs text-brand-500/80">you</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {r.videosCompleted} / {r.videosTotal}
                  </td>
                  <td className="p-3 text-right">{r.bestQuizPoints}</td>
                  <td className="p-3 text-right">{r.deadlinePoints}</td>
                  <td className="p-3 text-right">{r.assignmentPoints}</td>
                  <td className="p-3 text-right font-semibold">
                    {r.totalScore}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
