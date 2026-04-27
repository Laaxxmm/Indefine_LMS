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
          className="text-sm text-white/60 hover:text-white inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
      </div>

      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent-gold/15 border border-accent-gold/30 text-xs text-accent-gold mb-4">
          <Trophy className="w-3.5 h-3.5" />
          Leaderboard
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-2">
          Top performers
        </h1>
        <p className="text-white/60 text-sm max-w-md mx-auto">
          Score = videos × 10 + best-quiz % + deadline pts + assignment pts
        </p>
      </div>

      {/* Podium for top 3 */}
      {top3.length > 0 && (
        <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-12 items-end max-w-3xl mx-auto">
          {/* 2nd place */}
          {top3[1] && (
            <PodiumCard
              rank={2}
              row={top3[1]}
              isMe={top3[1].userId === session.user.id}
              height="h-44 sm:h-52"
            />
          )}
          {/* 1st place */}
          {top3[0] && (
            <PodiumCard
              rank={1}
              row={top3[0]}
              isMe={top3[0].userId === session.user.id}
              height="h-56 sm:h-64"
            />
          )}
          {/* 3rd place */}
          {top3[2] && (
            <PodiumCard
              rank={3}
              row={top3[2]}
              isMe={top3[2].userId === session.user.id}
              height="h-36 sm:h-44"
            />
          )}
        </div>
      )}

      {/* Rest */}
      {rest.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wide text-white/50 mb-3 px-1">
            Everyone else
          </h2>
          <div className="rounded-2xl bg-bg-card border border-white/10 divide-y divide-white/5 overflow-hidden">
            {rest.map((r, i) => {
              const rank = i + 4;
              const isMe = r.userId === session.user.id;
              const level = computeLevel(r.totalScore);
              return (
                <div
                  key={r.userId}
                  className={`px-4 sm:px-5 py-3 flex items-center gap-3 sm:gap-4 transition ${
                    isMe
                      ? "bg-brand-500/10 hover:bg-brand-500/15"
                      : "hover:bg-white/[0.03]"
                  }`}
                >
                  <span className="text-sm font-mono text-white/50 w-7 text-right">
                    {rank}
                  </span>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-accent-violet flex items-center justify-center text-sm font-semibold shrink-0">
                    {(r.name || "?").slice(0, 1).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{r.name}</p>
                      {isMe && (
                        <span className="text-[10px] uppercase tracking-wide text-brand-300 bg-brand-500/20 px-2 py-0.5 rounded-full">
                          You
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/50 mt-0.5">
                      Lv {level.level} · {r.videosCompleted}/{r.videosTotal}{" "}
                      videos
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 text-xs text-white/60">
                    <Stat label="Quiz" value={r.bestQuizPoints} />
                    <Stat label="DDL" value={r.deadlinePoints} />
                    <Stat label="Asgn" value={r.assignmentPoints} />
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-bold tabular-nums">
                      {r.totalScore}
                    </p>
                    <p className="text-[10px] text-white/50 uppercase">pts</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {rows.length === 0 && (
        <div className="rounded-2xl bg-white/[0.03] border border-dashed border-white/10 p-12 text-center">
          <Trophy className="w-12 h-12 text-white/30 mx-auto mb-3" />
          <p className="text-white/60">No scores yet — be the first.</p>
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
      tint: "bg-gradient-to-br from-accent-gold/30 to-accent-gold/5 border-accent-gold/50 shadow-glow-gold",
      iconBg: "bg-accent-gold/30 text-accent-gold",
      avatarBg: "from-accent-gold to-accent-rose",
      label: "1st",
    },
    2: {
      icon: Medal,
      tint: "bg-gradient-to-br from-white/10 to-white/[0.02] border-white/20",
      iconBg: "bg-white/15 text-white/80",
      avatarBg: "from-white/40 to-white/20",
      label: "2nd",
    },
    3: {
      icon: Award,
      tint: "bg-gradient-to-br from-orange-500/20 to-orange-500/5 border-orange-500/30",
      iconBg: "bg-orange-500/25 text-orange-400",
      avatarBg: "from-orange-500 to-amber-700",
      label: "3rd",
    },
  } as const;
  const c = config[rank];
  const Icon = c.icon;
  const level = computeLevel(row.totalScore);

  return (
    <div
      className={`rounded-2xl border-2 p-4 sm:p-5 flex flex-col items-center justify-end text-center ${c.tint} ${height} ${
        isMe ? "ring-2 ring-brand-400" : ""
      }`}
    >
      <div
        className={`w-9 h-9 sm:w-11 sm:h-11 rounded-full flex items-center justify-center mb-2 ${c.iconBg}`}
      >
        <Icon className="w-5 h-5 sm:w-6 sm:h-6" />
      </div>
      <div
        className={`w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br ${c.avatarBg} flex items-center justify-center text-lg sm:text-2xl font-bold mb-2 shadow-lg`}
      >
        {(row.name || "?").slice(0, 1).toUpperCase()}
      </div>
      <p className="text-xs sm:text-sm font-semibold leading-tight line-clamp-2">
        {row.name}
        {isMe && <span className="block text-[10px] text-brand-300">(you)</span>}
      </p>
      <p className="text-[10px] text-white/50 mt-1">Lv {level.level}</p>
      <p className="text-xl sm:text-3xl font-bold mt-2 tabular-nums">
        {row.totalScore}
      </p>
      <p className="text-[10px] text-white/50 uppercase tracking-wide">pts</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center min-w-[36px]">
      <p className="text-sm tabular-nums">{value}</p>
      <p className="text-[9px] uppercase tracking-wide text-white/40">{label}</p>
    </div>
  );
}
