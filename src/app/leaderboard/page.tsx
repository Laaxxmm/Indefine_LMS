import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { computeKraScores } from "@/lib/kra";
import { computeLevel } from "@/lib/gamification";
import { prisma } from "@/lib/prisma";
import {
  ACTIVE_LEVELS,
  DEPARTMENTS,
  departmentColor,
  departmentLabel,
  levelLabel,
} from "@/lib/ca-firm";
import type { Department, EmployeeLevel } from "@prisma/client";
import {
  Trophy,
  ArrowLeft,
  Crown,
  Medal,
  Award,
  Building2,
  Users,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Leaderboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const sp = await searchParams;
  const filterBranch = sp.branch ?? "";
  const filterDept = sp.dept ?? "";
  const view = sp.view === "branches" ? "branches" : "people";

  const [allRows, branches, users] = await Promise.all([
    computeKraScores(),
    prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, branchId: true, department: true, level: true, branch: true },
    }),
  ]);

  const meta = new Map(users.map((u) => [u.id, u]));

  let rows = allRows.map((r) => {
    const m = meta.get(r.userId);
    return {
      ...r,
      branchId: m?.branchId ?? null,
      branch: m?.branch ?? null,
      department: (m?.department ?? "GENERAL") as Department,
      employeeLevel: (m?.level ?? "EXECUTIVE") as EmployeeLevel,
    };
  });
  if (filterBranch) rows = rows.filter((r) => r.branchId === filterBranch);
  if (filterDept) rows = rows.filter((r) => r.department === filterDept);

  // Branch summary view
  const branchSummary = (() => {
    const map = new Map<
      string,
      { branchId: string | null; branch: { code: string; name: string } | null; total: number; n: number }
    >();
    for (const r of allRows) {
      const m = meta.get(r.userId);
      const key = m?.branchId ?? "__none__";
      const cur = map.get(key) ?? {
        branchId: m?.branchId ?? null,
        branch: m?.branch ?? null,
        total: 0,
        n: 0,
      };
      cur.total += r.totalScore;
      cur.n += 1;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .filter((b) => b.branchId !== null || b.n > 0)
      .map((b) => ({ ...b, avg: b.n > 0 ? b.total / b.n : 0 }))
      .sort((a, b) => b.avg - a.avg);
  })();

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <Link
          href="/dashboard"
          className="text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-white border border-border shadow-soft">
          <Link
            href="/leaderboard"
            className={`text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ${
              view === "people" ? "bg-ink text-white shadow-pop" : "text-ink-soft hover:bg-muted"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            People
          </Link>
          <Link
            href="/leaderboard?view=branches"
            className={`text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 transition ${
              view === "branches" ? "bg-ink text-white shadow-pop" : "text-ink-soft hover:bg-muted"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            Branches
          </Link>
        </div>
      </div>

      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-xs text-amber-700 font-semibold mb-4">
          <Trophy className="w-3.5 h-3.5" />
          Leaderboard
        </div>
        <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-2">
          {view === "branches" ? "Branch race" : "Top performers"}
        </h1>
        <p className="text-ink-mute text-sm max-w-md mx-auto">
          {view === "branches"
            ? "Average score per branch · who's leading the firm?"
            : "Score = videos × 10 + best-quiz % + deadline pts + assignment pts"}
        </p>
      </div>

      {view === "branches" ? (
        <BranchView branches={branchSummary} />
      ) : (
        <>
          {/* Filters */}
          <form
            method="GET"
            className="rounded-2xl bg-white border border-border shadow-soft p-3 mb-6 flex items-end gap-2 flex-wrap"
          >
            <label className="text-xs">
              <span className="block text-ink-mute mb-1 font-semibold">
                Branch
              </span>
              <select
                name="branch"
                defaultValue={filterBranch}
                className="bg-white border border-border rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="block text-ink-mute mb-1 font-semibold">
                Department
              </span>
              <select
                name="dept"
                defaultValue={filterDept}
                className="bg-white border border-border rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="">All departments</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {departmentLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <button className="text-xs px-3 py-1.5 rounded-lg bg-ink hover:bg-ink-soft text-white font-medium transition">
              Apply
            </button>
            {(filterBranch || filterDept) && (
              <a
                href="/leaderboard"
                className="text-xs px-3 py-1.5 rounded-lg bg-white border border-border hover:bg-muted transition"
              >
                Clear
              </a>
            )}
            <p className="text-xs text-ink-faint ml-auto">
              {rows.length} {rows.length === 1 ? "person" : "people"}
            </p>
          </form>

          {/* Podium */}
          {top3.length > 0 && (
            <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-12 items-end max-w-3xl mx-auto">
              {top3[1] && (
                <PodiumCard
                  rank={2}
                  row={top3[1]}
                  isMe={top3[1].userId === session.user.id}
                  height="min-h-[12rem] sm:min-h-[14rem]"
                />
              )}
              {top3[0] && (
                <PodiumCard
                  rank={1}
                  row={top3[0]}
                  isMe={top3[0].userId === session.user.id}
                  height="min-h-[15rem] sm:min-h-[18rem]"
                />
              )}
              {top3[2] && (
                <PodiumCard
                  rank={3}
                  row={top3[2]}
                  isMe={top3[2].userId === session.user.id}
                  height="min-h-[10rem] sm:min-h-[12rem]"
                />
              )}
            </div>
          )}

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
                  const dColor = departmentColor(r.department);
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
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold truncate">{r.name}</p>
                          {isMe && (
                            <span className="text-[10px] uppercase tracking-wide text-brand-700 bg-brand-100 px-2 py-0.5 rounded-full font-bold">
                              You
                            </span>
                          )}
                          <span
                            className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${dColor.bg} ${dColor.fg}`}
                          >
                            {departmentLabel(r.department)}
                          </span>
                          {r.branch && (
                            <span className="text-[10px] uppercase tracking-wide text-ink-mute bg-muted px-2 py-0.5 rounded-full font-mono">
                              {r.branch.code}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-ink-mute mt-0.5">
                          {levelLabel(r.employeeLevel)} · Lv {level.level} ·{" "}
                          {r.videosCompleted}/{r.videosTotal} videos
                        </p>
                      </div>
                      <div className="hidden sm:flex items-center gap-3 text-xs text-ink-mute">
                        <Stat label="Quiz" value={r.bestQuizPoints} />
                        <Stat label="DDL" value={r.deadlinePoints} />
                        <Stat label="Asgn" value={r.assignmentPoints} />
                        <Stat label="Att" value={r.attendancePoints} />
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
              <p className="text-ink-mute">
                No scores match these filters yet.
              </p>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function BranchView({
  branches,
}: {
  branches: {
    branchId: string | null;
    branch: { code: string; name: string } | null;
    avg: number;
    n: number;
  }[];
}) {
  if (branches.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-dashed border-border p-12 text-center shadow-soft">
        <Building2 className="w-12 h-12 text-ink-faint mx-auto mb-3" />
        <p className="text-ink-mute">
          No branch data yet — assign users to branches in /admin/team.
        </p>
      </div>
    );
  }
  const max = Math.max(...branches.map((b) => b.avg), 1);
  return (
    <div className="space-y-3">
      {branches.map((b, i) => (
        <div
          key={b.branchId ?? "none"}
          className={`rounded-2xl bg-white border border-border shadow-soft p-5 ${
            i === 0 ? "ring-2 ring-amber-200" : ""
          }`}
        >
          <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold ${
                  i === 0
                    ? "bg-amber-500 text-white shadow-pop"
                    : "bg-brand-50 text-brand-700"
                }`}
              >
                {b.branch?.code ?? "—"}
              </div>
              <div>
                <p className="font-semibold flex items-center gap-2">
                  {b.branch?.name ?? "Unassigned"}
                  {i === 0 && (
                    <Crown className="w-4 h-4 text-amber-500" />
                  )}
                </p>
                <p className="text-xs text-ink-mute">
                  {b.n} active {b.n === 1 ? "person" : "people"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-display text-2xl font-extrabold tabular-nums">
                {Math.round(b.avg)}
              </p>
              <p className="text-[10px] text-ink-faint uppercase tracking-wider font-bold">
                Avg score
              </p>
            </div>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                i === 0
                  ? "bg-gradient-to-r from-amber-400 to-rose-500"
                  : "bg-gradient-to-r from-brand-400 to-accent-violet"
              }`}
              style={{ width: `${(b.avg / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
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
    department: Department;
    branch: { code: string } | null;
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
    },
    2: {
      icon: Medal,
      cardBg: "bg-white border-border shadow-lift",
      iconBg: "bg-slate-100 text-slate-600",
      avatarBg: "from-slate-400 to-slate-600",
    },
    3: {
      icon: Award,
      cardBg:
        "bg-gradient-to-b from-orange-100 to-orange-50 border-orange-300 shadow-soft",
      iconBg: "bg-orange-200 text-orange-700",
      avatarBg: "from-orange-400 to-orange-600",
    },
  } as const;
  const c = config[rank];
  const Icon = c.icon;
  const level = computeLevel(row.totalScore);
  const dColor = departmentColor(row.department);

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
      <div className="flex items-center gap-1 mt-1 flex-wrap justify-center">
        <span
          className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${dColor.bg} ${dColor.fg}`}
        >
          {departmentLabel(row.department)}
        </span>
        {row.branch && (
          <span className="text-[9px] font-mono text-ink-mute bg-muted px-1.5 py-0.5 rounded">
            {row.branch.code}
          </span>
        )}
      </div>
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
