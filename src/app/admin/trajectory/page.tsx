import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCycle, TRACK_META, TIER_META } from "@/lib/trajectory";
import { freezeQuarter, closeCycle } from "@/lib/snapshots";
import { revalidatePath } from "next/cache";
import type { EmployeeLevel, TrackKind } from "@prisma/client";
import { Sparkles, Save, Plus, Snowflake, Lock } from "lucide-react";

export const dynamic = "force-dynamic";

const LEVELS: EmployeeLevel[] = [
  "TRAINEE",
  "ASSOCIATE",
  "SENIOR",
  "LEAD",
  "MANAGER",
  "PARTNER",
];
const TRACKS: TrackKind[] = [
  "MASTERY",
  "DELIVERY",
  "INITIATIVE",
  "COLLABORATION",
  "VISION",
  "CRAFT",
];

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
}

async function saveTargets(formData: FormData) {
  "use server";
  await requireAdmin();
  const cycleId = String(formData.get("cycleId"));
  const updates: { id: string; target: number; weight: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("t_")) continue;
    const [, id, field] = key.split("_");
    const num = Number(value);
    if (!Number.isFinite(num)) continue;
    let entry = updates.find((u) => u.id === id);
    if (!entry) {
      entry = { id, target: 0, weight: 0 };
      updates.push(entry);
    }
    if (field === "target") entry.target = num;
    if (field === "weight") entry.weight = num;
  }
  await Promise.all(
    updates.map((u) =>
      prisma.trackTarget.update({
        where: { id: u.id },
        data: { target: u.target, weight: u.weight },
      })
    )
  );
  revalidatePath("/admin/trajectory");
  revalidatePath("/dashboard");
  void cycleId;
}

async function snapshotQuarter(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return;
  const cycleId = String(formData.get("cycleId"));
  const quarter = Number(formData.get("quarter"));
  if (!cycleId || ![1, 2, 3, 4].includes(quarter)) return;
  await freezeQuarter(cycleId, quarter);
  revalidatePath("/admin/trajectory");
}

async function closeActiveCycle(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return;
  const cycleId = String(formData.get("cycleId"));
  if (!cycleId) return;
  await closeCycle(cycleId);
  revalidatePath("/admin/trajectory");
  revalidatePath("/dashboard");
}

async function createCycle(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") || "").trim();
  const start = new Date(String(formData.get("startDate")));
  const end = new Date(String(formData.get("endDate")));
  if (!name || isNaN(start.getTime()) || isNaN(end.getTime())) return;

  // Deactivate the current active cycle.
  await prisma.performanceCycle.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });
  const cycle = await prisma.performanceCycle.create({
    data: { name, startDate: start, endDate: end, isActive: true },
  });
  // Seed default targets
  const data = TRACKS.flatMap((trackKind) =>
    LEVELS.map((level) => ({
      cycleId: cycle.id,
      trackKind,
      level,
      target: TRACK_META[trackKind].defaultTarget[level],
      weight: TRACK_META[trackKind].defaultWeight,
    }))
  );
  await prisma.trackTarget.createMany({ data });
  revalidatePath("/admin/trajectory");
}

