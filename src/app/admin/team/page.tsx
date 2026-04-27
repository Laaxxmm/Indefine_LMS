import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { Users, Save } from "lucide-react";
import type { EmployeeLevel } from "@prisma/client";

export const dynamic = "force-dynamic";

const LEVELS: EmployeeLevel[] = [
  "TRAINEE",
  "ASSOCIATE",
  "SENIOR",
  "LEAD",
  "MANAGER",
  "PARTNER",
];

async function saveHierarchy(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return;

  const ops: Promise<unknown>[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("manager_")) {
      const userId = key.slice("manager_".length);
      const managerId = String(value).trim();
      ops.push(
        prisma.user.update({
          where: { id: userId },
          data: { managerId: managerId || null },
        })
      );
    } else if (key.startsWith("level_")) {
      const userId = key.slice("level_".length);
      const level = String(value) as EmployeeLevel;
      if (LEVELS.includes(level)) {
        ops.push(
          prisma.user.update({
            where: { id: userId },
            data: { level },
          })
        );
      }
    }
  }
  await Promise.all(ops);
  revalidatePath("/admin/team");
  revalidatePath("/team");
}

export default async function AdminTeamPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: [{ level: "desc" }, { name: "asc" }],
  });

  return (
    <main className="px-6 py-8 max-w-5xl">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-wider font-semibold text-ink-faint mb-1">
          Admin · Team
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Team & hierarchy
        </h1>
        <p className="text-ink-mute mt-1 text-sm">
          Set each employee&apos;s level and assign their manager. Managers see
          their direct reports&apos; trajectory rings and coaching prompts on{" "}
          <code className="text-ink font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">
            /team
          </code>
          .
        </p>
      </div>

      <form
        action={saveHierarchy}
        className="rounded-2xl bg-white border border-border shadow-soft overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-border bg-muted/40 flex items-center gap-2">
          <Users className="w-4 h-4 text-ink-mute" />
          <p className="font-display font-bold text-sm">
            {users.length} active user{users.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-faint">
              <tr>
                <th className="text-left p-3 pl-5">Employee</th>
                <th className="text-left p-3">Level</th>
                <th className="text-left p-3 pr-5">Manager</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => {
                const possibleManagers = users.filter(
                  (m) => m.id !== u.id
                );
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
                          <p className="text-xs text-ink-faint truncate">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-3">
                      <select
                        name={`level_${u.id}`}
                        defaultValue={u.level}
                        className="bg-white border border-border rounded-lg px-2 py-1.5 text-sm"
                      >
                        {LEVELS.map((lv) => (
                          <option key={lv} value={lv}>
                            {lv}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3 pr-5">
                      <select
                        name={`manager_${u.id}`}
                        defaultValue={u.managerId ?? ""}
                        className="bg-white border border-border rounded-lg px-2 py-1.5 text-sm w-full max-w-xs"
                      >
                        <option value="">— none —</option>
                        {possibleManagers.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name ?? m.email} · {m.level}
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
        <div className="px-5 py-4 border-t border-border bg-muted/40">
          <button className="px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold inline-flex items-center gap-2 shadow-pop transition">
            <Save className="w-4 h-4" />
            Save changes
          </button>
        </div>
      </form>
    </main>
  );
}
