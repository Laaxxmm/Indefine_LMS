import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { computeKraScores } from "@/lib/kra";
import { computeLevel } from "@/lib/gamification";
import { Trophy, ArrowLeft, Crown, Medal, Award } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Leaderboard() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const rows = await computeKraScores();
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <Link
          href="/dashboard"
          className="text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
      </div>

      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-xs text-amber-700 font-semibold mb-4">
          <Trophy className="w-3.5 h-3.5" />
          Leaderboard
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-2">
          Top performers
        </h1>
        <p className="text-ink-mute text-sm max-w-md mx-auto">
          Score = videos × 10 + best-quiz % + deadline pts + assignment pts
        </p>
      </div>

      {/* Podium for top 3 */}
      {top3.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-12 items-end max-w-3xl mx-auto">
          {top3[1] && (
            <PodiumCard
              rank={2}
              row={top3[1]}
              isMe={top3[1].userId === session.user.id}
              height="h-48 sm:h-56"
            />
          )}
          {top3[0] && (
            <PodiumCard
              rank={1}
              row={top3[0]}
              isMe={top3[0].userId === session.user.id}
              height="h-60 sm:h-72"
            />
          )}
          {top3[2] && (
            <PodiumCard
              rank={3}
              row={top3[2]}
              isMe={top3[2].userId === session.user.id}
              height="h-40 sm:h-48"
            />
          )}
        </div>
      )}

      {/* Rest */}
      {rest.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider font-semibold text-ink-faint mb-3 px-1">
            Everyone else
          </h2>
          <div className="rounded-2xl bg-white border border-border shadow-soft divide-y divide-border overflow-hidden">
            {rest.map((r, i) => {
              const rank = i + 4;
              const isMe = r.userId === session.user.id;
              const level = computeLevel(r.totalScore);
              return (
                <div
                  key={r.userId}
                  className={`px-4 sm:px-5 py-3 flex items-center gap-3 sm:gap-4 transition ${
                    isMe ? "bg-brand-50" : "hover:bg-muted/50"
                  }`}
                >
                  <span className="text-sm font-mono text-ink-faint w-7 text-right">
                    {rank}
                  </span>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-accent-violet flex items-center justify-center text-sm font-bold text-white shrink-0">
                    {(r.name || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold truncate">{r.name}</p>
                      {isMe && (
                        <span className="text-[10px] uppercase tracking-wide text-brand-700 bg-brand-100 px-2 py-0.5 rounded-full font-bold">
                          You
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-mute mt-0.5">
                      Lv {level.level} · {r.videosCompleted}/{r.videosTotal}{" "}
                      videos
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 text-xs text-ink-mute">
                    <Stat label="Quiz" value={r.bestQuizPoints} />
                    <Stat label="DDL" value={r.deadlinePoints} />
                    <Stat label="Asgn" value={r.assignmentPoints} />
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-display text-lg font-bold tabular-nums">
                      {r.totalScore}
                    </p>
                    <p className="text-[10px] text-ink-faint uppercase font-semibold">
                      pts
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {rows.length === 0 && (
        <div className="rounded-2xl bg-white border border-dashed border-border p-12 text-center shadow-soft">
          <Trophy className="w-12 h-12 text-ink-faint mx-auto mb-3" />
          <p className="text-ink-mute">No scores yet — be the first.</p>
        </div>
      )}
    </main>
  );
}

function PodiumCard({
  rank,
  row,
  isMe,
  height,
}: {
  rank: 1 | 2 | 3;
  row: {
    userId: string;
    name: string;
    totalScore: number;
    videosCompleted: number;
    videosTotal: number;
  };
  isMe: boolean;
  height: string;
}) {
  const config = {
    1: {
      icon: Crown,
      cardBg:
        "bg-gradient-to-b from-amber-100 to-amber-50 border-amber-300 shadow-pop",
      iconBg: "bg-amber-200 text-amber-700",
      avatarBg: "from-amber-400 to-amber-600",
      label: "1st",
    },
    2: {
      icon: Medal,
      cardBg: "bg-white border-border shadow-lift",
      iconBg: "bg-slate-100 text-slate-600",
      avatarBg: "from-slate-400 to-slate-600",
      label: "2nd",
    },
    3: {
      icon: Award,
      cardBg:
        "bg-gradient-to-b from-orange-100 to-orange-50 border-orange-300 shadow-soft",
      iconBg: "bg-orange-200 text-orange-700",
      avatarBg: "from-orange-400 to-orange-600",
      label: "3rd",
    },
  } as const;
  const c = config[rank];
  const Icon = c.icon;
  const level = computeLevel(row.totalScore);

  return (
    <div
      className={`rounded-2xl border-2 p-4 sm:p-5 flex flex-col items-center justify-end text-center ${c.cardBg} ${height} ${
        isMe ? "ring-4 ring-brand-300" : ""
      }`}
    >
      <div
        className={`w-9 h-9 sm:w-11 sm:h-11 rounded-full flex items-center justify-center mb-2 ${c.iconBg}`}
      >
        <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
      </div>
      <div
        className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br ${c.avatarBg} flex items-center justify-center text-lg sm:text-2xl font-bold mb-2 shadow-lift text-white`}
      >
        {(row.name || "?").slice(0, 1).toUpperCase()}
      </div>
      <p className="text-xs sm:text-sm font-semibold leading-tight line-clamp-2">
        {row.name}
        {isMe && (
          <span className="block text-[10px] text-brand-600 font-bold">(you)</span>
        )}
      </p>
      <p className="text-[10px] text-ink-mute mt-1">Lv {level.level}</p>
      <p className="font-display text-2xl sm:text-3xl font-extrabold mt-2 tabular-nums">
        {row.totalScore}
      </p>
      <p className="text-[10px] text-ink-faint uppercase tracking-wider font-semibold">
        pts
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center min-w-[36px]">
      <p className="text-sm tabular-nums font-semibold text-ink">{value}</p>
      <p className="text-[9px] uppercase tracking-wider text-ink-faint font-semibold">
        {label}
      </p>
    </div>
  );
}
