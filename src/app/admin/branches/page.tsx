import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { computeKraScores } from "@/lib/kra";
import { Building2, Plus, Save, Trash2, Users, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
}

async function createBranch(formData: FormData) {
  "use server";
  await requireAdmin();
  const name = String(formData.get("name") || "").trim();
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const city = String(formData.get("city") || "").trim() || null;
  const state = String(formData.get("state") || "").trim() || null;
  if (!name || !code) return;
  await prisma.branch.create({
    data: { name, code, city, state, isActive: true },
  });
  revalidatePath("/admin/branches");
  revalidatePath("/admin/team");
}

async function updateBranch(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  const name = String(formData.get("name") || "").trim();
  const code = String(formData.get("code") || "").trim().toUpperCase();
  const city = String(formData.get("city") || "").trim() || null;
  const state = String(formData.get("state") || "").trim() || null;
  const isActive = formData.get("isActive") === "on";
  if (!name || !code) return;
  await prisma.branch.update({
    where: { id },
    data: { name, code, city, state, isActive },
  });
  revalidatePath("/admin/branches");
  revalidatePath("/admin/team");
}

async function removeBranch(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  // Detach users first (so we don't fail FK checks)
  await prisma.user.updateMany({
    where: { branchId: id },
    data: { branchId: null },
  });
  await prisma.branch.delete({ where: { id } });
  revalidatePath("/admin/branches");
  revalidatePath("/admin/team");
}

export default async function BranchesPage() {
  await requireAdmin();
  const branches = await prisma.branch.findMany({
    include: {
      _count: { select: { users: { where: { active: true } } } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  // Aggregate scores per branch for leaderboard summary
  const allScores = await computeKraScores();
  const scoresByUser = new Map(allScores.map((s) => [s.userId, s.totalScore]));
  const usersByBranch = await prisma.user.findMany({
    where: { active: true, branchId: { not: null } },
    select: { id: true, branchId: true },
  });
  const branchScore = new Map<string, { sum: number; n: number }>();
  for (const u of usersByBranch) {
    if (!u.branchId) continue;
    const s = scoresByUser.get(u.id) ?? 0;
    const cur = branchScore.get(u.branchId) ?? { sum: 0, n: 0 };
    cur.sum += s;
    cur.n += 1;
    branchScore.set(u.branchId, cur);
  }

  return (
    <main className="px-6 py-8 max-w-5xl">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1.5">
          Admin · Branches
        </p>
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">
          Branches
        </h1>
        <p className="text-ink-mute mt-1 text-sm">
          Add a branch for each office. Assign users to branches in Team &
          hierarchy. Branch scores roll up live from each member&apos;s total.
        </p>
      </div>

      {/* Create */}
      <section className="rounded-2xl bg-white border border-border shadow-soft p-5 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Plus className="w-4 h-4 text-brand-500" />
          <h2 className="font-display font-bold">Add a branch</h2>
        </div>
        <form
          action={createBranch}
          className="grid sm:grid-cols-5 gap-2 items-end"
        >
          <label className="text-sm sm:col-span-2">
            <span className="block text-ink-mute mb-1">Name</span>
            <input
              name="name"
              placeholder="Bangalore HQ"
              required
              className="w-full bg-white border border-border rounded-lg px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="block text-ink-mute mb-1">Code</span>
            <input
              name="code"
              placeholder="BLR"
              required
              maxLength={6}
              className="w-full bg-white border border-border rounded-lg px-3 py-2 uppercase"
            />
          </label>
          <label className="text-sm">
            <span className="block text-ink-mute mb-1">City</span>
            <input
              name="city"
              placeholder="Bangalore"
              className="w-full bg-white border border-border rounded-lg px-3 py-2"
            />
          </label>
          <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-pop transition">
            <Plus className="w-4 h-4" />
            Add
          </button>
        </form>
      </section>

      {/* List */}
      <section>
        <h2 className="font-display font-bold mb-3 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-ink-mute" />
          All branches{" "}
          <span className="text-ink-faint font-normal text-sm">
            ({branches.length})
          </span>
        </h2>
        {branches.length === 0 ? (
          <div className="rounded-2xl bg-white border border-dashed border-border p-12 text-center shadow-soft">
            <Building2 className="w-12 h-12 text-ink-faint mx-auto mb-3" />
            <p className="text-ink-mute">
              No branches yet — add your first one above.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {branches.map((b) => {
              const score = branchScore.get(b.id);
              const avg = score && score.n > 0 ? Math.round(score.sum / score.n) : 0;
              return (
                <form
                  key={b.id}
                  action={updateBranch}
                  className={`rounded-2xl bg-white border shadow-soft p-5 ${
                    !b.isActive ? "border-dashed opacity-70" : "border-border"
                  }`}
                >
                  <input type="hidden" name="id" value={b.id} />
                  <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center font-bold text-sm shrink-0">
                        {b.code}
                      </div>
                      <div className="min-w-0 flex-1 grid sm:grid-cols-2 gap-2">
                        <input
                          name="name"
                          defaultValue={b.name}
                          required
                          className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm font-semibold"
                        />
                        <input
                          name="code"
                          defaultValue={b.code}
                          maxLength={6}
                          required
                          className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm uppercase font-mono"
                        />
                        <input
                          name="city"
                          defaultValue={b.city ?? ""}
                          placeholder="City"
                          className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm"
                        />
                        <input
                          name="state"
                          defaultValue={b.state ?? ""}
                          placeholder="State"
                          className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                    </div>

                    <div className="flex items-stretch gap-3">
                      <Stat
                        icon={Users}
                        label="Active users"
                        value={b._count.users}
                      />
                      <Stat
                        icon={Trophy}
                        label="Avg score"
                        value={avg}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-4 flex-wrap gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="isActive"
                        defaultChecked={b.isActive}
                        className="accent-brand-500"
                      />
                      Active
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        className="text-xs px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-semibold inline-flex items-center gap-1.5 transition"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Save
                      </button>
                      <button
                        formAction={removeBranch}
                        className="text-xs px-3 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1.5 transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </div>
                </form>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl bg-muted/40 border border-border px-3 py-2 text-center min-w-[90px]">
      <Icon className="w-3.5 h-3.5 mx-auto mb-1 text-ink-mute" />
      <p className="font-display text-lg font-extrabold tabular-nums leading-none">
        {value}
      </p>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint mt-0.5">
        {label}
      </p>
    </div>
  );
}
