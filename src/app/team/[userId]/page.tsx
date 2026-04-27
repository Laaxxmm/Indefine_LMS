import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { computeTrajectory, TIER_META } from "@/lib/trajectory";
import { computeCheckinStreak } from "@/lib/checkins";
import TrajectoryRings, { RingLegend } from "../../dashboard/TrajectoryRings";
import {
  ArrowLeft,
  Star,
  Send,
  Award,
  Sparkles,
  Lightbulb,
  AlertCircle,
  Compass,
  Target,
  Rocket,
} from "lucide-react";

export const dynamic = "force-dynamic";

async function rateCraft(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const toId = String(formData.get("toId"));
  const score = Number(formData.get("score"));
  const reason = String(formData.get("reason") || "").trim();

  // Verify the rater is the manager of the target.
  const target = await prisma.user.findUnique({
    where: { id: toId },
    select: { managerId: true },
  });
  if (!target || target.managerId !== session.user.id) {
    if (session.user.role !== "ADMIN") return;
  }
  if (![1, 2, 3, 4, 5].includes(score)) return;

  await prisma.endorsement.create({
    data: {
      fromId: session.user.id,
      toId,
      kind: "CRAFT",
      score,
      reason: reason || null,
    },
  });
  revalidatePath(`/team/${toId}`);
}

async function endorseGeneric(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const toId = String(formData.get("toId"));
  const kind = String(formData.get("kind")) as
    | "COLLABORATION"
    | "INITIATIVE"
    | "MENTORSHIP"
    | "CROSS_DEPT";
  const reason = String(formData.get("reason") || "").trim();

  const target = await prisma.user.findUnique({
    where: { id: toId },
    select: { managerId: true },
  });
  if (!target || target.managerId !== session.user.id) {
    if (session.user.role !== "ADMIN") return;
  }
  await prisma.endorsement.create({
    data: { fromId: session.user.id, toId, kind, reason: reason || null },
  });
  revalidatePath(`/team/${toId}`);
}

async function approveQuestMilestone(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const id = String(formData.get("id"));
  const milestone = await prisma.questMilestone.findUnique({
    where: { id },
    include: { quest: { select: { userId: true } } },
  });
  if (!milestone) return;
  const target = await prisma.user.findUnique({
    where: { id: milestone.quest.userId },
    select: { managerId: true },
  });
  if (!target || (target.managerId !== session.user.id && session.user.role !== "ADMIN")) return;

  await prisma.questMilestone.update({
    where: { id },
    data: { completed: true, completedAt: new Date() },
  });
  revalidatePath(`/team/${milestone.quest.userId}`);
}