export default async function TrajectoryFrameworkPage() {
  await requireAdmin();
  await ensureDefaultCycle();

  const cycles = await prisma.performanceCycle.findMany({
    orderBy: { startDate: "desc" },
  });
  const activeCycle = cycles.find((c) => c.isActive) ?? cycles[0];

  const targets = activeCycle
    ? await prisma.trackTarget.findMany({
        where: { cycleId: activeCycle.id },
      })
    : [];

  // Which quarters of the active cycle have been snapshotted?
  const snapshottedQuarters = activeCycle
    ? await prisma.tierAssignment.groupBy({
        by: ["quarter"],
        where: { cycleId: activeCycle.id },
        _count: true,
      })
    : [];
  const frozenSet = new Set(snapshottedQuarters.map((s) => s.quarter));

  // Build a target lookup: targets[track][level] = TrackTarget
  const targetByCell = new Map<string, (typeof targets)[number]>();
  for (const t of targets) {
    targetByCell.set(`${t.trackKind}_${t.level}`, t);
  }

  return (
    <main className="px-6 py-8 max-w-6xl">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1.5">
          Admin · Trajectory framework
        </p>
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">
          Trajectory framework
        </h1>
        <p className="text-ink-mute mt-1 text-sm">
          The growth OS settings — performance cycles, track targets per
          employee level, weights and tier thresholds.
        </p>
      </div>

      {/* Cycles */}
      <section className="mb-8 rounded-2xl bg-white border border-border shadow-soft p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="font-display text-lg font-bold">Cycles</h2>
            <p className="text-xs text-ink-mute mt-0.5">
              Each cycle is a performance window (typically a financial year).
              The active cycle is what employees are scored against.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
          {cycles.map((c) => (
            <div
              key={c.id}
              className={`px-4 py-3 flex items-center justify-between ${
                c.isActive ? "bg-brand-50" : "bg-white"
              }`}
            >
              <div>
                <p className="font-semibold flex items-center gap-2">
                  {c.name}
                  {c.isActive && (
                    <span className="text-[10px] uppercase tracking-wide font-bold px-2 py-0.5 rounded-full bg-brand-500 text-white">
                      Active
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-mute">
                  {c.startDate.toLocaleDateString()} →{" "}
                  {c.endDate.toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>

        <form
          action={createCycle}
          className="mt-4 grid sm:grid-cols-4 gap-2 items-end border-t border-border pt-4"
        >
          <label className="text-sm">
            <span className="block text-ink-mute mb-1">Name</span>
            <input
              name="name"
              placeholder="FY 2027-28"
              className="w-full bg-white border border-border rounded px-3 py-2"
              required
            />
          </label>
          <label className="text-sm">
            <span className="block text-ink-mute mb-1">Starts</span>
            <input
              type="date"
              name="startDate"
              className="w-full bg-white border border-border rounded px-3 py-2"
              required
            />
          </label>
          <label className="text-sm">
            <span className="block text-ink-mute mb-1">Ends</span>
            <input
              type="date"
              name="endDate"
              className="w-full bg-white border border-border rounded px-3 py-2"
              required
            />
          </label>
          <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium inline-flex items-center justify-center gap-2 transition">
            <Plus className="w-4 h-4" />
            New cycle
          </button>
        </form>
      </section>

      {/* Snapshots + close */}
      {activeCycle && (
        <section className="mb-8 rounded-2xl bg-white border border-border shadow-soft p-6">
          <div className="flex items-center gap-2 mb-3">
            <Snowflake className="w-5 h-5 text-sky-600" />
            <h2 className="font-display text-lg font-bold">
              Snapshots · {activeCycle.name}
            </h2>
          </div>
          <p className="text-xs text-ink-mute mb-4">
            Snapshot a quarter when it ends to freeze every active user&apos;s
            tier and track scores. Frozen rows survive any later target /
            weight changes — they are what shows up in the Year-in-Review.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[1, 2, 3, 4].map((q) => {
              const frozen = frozenSet.has(q);
              return (
                <form
                  key={q}
                  action={snapshotQuarter}
                  className={`rounded-xl border p-4 ${
                    frozen
                      ? "bg-emerald-50 border-emerald-200"
                      : "bg-muted/40 border-border"
                  }`}
                >
                  <input type="hidden" name="cycleId" value={activeCycle.id} />
                  <input type="hidden" name="quarter" value={q} />
                  <p className="text-xs uppercase tracking-wider font-bold text-ink-faint mb-1">
                    Q{q}
                  </p>
                  <p
                    className={`text-sm font-semibold mb-2 ${
                      frozen ? "text-emerald-700" : "text-ink-soft"
                    }`}
                  >
                    {frozen ? "Frozen ❄️" : "Live"}
                  </p>
                  <button
                    type="submit"
                    className={`w-full text-xs py-1.5 rounded-lg font-medium transition ${
                      frozen
                        ? "bg-emerald-100 hover:bg-emerald-200 text-emerald-700"
                        : "bg-sky-500 hover:bg-sky-600 text-white"
                    }`}
                  >
                    {frozen ? "Re-snapshot" : "Snapshot Q" + q}
                  </button>
                </form>
              );
            })}
          </div>

          <details className="border-t border-border pt-5">
            <summary className="text-sm font-semibold text-rose-700 cursor-pointer hover:text-rose-800">
              ⚠️ Close this cycle
            </summary>
            <div className="mt-4 rounded-xl bg-rose-50 border border-rose-200 p-4">
              <p className="text-sm text-rose-800 mb-3">
                Closing {activeCycle.name} will snapshot all 4 quarters and
                deactivate this cycle. Employees will see their final
                Year-in-Review and start the next cycle from zero. This is
                irreversible — only use it at the end of the financial year.
              </p>
              <form action={closeActiveCycle}>
                <input type="hidden" name="cycleId" value={activeCycle.id} />
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-pop transition"
                >
                  <Lock className="w-4 h-4" />
                  Close cycle
                </button>
              </form>
            </div>
          </details>
        </section>
      )}

      {/* Tracks + targets */}
      {activeCycle && (
        <section className="mb-8 rounded-2xl bg-white border border-border shadow-soft p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <h2 className="font-display text-lg font-bold flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-brand-500" />
                Tracks · {activeCycle.name}
              </h2>
              <p className="text-xs text-ink-mute mt-0.5">
                Targets and weights per track per level. Score = clamp(actual /
                target × 100, 0–100). Total = Σ(score × weight). Weights should
                roughly sum to 100 across all tracks.
              </p>
            </div>
          </div>

          <form action={saveTargets} className="space-y-6">
            <input type="hidden" name="cycleId" value={activeCycle.id} />
            {TRACKS.map((trackKind) => {
              const meta = TRACK_META[trackKind];
              return (
                <div
                  key={trackKind}
                  className="rounded-xl border border-border overflow-hidden"
                >
                  <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
                    <div>
                      <p className="font-semibold">
                        <span className="text-lg mr-1">{meta.emoji}</span>
                        {meta.label}
                      </p>
                      <p className="text-xs text-ink-mute mt-0.5">
                        {trackBlurb(trackKind)}
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-white text-ink-mute text-xs">
                        <tr>
                          <th className="text-left p-2 pl-4">Level</th>
                          <th className="text-right p-2">Target</th>
                          <th className="text-right p-2 pr-4">Weight (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {LEVELS.map((level) => {
                          const t = targetByCell.get(`${trackKind}_${level}`);
                          if (!t) return null;
                          return (
                            <tr key={level}>
                              <td className="p-2 pl-4 font-medium">{level}</td>
                              <td className="p-2 text-right">
                                <input
                                  type="number"
                                  name={`t_${t.id}_target`}
                                  defaultValue={t.target}
                                  step="any"
                                  className="w-24 text-right bg-white border border-border rounded px-2 py-1"
                                />
                              </td>
                              <td className="p-2 pr-4 text-right">
                                <input
                                  type="number"
                                  name={`t_${t.id}_weight`}
                                  defaultValue={t.weight}
                                  min={0}
                                  max={100}
                                  className="w-20 text-right bg-white border border-border rounded px-2 py-1"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
            <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium inline-flex items-center gap-2 transition">
              <Save className="w-4 h-4" />
              Save targets &amp; weights
            </button>
          </form>
        </section>
      )}

      {/* Tiers reference */}
      <section className="rounded-2xl bg-white border border-border shadow-soft p-6">
        <h2 className="font-display text-lg font-bold mb-3">Tiers</h2>
        <p className="text-xs text-ink-mute mb-4">
          Total score → tier mapping. Names and thresholds are fixed for now —
          custom bands are coming in a later phase.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(Object.keys(TIER_META) as (keyof typeof TIER_META)[]).map((k) => {
            const t = TIER_META[k];
            return (
              <div
                key={k}
                className={`rounded-xl border border-border p-4 ${t.bg}`}
              >
                <p className={`font-display text-lg font-bold ${t.fg}`}>
                  {t.label}
                </p>
                <p className="text-xs text-ink-mute mt-0.5">
                  {t.minPct}% and above
                </p>
                <p className="text-sm text-ink-soft mt-2">{t.blurb}</p>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function trackBlurb(kind: TrackKind): string {
  switch (kind) {
    case "MASTERY":
      return "Auto. % of assigned modules/videos completed + average best-quiz score.";
    case "DELIVERY":
      return "Auto. % of assigned tasks/modules completed by their due date.";
    case "INITIATIVE":
      return "Self-log. Funded/active/shipped initiatives + initiative endorsements.";
    case "COLLABORATION":
      return "Endorsements received for cross-team help, mentorship, partnerships.";
    case "VISION":
      return "Self-set. % of milestones completed across approved Quests.";
    case "CRAFT":
      return "Manager-rated. Quality of work + soft skills (1.0 to 5.0 scale).";
  }
}
