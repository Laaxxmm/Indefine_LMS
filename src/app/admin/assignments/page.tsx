import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");
  return session;
}

async function createAssignments(formData: FormData) {
  "use server";
  const session = await requireAdmin();
  const kind = String(formData.get("kind") || "VIDEO") as
    | "VIDEO"
    | "MODULE"
    | "TASK";
  const videoIds = formData.getAll("videoIds").map(String).filter(Boolean);
  const moduleIds = formData.getAll("moduleIds").map(String).filter(Boolean);
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim() || null;
  const points = Number(formData.get("points") || 0);
  const dueAtRaw = String(formData.get("dueAt") || "");
  const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
  const userIds = formData.getAll("userIds").map(String).filter(Boolean);

  if (kind === "VIDEO" && videoIds.length === 0) return;
  if (kind === "MODULE" && moduleIds.length === 0) return;
  if (kind === "TASK" && !title) return;
  if (userIds.length === 0) return;

  const safePoints = Number.isFinite(points) ? points : 0;

  if (kind === "MODULE") {
    // Multi-module × multi-user bulk create. Each module's assignment uses
    // that module's title (override-able with the title field if filled).
    const modules = await prisma.module.findMany({
      where: { id: { in: moduleIds } },
      select: { id: true, title: true },
    });
    const data = userIds.flatMap((userId) =>
      modules.map((m) => ({
        userId,
        assignedById: session.user.id,
        kind: "MODULE" as const,
        moduleId: m.id,
        title: title || m.title,
        description,
        points: safePoints,
        dueAt,
      }))
    );
    if (data.length > 0) await prisma.assignment.createMany({ data });
  } else if (kind === "VIDEO") {
    // Multi-video × multi-user: one assignment per (video, user). Each uses its
    // own video's title unless a title override is provided.
    const vids = await prisma.video.findMany({
      where: { id: { in: videoIds } },
      select: { id: true, title: true },
    });
    const data = userIds.flatMap((userId) =>
      vids.map((v) => ({
        userId,
        assignedById: session.user.id,
        kind: "VIDEO" as const,
        videoId: v.id,
        title: title || v.title,
        description,
        points: safePoints,
        dueAt,
      }))
    );
    if (data.length > 0) await prisma.assignment.createMany({ data });
  } else {
    // TASK
    await prisma.assignment.createMany({
      data: userIds.map((userId) => ({
        userId,
        assignedById: session.user.id,
        kind: "TASK" as const,
        title,
        description,
        points: safePoints,
        dueAt,
      })),
    });
  }

  revalidatePath("/admin/assignments");
  revalidatePath("/dashboard");
}