export default async function ReportDrillIn({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const { userId } = await params;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      manager: true,
    },
  });
  if (!target) notFound();

  // Allow access to direct manager or any admin
  const isManager = target.managerId === session.user.id;
  const isAdmin = session.user.role === "ADMIN";
  if (!isManager && !isAdmin) redirect("/dashboard");

  const [trajectory, quests, checkins, endorsements, streak] = await Promise.all([
    computeTrajectory(userId),
    prisma.quest.findMany({
      where: { userId, status: { in: ["APPROVED", "ACTIVE", "COMPLETED"] } },
      include: { milestones: { orderBy: { quarter: "asc" } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.weeklyCheckin.findMany({
      where: { userId },
      orderBy: { weekStart: "desc" },
      take: 4,
    }),
    prisma.endorsement.findMany({
      where: { toId: userId },
      include: { from: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    computeCheckinStreak(userId),
  ]);

  const tier = TIER_META[trajectory.tier];

  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <Link
          href="/team"
          className="text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Team
        </Link>
      </div>

      {/* Header */}
      <section className={`rounded-3xl border p-6 sm:p-8 mb-6 ${tier.bg}`}>
        <div className="grid lg:grid-cols-[auto_1fr_auto] gap-6 items-center">
          <TrajectoryRings
            mastery={trajectory.rings.mastery}
            delivery={trajectory.rings.delivery}
            growth={trajectory.rings.growth}
            size={150}
          />
          <div>
            <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint">
              {target.level} · Q{trajectory.quarter} · {trajectory.cycle?.name}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-1">
              {target.name ?? target.email}
            </h1>
            <p className="text-ink-soft">{target.email}</p>
            <div className="mt-3 inline-flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-full bg-white border border-border ${tier.fg}`}>
                {tier.label}
              </span>
              <span className="text-xs text-ink-mute">
                {streak.current}w check-in streak
              </span>
            </div>
          </div>
          <div className="rounded-xl bg-white border border-border p-4 min-w-[180px]">
            <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint">
              Score
            </p>
            <p className="font-display text-3xl font-extrabold tabular-nums">
              {Math.round(trajectory.totalScore)}
              <span className="text-base text-ink-faint">/100</span>
            </p>
            <div className="mt-3 pt-3 border-t border-border">
              <RingLegend
                mastery={trajectory.rings.mastery}
                delivery={trajectory.rings.delivery}
                growth={trajectory.rings.growth}
              />
            </div>
          </div>
        </div>

        {/* Track tiles */}
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 mt-5">
          {trajectory.tracks.map((t) => (
            <div
              key={t.kind}
              className="rounded-lg bg-white/70 backdrop-blur border border-border px-3 py-2.5"
            >
              <p className="text-xs font-medium">
                <span className="mr-1">{t.emoji}</span>
                {t.label}
              </p>
              <p className="font-display text-lg font-bold tabular-nums leading-none mt-1">
                {Math.round(t.scorePct)}
              </p>
              <div className="mt-1.5 h-0.5 bg-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-500 to-accent-violet"
                  style={{ width: `${t.scorePct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        {/* Left col */}
        <div className="space-y-6">
          {/* Quests */}
          <section className="rounded-2xl bg-white border border-border shadow-soft p-5">
            <div className="flex items-center gap-2 mb-4">
              <Target className="w-4 h-4 text-emerald-600" />
              <h2 className="font-display font-bold">
                Quests{" "}
                <span className="text-ink-faint font-normal text-sm">
                  ({quests.length})
                </span>
              </h2>
            </div>
            {quests.length === 0 ? (
              <p className="text-sm text-ink-mute">
                No active quests. Encourage them to set some via the Growth Wizard.
              </p>
            ) : (
              <div className="space-y-3">
                {quests.map((q) => (
                  <div
                    key={q.id}
                    className="rounded-xl border border-border p-4"
                  >
                    <p className="font-semibold mb-2">{q.title}</p>
                    {q.milestones.length > 0 && (
                      <div className="grid sm:grid-cols-2 gap-1.5">
                        {q.milestones.map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className="w-5 h-5 rounded bg-emerald-50 text-emerald-700 font-bold flex items-center justify-center text-[10px]">
                              Q{m.quarter}
                            </span>
                            <span
                              className={`flex-1 truncate ${m.completed ? "line-through text-ink-faint" : "text-ink-soft"}`}
                            >
                              {m.title}
                            </span>
                            {!m.completed && (
                              <form action={approveQuestMilestone}>
                                <input type="hidden" name="id" value={m.id} />
                                <button
                                  type="submit"
                                  className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold transition"
                                >
                                  Mark done
                                </button>
                              </form>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recent check-ins */}
          <section className="rounded-2xl bg-white border border-border shadow-soft p-5">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-amber-600" />
              <h2 className="font-display font-bold">Recent reflections</h2>
            </div>
            {checkins.length === 0 ? (
              <p className="text-sm text-ink-mute">No check-ins yet.</p>
            ) : (
              <div className="space-y-4">
                {checkins.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-xl border border-border p-3 text-sm"
                  >
                    <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint mb-2">
                      {c.weekStart.toLocaleDateString()}
                    </p>
                    {c.whatWorked && (
                      <Mini
                        icon={Lightbulb}
                        tint="emerald"
                        label="Worked"
                        text={c.whatWorked}
                      />
                    )}
                    {c.whatBlocked && (
                      <Mini
                        icon={AlertCircle}
                        tint="rose"
                        label="Blocked"
                        text={c.whatBlocked}
                      />
                    )}
                    {c.nextFocus && (
                      <Mini
                        icon={Compass}
                        tint="violet"
                        label="Next"
                        text={c.nextFocus}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right col — endorsements */}
        <div className="space-y-6">
          {/* Craft rating */}
          <section className="rounded-2xl bg-white border border-border shadow-soft p-5">
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-4 h-4 text-amber-600" />
              <h2 className="font-display font-bold">Rate craft</h2>
            </div>
            <p className="text-xs text-ink-mute mb-4">
              Quality of work + soft skills (1-5). Feeds the ⭐ Craft track.
            </p>
            <form action={rateCraft} className="space-y-3">
              <input type="hidden" name="toId" value={target.id} />
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <label
                    key={s}
                    className="flex-1 text-center cursor-pointer rounded-lg border border-border bg-muted/30 hover:bg-amber-50 hover:border-amber-200 py-3 has-[:checked]:bg-amber-100 has-[:checked]:border-amber-400 transition"
                  >
                    <input type="radio" name="score" value={s} className="sr-only peer" required />
                    <p className="text-2xl">{["😕", "🙂", "👍", "🎯", "🌟"][s - 1]}</p>
                    <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint">
                      {s}
                    </p>
                  </label>
                ))}
              </div>
              <textarea
                name="reason"
                placeholder="Optional: what stood out?"
                rows={2}
                className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:bg-white focus:ring-4 focus:ring-amber-500/15 focus:border-amber-500 transition"
              />
              <button className="w-full px-4 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-semibold inline-flex items-center justify-center gap-2 shadow-pop transition">
                <Send className="w-4 h-4" />
                Submit rating
              </button>
            </form>
          </section>

          {/* Endorsement (collab/init/etc) */}
          <section className="rounded-2xl bg-white border border-border shadow-soft p-5">
            <div className="flex items-center gap-2 mb-3">
              <Award className="w-4 h-4 text-violet-600" />
              <h2 className="font-display font-bold">Quick endorsement</h2>
            </div>
            <form action={endorseGeneric} className="space-y-2">
              <input type="hidden" name="toId" value={target.id} />
              <select
                name="kind"
                defaultValue="COLLABORATION"
                className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="COLLABORATION">🤝 Collaboration</option>
                <option value="MENTORSHIP">🎓 Mentorship</option>
                <option value="CROSS_DEPT">🌐 Cross-department help</option>
                <option value="INITIATIVE">🚀 Initiative</option>
              </select>
              <textarea
                name="reason"
                placeholder="What did they do well?"
                rows={2}
                className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:bg-white focus:ring-4 focus:ring-violet-500/15 focus:border-violet-500 transition"
              />
              <button className="w-full px-4 py-2 rounded-lg bg-violet-500 hover:bg-violet-600 text-white font-semibold inline-flex items-center justify-center gap-2 transition">
                <Send className="w-4 h-4" />
                Endorse
              </button>
            </form>
          </section>

          {/* Recent endorsements */}
          {endorsements.length > 0 && (
            <section className="rounded-2xl bg-white border border-border shadow-soft p-5">
              <h2 className="font-display font-bold mb-3 text-sm">
                Recent endorsements
              </h2>
              <div className="space-y-2">
                {endorsements.map((e) => (
                  <div
                    key={e.id}
                    className="text-xs border border-border rounded-lg p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{e.kind.replace("_", " ")}</span>
                      <span className="text-ink-faint">
                        from {e.from.name?.split(" ")[0] ?? "manager"}
                      </span>
                    </div>
                    {e.score && (
                      <p className="text-amber-600 font-bold">
                        {"⭐".repeat(e.score)}
                      </p>
                    )}
                    {e.reason && (
                      <p className="text-ink-soft mt-1 italic">&ldquo;{e.reason}&rdquo;</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-xs text-rose-800">
            <Rocket className="w-4 h-4 inline mr-1" />
            Tip: endorsing in the moment beats saving it for review season.
            People feel seen.
          </div>
        </div>
      </div>
    </main>
  );
}

function Mini({
  icon: Icon,
  tint,
  label,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: "emerald" | "rose" | "violet";
  label: string;
  text: string;
}) {
  const tints = {
    emerald: "text-emerald-600",
    rose: "text-rose-600",
    violet: "text-violet-600",
  };
  return (
    <div className="flex items-start gap-2 mb-1.5">
      <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${tints[tint]}`} />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint">
          {label}
        </p>
        <p className="text-xs text-ink-soft">{text}</p>
      </div>
    </div>
  );
}
