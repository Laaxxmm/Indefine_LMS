import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

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
  const kind = String(formData.get("kind") || "VIDEO") as "VIDEO" | "TASK";
  const videoId = String(formData.get("videoId") || "") || null;
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim() || null;
  const points = Number(formData.get("points") || 0);
  const dueAtRaw = String(formData.get("dueAt") || "");
  const dueAt = dueAtRaw ? new Date(dueAtRaw) : null;
  const userIds = formData.getAll("userIds").map(String).filter(Boolean);

  if (kind === "VIDEO" && !videoId) return;
  if (kind === "TASK" && !title) return;
  if (userIds.length === 0) return;

  let resolvedTitle = title;
  if (kind === "VIDEO" && !title) {
    const v = await prisma.video.findUnique({ where: { id: videoId! } });
    resolvedTitle = v?.title ?? "Video";
  }

  await prisma.assignment.createMany({
    data: userIds.map((userId) => ({
      userId,
      assignedById: session.user.id,
      kind,
      videoId: kind === "VIDEO" ? videoId : null,
      title: resolvedTitle,
      description,
      points: Number.isFinite(points) ? points : 0,
      dueAt,
    })),
  });
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

  const [users, videos, assignments] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" } }),
    prisma.video.findMany({
      include: { module: true },
      orderBy: [{ moduleId: "asc" }, { order: "asc" }],
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
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
    }),
  ]);

  return (
    <main className="min-h-screen px-6 py-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <h1 className="text-3xl font-bold">Assignments</h1>
        <Link href="/admin" className="text-sm text-white/60 hover:text-white">
          ← Admin
        </Link>
      </div>

      {/* Create form */}
      <section className="rounded-xl bg-white/5 border border-white/10 p-5 mb-8">
        <h2 className="text-lg font-semibold mb-4">Create assignment</h2>
        <form action={createAssignments} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="block text-white/60 mb-1">Kind</span>
              <select
                name="kind"
                defaultValue="VIDEO"
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2"
              >
                <option value="VIDEO">Video — auto-completes when watched + quiz passed</option>
                <option value="TASK">Task — admin marks complete manually</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="block text-white/60 mb-1">KRA points on completion</span>
              <input
                type="number"
                name="points"
                min={0}
                defaultValue={10}
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2"
              />
            </label>
          </div>

          <label className="block text-sm">
            <span className="block text-white/60 mb-1">
              Pick video (for VIDEO kind)
            </span>
            <select
              name="videoId"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2"
            >
              <option value="">— none —</option>
              {videos.map((v) => (
                <option key={v.id} value={v.id}>
                  [{v.module.title}] {v.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="block text-white/60 mb-1">
              Title (required for TASK; optional for VIDEO — uses video name if blank)
            </span>
            <input
              name="title"
              placeholder="e.g. Read the new audit checklist and write a summary"
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2"
            />
          </label>

          <label className="block text-sm">
            <span className="block text-white/60 mb-1">Description (optional)</span>
            <textarea
              name="description"
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded px-3 py-2"
            />
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="block text-white/60 mb-1">Due date (optional)</span>
              <input
                type="date"
                name="dueAt"
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2"
              />
            </label>
          </div>

          <fieldset className="text-sm">
            <legend className="text-white/60 mb-2">
              Assign to ({users.length} user{users.length === 1 ? "" : "s"} available)
            </legend>
            {users.length === 0 ? (
              <div className="rounded border border-white/10 p-4 bg-white/5 text-sm text-white/60">
                No users yet.{" "}
                <Link href="/admin" className="text-brand-500 hover:text-brand-600 underline">
                  Sync users from M365
                </Link>{" "}
                from the admin home first.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-64 overflow-y-auto rounded border border-white/10 p-3 bg-white/5">
                {users.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 hover:bg-white/5 rounded px-2 py-1 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      name="userIds"
                      value={u.id}
                      className="accent-brand-500"
                    />
                    <span className="truncate">
                      {u.name ?? u.email}
                      <span className="text-white/40 text-xs ml-1">
                        {u.email}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-white/50 mt-2">
              Tip: tick multiple users to create one assignment per person in a single click.
            </p>
          </fieldset>

          <button className="px-5 py-2.5 rounded-lg bg-brand-500 hover:bg-brand-600 font-medium">
            Create assignment(s)
          </button>
        </form>
      </section>

      {/* Filters + list */}
      <section>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="text-lg font-semibold">
            All assignments{" "}
            <span className="text-white/50 font-normal text-sm">
              ({assignments.length})
            </span>
          </h2>
          <form method="GET" className="flex items-center gap-2 text-sm">
            <select
              name="user"
              defaultValue={filterUser}
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5"
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
              className="bg-white/5 border border-white/10 rounded px-2 py-1.5"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="COMPLETED">Completed</option>
            </select>
            <button className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/15">
              Filter
            </button>
          </form>
        </div>

        {assignments.length === 0 && (
          <p className="text-white/60 text-sm py-6 text-center bg-white/5 border border-white/10 rounded-xl">
            No assignments yet.
          </p>
        )}

        <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
          {assignments.map((a) => {
            const overdue =
              a.status === "PENDING" && a.dueAt && a.dueAt < new Date();
            return (
              <div
                key={a.id}
                className="px-5 py-3 border-b border-white/5 last:border-0 flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
                        a.kind === "VIDEO"
                          ? "bg-blue-500/20 text-blue-300"
                          : "bg-purple-500/20 text-purple-300"
                      }`}
                    >
                      {a.kind}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
                        a.status === "COMPLETED"
                          ? "bg-green-500/20 text-green-300"
                          : overdue
                            ? "bg-red-500/20 text-red-300"
                            : "bg-white/10 text-white/70"
                      }`}
                    >
                      {a.status === "COMPLETED"
                        ? "Completed"
                        : overdue
                          ? "Overdue"
                          : "Pending"}
                    </span>
                    <span className="text-xs text-white/60">
                      {a.points} pt
                    </span>
                  </div>
                  <p className="font-medium mt-1 truncate">{a.title}</p>
                  <p className="text-xs text-white/60 mt-0.5">
                    Assigned to <strong className="text-white/80">{a.user.name ?? a.user.email}</strong>
                    {a.dueAt && ` · due ${a.dueAt.toLocaleDateString()}`}
                    {a.completedAt && ` · completed ${a.completedAt.toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.status === "PENDING" && a.kind === "TASK" && (
                    <form action={markComplete}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="text-xs px-3 py-1.5 rounded bg-green-500/20 hover:bg-green-500/30 text-green-300">
                        Mark complete
                      </button>
                    </form>
                  )}
                  <form action={deleteAssignment}>
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-xs px-2 py-1.5 rounded text-red-300 hover:text-red-200 hover:bg-red-500/10">
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
