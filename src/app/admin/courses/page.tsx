import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { SubmitButton } from "@/components/SubmitButton";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ChevronDown } from "lucide-react";

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
      modules: {
        orderBy: { order: "asc" },
        include: {
          _count: { select: { videos: true } },
          videos: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              title: true,
              quiz: { select: { _count: { select: { questions: true } } } },
            },
          },
        },
      },
    },
    orderBy: { order: "asc" },
  });

  return (
    <main className="min-h-screen px-6 py-10 max-w-4xl mx-auto">
      <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1.5">
            Admin · Courses
          </p>
          <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">
            Courses & deadlines
          </h1>
        </div>
        <Link
          href="/admin"
          className="text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white hover:bg-muted border border-border shadow-soft transition shrink-0"
        >
          ← Admin
        </Link>
      </div>

      {courses.length === 0 && (
        <p className="text-ink-mute">
          No courses yet — sync OneDrive from the admin home to create the default course.
        </p>
      )}

      <div className="space-y-8">
        {courses.map((c) => {
          const videoCount = c.modules.reduce((s, m) => s + m._count.videos, 0);
          return (
            <section
              key={c.id}
              className="rounded-2xl bg-white border border-border shadow-soft p-6"
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
                  <span className="text-xs text-ink-faint">{videoCount} videos</span>
                  <SubmitButton className="px-3 py-1.5 rounded bg-brand-500 hover:bg-brand-600 text-white text-sm">
                    Save
                  </SubmitButton>
                </div>
              </form>

              <div className="mb-6">
                <h3 className="text-sm font-semibold text-ink mb-3">
                  Modules ({c.modules.length})
                </h3>
                {c.modules.length === 0 ? (
                  <p className="text-xs text-ink-faint">
                    No modules yet — sync OneDrive from the admin home to import videos.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {c.modules.map((m) => (
                      <details
                        key={m.id}
                        className="rounded-xl border border-border overflow-hidden group"
                      >
                        <summary className="flex items-center justify-between px-3 py-2 bg-muted cursor-pointer list-none select-none hover:bg-border/60 transition [&::-webkit-details-marker]:hidden">
                          <span className="text-sm font-medium">{m.title}</span>
                          <span className="text-xs text-ink-faint inline-flex items-center gap-2">
                            {m._count.videos} video{m._count.videos === 1 ? "" : "s"}
                            <ChevronDown className="w-3.5 h-3.5 transition group-open:rotate-180" />
                          </span>
                        </summary>
                        {m.videos.length > 0 && (
                          <ul className="divide-y divide-border">
                            {m.videos.map((v) => {
                              const qCount = v.quiz?._count.questions ?? 0;
                              return (
                                <li key={v.id}>
                                  <Link
                                    href={`/admin/video/${v.id}`}
                                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/50 transition"
                                  >
                                    <span className="truncate">{v.title}</span>
                                    <span
                                      className={`text-xs shrink-0 px-2 py-0.5 rounded-full ${
                                        qCount > 0
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-white text-ink-faint border border-border"
                                      }`}
                                    >
                                      {qCount > 0 ? `✓ ${qCount} Qs` : "No quiz"}
                                    </span>
                                  </Link>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </details>
                    ))}
                  </div>
                )}
              </div>

              <h3 className="text-sm font-semibold text-ink mb-3">
                Deadlines ({c.deadlines.length})
              </h3>
              {c.deadlines.length === 0 && (
                <p className="text-xs text-ink-faint mb-3">
                  No deadlines yet.
                </p>
              )}
              <div className="space-y-2 mb-4">
                {c.deadlines.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between rounded bg-muted border border-border px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium">{d.kind}</span> •{" "}
                      Due {d.dueAt.toLocaleDateString()} • On-time {d.pointsOnTime}pt /
                      Late {d.pointsLate}pt
                    </div>
                    <form action={deleteDeadline}>
                      <input type="hidden" name="id" value={d.id} />
                      <ConfirmButton
                        message="Delete this deadline? This cannot be undone."
                        className="text-xs text-rose-600 hover:text-rose-500"
                      >
                        Delete
                      </ConfirmButton>
                    </form>
                  </div>
                ))}
              </div>

              <form
                action={addDeadline}
                className="grid sm:grid-cols-5 gap-2 items-end border-t border-border pt-4"
              >
                <input type="hidden" name="courseId" value={c.id} />
                <label className="text-sm">
                  <span className="block text-ink-mute mb-1">Kind</span>
                  <select
                    name="kind"
                    defaultValue="CUSTOM"
                    className="w-full bg-muted border border-border rounded px-2 py-1.5"
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
                <SubmitButton className="px-3 py-2 rounded bg-brand-500 hover:bg-brand-600 text-white text-sm">
                  Add deadline
                </SubmitButton>
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
      <span className="block text-ink-mute mb-1">{label}</span>
      <input
        {...input}
        className="w-full bg-muted border border-border rounded px-2 py-1.5"
      />
    </label>
  );
}
