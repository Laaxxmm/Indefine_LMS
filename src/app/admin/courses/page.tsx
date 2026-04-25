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
}

async function updateCourse(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  await prisma.course.update({
    where: { id },
    data: {
      title: String(formData.get("title") || "Course"),
      description: String(formData.get("description") || "") || null,
      published: formData.get("published") === "on",
    },
  });
  revalidatePath("/admin/courses");
}

async function addDeadline(formData: FormData) {
  "use server";
  await requireAdmin();
  const courseId = String(formData.get("courseId"));
  const kind = String(formData.get("kind") || "CUSTOM") as
    | "MONTHLY"
    | "QUARTERLY"
    | "YEARLY"
    | "CUSTOM";
  const dueAtRaw = String(formData.get("dueAt") || "");
  const pointsOnTime = Number(formData.get("pointsOnTime") || 10);
  const pointsLate = Number(formData.get("pointsLate") || 0);
  if (!dueAtRaw) return;
  const dueAt = new Date(dueAtRaw);
  if (Number.isNaN(dueAt.getTime())) return;

  await prisma.deadline.create({
    data: { courseId, kind, dueAt, pointsOnTime, pointsLate },
  });
  revalidatePath("/admin/courses");
  revalidatePath("/dashboard");
}

async function deleteDeadline(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = String(formData.get("id"));
  await prisma.deadline.delete({ where: { id } });
  revalidatePath("/admin/courses");
  revalidatePath("/dashboard");
}

export default async function AdminCoursesPage() {
  await requireAdmin();
  const courses = await prisma.course.findMany({
    include: {
      deadlines: { orderBy: { dueAt: "asc" } },
      modules: { include: { _count: { select: { videos: true } } } },
    },
    orderBy: { order: "asc" },
  });

  return (
    <main className="min-h-screen px-6 py-10 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Courses & deadlines</h1>
        <Link href="/admin" className="text-sm text-white/60 hover:text-white">
          ← Admin
        </Link>
      </div>

      {courses.length === 0 && (
        <p className="text-white/60">
          No courses yet — sync OneDrive from the admin home to create the default course.
        </p>
      )}

      <div className="space-y-8">
        {courses.map((c) => {
          const videoCount = c.modules.reduce((s, m) => s + m._count.videos, 0);
          return (
            <section
              key={c.id}
              className="rounded-xl bg-white/5 border border-white/10 p-6"
            >
              <form action={updateCourse} className="grid sm:grid-cols-2 gap-3 mb-6">
                <input type="hidden" name="id" value={c.id} />
                <Field label="Title" name="title" defaultValue={c.title} colSpan />
                <Field
                  label="Description"
                  name="description"
                  defaultValue={c.description ?? ""}
                  colSpan
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="published"
                    defaultChecked={c.published}
                    className="accent-brand-500"
                  />
                  Published
                </label>
                <div className="flex items-center justify-end gap-3">
                  <span className="text-xs text-white/50">{videoCount} videos</span>
                  <button className="px-3 py-1.5 rounded bg-brand-500 hover:bg-brand-600 text-sm">
                    Save
                  </button>
                </div>
              </form>

              <h3 className="text-sm font-semibold text-white/80 mb-3">
                Deadlines ({c.deadlines.length})
              </h3>
              {c.deadlines.length === 0 && (
                <p className="text-xs text-white/50 mb-3">
                  No deadlines yet.
                </p>
              )}
              <div className="space-y-2 mb-4">
                {c.deadlines.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between rounded bg-white/5 border border-white/10 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{d.kind}</span> •{" "}
                      Due {d.dueAt.toLocaleDateString()} • On-time {d.pointsOnTime}pt /
                      Late {d.pointsLate}pt
                    </div>
                    <form action={deleteDeadline}>
                      <input type="hidden" name="id" value={d.id} />
                      <button className="text-xs text-red-300 hover:text-red-200">
                        Delete
                      </button>
                    </form>
                  </div>
                ))}
              </div>

              <form
                action={addDeadline}
                className="grid sm:grid-cols-5 gap-2 items-end border-t border-white/10 pt-4"
              >
                <input type="hidden" name="courseId" value={c.id} />
                <label className="text-sm">
                  <span className="block text-white/60 mb-1">Kind</span>
                  <select
                    name="kind"
                    defaultValue="CUSTOM"
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="YEARLY">Yearly</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </label>
                <Field label="Due date" name="dueAt" type="date" required />
                <Field
                  label="On-time pts"
                  name="pointsOnTime"
                  type="number"
                  defaultValue={10}
                />
                <Field
                  label="Late pts"
                  name="pointsLate"
                  type="number"
                  defaultValue={0}
                />
                <button className="px-3 py-2 rounded bg-brand-500 hover:bg-brand-600 text-sm">
                  Add deadline
                </button>
              </form>
            </section>
          );
        })}
      </div>
    </main>
  );
}

function Field({
  label,
  colSpan,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  colSpan?: boolean;
}) {
  return (
    <label className={`text-sm ${colSpan ? "sm:col-span-2" : ""}`}>
      <span className="block text-white/60 mb-1">{label}</span>
      <input
        {...input}
        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5"
      />
    </label>
  );
}