async function markComplete(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  await prisma.assignment.update({
    where: { id },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  revalidatePath("/admin/assignments");
  revalidatePath("/dashboard");
}

async function deleteAssignment(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  await prisma.assignment.delete({ where: { id } });
  revalidatePath("/admin/assignments");
  revalidatePath("/dashboard");
}

export default async function AdminAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const filterUser = sp.user || "";
  const filterStatus = sp.status || "";

  const [users, videos, modules, assignments] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    }),
    prisma.video.findMany({
      include: { module: true },
      orderBy: [{ moduleId: "asc" }, { order: "asc" }],
    }),
    prisma.module.findMany({
      where: { videos: { some: {} } },
      include: { course: true, _count: { select: { videos: true } } },
      orderBy: [{ courseId: "asc" }, { order: "asc" }],
    }),
    prisma.assignment.findMany({
      where: {
        ...(filterUser ? { userId: filterUser } : {}),
        ...(filterStatus
          ? { status: filterStatus as "PENDING" | "COMPLETED" }
          : {}),
      },
      include: {
        user: true,
        assignedBy: true,
        video: true,
        module: { include: { videos: { select: { id: true }, orderBy: { order: "asc" }, take: 1 } } },
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  return (
    <main className="px-6 py-8 max-w-5xl">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-wider font-semibold text-ink-faint mb-1">
          Admin · Assignments
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Assignments
        </h1>
        <p className="text-ink-mute mt-1 text-sm">
          Assign videos or custom tasks to specific employees. Points roll into KRA.
        </p>
      </div>

      {/* Create form */}
      <section className="rounded-2xl bg-white border border-border p-6 mb-8 shadow-soft">
        <h2 className="font-display text-lg font-bold mb-4">Create assignment</h2>
        <form action={createAssignments} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="block text-ink-mute mb-1">Kind</span>
              <select
                name="kind"
                defaultValue="MODULE"
                className="w-full bg-white border border-border shadow-soft rounded px-3 py-2"
              >
                <option value="MODULE">Module — completes when every video + quiz in the module is done</option>
                <option value="VIDEO">Video(s) — pick one or more; completes when watched + quiz passed</option>
                <option value="TASK">Task — admin marks complete manually</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-ink-mute mb-1">
                KRA points on completion (per assignment)
              </span>
              <input
                type="number"
                name="points"
                min={0}
                defaultValue={50}
                className="w-full bg-white border border-border shadow-soft rounded px-3 py-2"
              />
            </label>
          </div>

          <fieldset className="text-sm">
            <legend className="text-ink-mute mb-2">
              Pick modules (for MODULE kind — tick one or more)
            </legend>
            {modules.length === 0 ? (
              <div className="rounded border border-border p-4 bg-muted text-sm text-ink-mute">
                No modules yet. Sync videos from the Admin home first.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-60 overflow-y-auto rounded border border-border p-3 bg-muted/40">
                {modules.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 hover:bg-white rounded px-2 py-1.5 cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      name="moduleIds"
                      value={m.id}
                      className="accent-brand-500"
                    />
                    <span className="truncate">
                      <span className="font-medium">{m.title}</span>
                      <span className="text-ink-faint text-xs ml-1">
                        · {m._count.videos} videos
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="text-sm">
            <legend className="text-ink-mute mb-2">
              Pick videos (for VIDEO kind — tick one or more)
            </legend>
            {videos.length === 0 ? (
              <div className="rounded border border-border p-4 bg-muted text-sm text-ink-mute">
                No videos yet. Sync from the Admin home first.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-1.5 max-h-60 overflow-y-auto rounded border border-border p-3 bg-muted/40">
                {videos.map((v) => (
                  <label
                    key={v.id}
                    className="flex items-center gap-2 hover:bg-white rounded px-2 py-1.5 cursor-pointer transition"
                  >
                    <input
                      type="checkbox"
                      name="videoIds"
                      value={v.id}
                      className="accent-brand-500"
                    />
                    <span className="truncate">
                      <span className="font-medium">{v.title}</span>
                      <span className="text-ink-faint text-xs ml-1">
                        · {v.module.title}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <label className="block text-sm">
            <span className="block text-ink-mute mb-1">
              Title (required for TASK; optional for VIDEO/MODULE — uses the
              video / module name if blank)
            </span>
            <input
              name="title"
              placeholder="e.g. Complete the Audit Standards module by Q2 end"
              className="w-full bg-white border border-border shadow-soft rounded px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="block text-ink-mute mb-1">Description (optional)</span>
            <textarea
              name="description"
              rows={3}
              className="w-full bg-white border border-border shadow-soft rounded px-3 py-2"
            />
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="block text-ink-mute mb-1">Due date (optional)</span>
              <input
                type="date"
                name="dueAt"
                className="w-full bg-white border border-border shadow-soft rounded px-3 py-2"
              />
            </label>
          </div>

          <fieldset className="text-sm">
            <legend className="text-ink-mute mb-2">
              Assign to ({users.length} user{users.length === 1 ? "" : "s"} available)
            </legend>
            {users.length === 0 ? (
              <div className="rounded border border-border p-4 bg-muted text-sm text-ink-mute">
                No users yet.{" "}
                <Link href="/admin" className="text-brand-500 hover:text-brand-600 underline">
                  Sync users from M365
                </Link>{" "}
                from the admin home first.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto rounded border border-border p-3 bg-muted">
                {users.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 hover:bg-muted rounded px-2 py-1 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      name="userIds"
                      value={u.id}
                      className="accent-brand-500"
                    />
                    <span className="truncate">
                      {u.name ?? u.email}
                      <span className="text-ink-faint text-xs ml-1">
                        {u.email}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-ink-faint mt-2">
              Tip: tick multiple users to create one assignment per person in a single click.
            </p>
          </fieldset>

          <SubmitButton className="px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white font-medium">
            Create assignment(s)
          </SubmitButton>
        </form>
      </section>

      {/* Filters + list */}
      <section>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-lg font-semibold">
            All assignments{" "}
            <span className="text-ink-faint font-normal text-sm">
              ({assignments.length})
            </span>
          </h2>
          <form method="GET" className="flex items-center gap-2 text-sm">
            <select
              name="user"
              defaultValue={filterUser}
              className="bg-white border border-border shadow-soft rounded px-2 py-1.5"
            >
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
            </select>
            <select
              name="status"
              defaultValue={filterStatus}
              className="bg-white border border-border shadow-soft rounded px-2 py-1.5"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="COMPLETED">Completed</option>
            </select>
            <button className="px-3 py-1.5 rounded bg-muted hover:bg-border">
              Filter
            </button>
          </form>
        </div>

        {assignments.length === 0 && (
          <p className="text-ink-mute text-sm py-6 text-center bg-white border border-border shadow-soft rounded-xl">
            No assignments yet.
          </p>
        )}

        <div className="rounded-xl bg-white border border-border shadow-soft overflow-hidden">
          {assignments.map((a) => {
            const overdue =
              a.status === "PENDING" && a.dueAt && a.dueAt < new Date();
            return (
              <div
                key={a.id}
                className="px-5 py-3 border-b border-border last:border-0 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full ${
                        a.kind === "VIDEO"
                          ? "bg-brand-50 text-brand-700"
                          : a.kind === "MODULE"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-violet-50 text-violet-700"
                      }`}
                    >
                      {a.kind}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
                        a.status === "COMPLETED"
                          ? "bg-emerald-50 text-emerald-700"
                          : overdue
                            ? "bg-rose-50 text-rose-700"
                            : "bg-muted text-ink-soft"
                      }`}
                    >
                      {a.status === "COMPLETED"
                        ? "Completed"
                        : overdue
                          ? "Overdue"
                          : "Pending"}
                    </span>
                    <span className="text-xs text-ink-mute">
                      {a.points} pt
                    </span>
                  </div>
                  <p className="font-medium mt-1 truncate">{a.title}</p>
                  <p className="text-xs text-ink-mute mt-0.5">
                    Assigned to <strong className="text-ink">{a.user.name ?? a.user.email}</strong>
                    {a.dueAt && ` · due ${a.dueAt.toLocaleDateString()}`}
                    {a.completedAt && ` · completed ${a.completedAt.toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.status === "PENDING" && a.kind === "TASK" && (
                    <form action={markComplete}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="text-xs px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold border border-emerald-200 transition">
                        Mark complete
                      </button>
                    </form>
                  )}
                  <form action={deleteAssignment}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-xs px-2 py-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 font-semibold transition">
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
