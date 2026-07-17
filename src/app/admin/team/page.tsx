import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Users, Save, Building2 } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import type { EmployeeLevel, Department } from "@prisma/client";
import {
  ACTIVE_LEVELS,
  DEPARTMENTS,
  departmentLabel,
  levelLabel,
} from "@/lib/ca-firm";

export const dynamic = "force-dynamic";

async function saveHierarchy(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return;
  const meId = session.user.id;

  const ops: Promise<unknown>[] = [];
  // Group by user — collect all fields from this submission then apply once.
  const updates = new Map<string, Record<string, unknown>>();
  for (const [key, value] of formData.entries()) {
    const m = key.match(/^(manager|level|department|branch|role|director)_(.+)$/);
    if (!m) continue;
    const field = m[1];
    const userId = m[2];
    const cur = updates.get(userId) ?? {};
    const v = String(value).trim();

    if (field === "manager") cur.managerId = v || null;
    else if (field === "level" && ACTIVE_LEVELS.includes(v as EmployeeLevel))
      cur.level = v;
    else if (
      field === "department" &&
      DEPARTMENTS.includes(v as Department)
    )
      cur.department = v;
    else if (field === "branch") cur.branchId = v || null;
    else if (field === "role" && (v === "ADMIN" || v === "EMPLOYEE")) cur.role = v;
    else if (field === "director") cur.isDirector = v === "yes";

    updates.set(userId, cur);
  }

  // Never let an admin change their own role here — prevents self-lockout.
  const self = updates.get(meId);
  if (self && "role" in self) delete self.role;

  for (const [userId, data] of updates) {
    if (Object.keys(data).length > 0) {
      ops.push(prisma.user.update({ where: { id: userId }, data }));
    }
  }
  await Promise.all(ops);
  revalidatePath("/admin/team");
  revalidatePath("/team");
  revalidatePath("/leaderboard");
  revalidatePath("/tools");
}

export default async function AdminTeamPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  const sp = await searchParams;

  const [users, branches] = await Promise.all([
    prisma.user.findMany({
      where: {
        active: true,
        ...(sp.branch ? { branchId: sp.branch } : {}),
        ...(sp.dept ? { department: sp.dept as Department } : {}),
      },
      include: { branch: true },
      orderBy: [{ department: "asc" }, { level: "desc" }, { name: "asc" }],
    }),
    prisma.branch.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <main className="px-6 py-8 max-w-6xl">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1.5">
          Admin · Team
        </p>
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">
          Team & hierarchy
        </h1>
        <p className="text-ink-mute mt-1 text-sm">
          Set each person&apos;s level, department, branch and manager. The
          combination drives their KRA targets, leaderboard placement and
          who-reports-to-whom. <strong className="text-ink">Admin access</strong>{" "}
          grants the full admin area — it&apos;s separate from the career
          <em> Level</em> (Partner, Manager, …), which is just org hierarchy.
        </p>
      </div>

      {/* Filters */}
      <form
        method="GET"
        className="rounded-2xl bg-white border border-border shadow-soft p-4 mb-4 flex items-end gap-3 flex-wrap"
      >
        <label className="text-sm">
          <span className="block text-ink-mute mb-1">Branch</span>
          <select
            name="branch"
            defaultValue={sp.branch ?? ""}
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
        <label className="text-sm">
          <span className="block text-ink-mute mb-1">Department</span>
          <select
            name="dept"
            defaultValue={sp.dept ?? ""}
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
        {(sp.branch || sp.dept) && (
          <a
            href="/admin/team"
            className="text-xs px-3 py-1.5 rounded-lg bg-white border border-border hover:bg-muted transition"
          >
            Clear
          </a>
        )}
      </form>

      <form
        action={saveHierarchy}
        className="rounded-2xl bg-white border border-border shadow-soft overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-border bg-muted/40 flex items-center gap-2">
          <Users className="w-4 h-4 text-ink-mute" />
          <p className="font-display font-bold text-sm">
            {users.length} user{users.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-faint">
              <tr>
                <th className="text-left p-3 pl-5">Employee</th>
                <th className="text-left p-3">Admin access</th>
                <th className="text-left p-3">Director</th>
                <th className="text-left p-3">Level</th>
                <th className="text-left p-3">Dept</th>
                <th className="text-left p-3">Branch</th>
                <th className="text-left p-3 pr-5">Manager</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => {
                const possibleManagers = users.filter((m) => m.id !== u.id);
                const isSelf = u.id === session.user.id;
                return (
                  <tr key={u.id} className="hover:bg-muted/30 transition">
                    <td className="p-3 pl-5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-violet text-white flex items-center justify-center text-xs font-bold shrink-0">
                          {(u.name ?? u.email).slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold truncate">
                            {u.name ?? u.email}
                          </p>
                          <p className="text-xs text-ink-faint truncate">
                            {u.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      {isSelf ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-2 py-1.5"
                          title="You can't change your own admin access"
                        >
                          Admin · you
                        </span>
                      ) : (
                        <select
                          name={`role_${u.id}`}
                          defaultValue={u.role}
                          className={`border rounded-lg px-2 py-1.5 text-xs font-semibold ${
                            u.role === "ADMIN"
                              ? "bg-brand-50 border-brand-300 text-brand-700"
                              : "bg-white border-border text-ink-soft"
                          }`}
                        >
                          <option value="EMPLOYEE">Employee</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      )}
                    </td>
                    <td className="p-3">
                      <select
                        name={`director_${u.id}`}
                        defaultValue={u.isDirector ? "yes" : "no"}
                        className={`border rounded-lg px-2 py-1.5 text-xs font-semibold ${
                          u.isDirector
                            ? "bg-brand-50 border-brand-300 text-brand-700"
                            : "bg-white border-border text-ink-soft"
                        }`}
                        title="Directors get access to the Neo Centra cockpit"
                      >
                        <option value="no">—</option>
                        <option value="yes">Director</option>
                      </select>
                    </td>
                    <td className="p-3">
                      <select
                        name={`level_${u.id}`}
                        defaultValue={
                          ACTIVE_LEVELS.includes(u.level)
                            ? u.level
                            : "EXECUTIVE"
                        }
                        className="bg-white border border-border rounded-lg px-2 py-1.5 text-xs"
                      >
                        {ACTIVE_LEVELS.map((lv) => (
                          <option key={lv} value={lv}>
                            {levelLabel(lv)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3">
                      <select
                        name={`department_${u.id}`}
                        defaultValue={u.department}
                        className="bg-white border border-border rounded-lg px-2 py-1.5 text-xs"
                      >
                        {DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>
                            {departmentLabel(d)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3">
                      <select
                        name={`branch_${u.id}`}
                        defaultValue={u.branchId ?? ""}
                        className="bg-white border border-border rounded-lg px-2 py-1.5 text-xs"
                      >
                        <option value="">— none —</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.code}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3 pr-5">
                      <select
                        name={`manager_${u.id}`}
                        defaultValue={u.managerId ?? ""}
                        className="bg-white border border-border rounded-lg px-2 py-1.5 text-xs w-full max-w-[200px]"
                      >
                        <option value="">— none —</option>
                        {possibleManagers.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name ?? m.email}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-border bg-muted/40 flex items-center justify-between">
          <p className="text-xs text-ink-mute inline-flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" />
            Manage branches at{" "}
            <a href="/admin/branches" className="text-brand-600 hover:underline">
              /admin/branches
            </a>
          </p>
          <SubmitButton className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold shadow-pop">
            <Save className="w-4 h-4" />
            Save changes
          </SubmitButton>
        </div>
      </form>
    </main>
  );
}
