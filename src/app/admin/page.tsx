import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { syncOneDriveVideos } from "@/lib/sync";
import { syncOrgUsers } from "@/lib/users-sync";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  Users,
  Layers,
  Video,
  HelpCircle,
  RefreshCw,
  ArrowRight,
  Target,
  CalendarClock,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Building2,
  ChevronDown,
  Folder,
  Trash2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { ConfirmButton } from "@/components/ConfirmButton";
import { isAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

async function syncAction(): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) return;
  const cookieStore = await cookies();
  try {
    const r = await syncOneDriveVideos({ fallbackUserId: session.user.id });
    cookieStore.set(
      "admin_flash",
      `videos:ok:${r.added} added, ${r.updated} updated across ${r.modules} module${r.modules === 1 ? "" : "s"}`,
      { maxAge: 10, httpOnly: false }
    );
  } catch (e) {
    cookieStore.set(
      "admin_flash",
      `videos:error:${(e as Error).message.slice(0, 240)}`,
      { maxAge: 10, httpOnly: false }
    );
  }
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

// Remove a single video from the LMS (its quiz + progress cascade; assignments
// pointing at it are dropped). The SharePoint source file is left untouched —
// re-running Sync would re-import it unless it's also removed from SharePoint.
async function deleteVideoAction(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) return;
  const id = String(formData.get("id"));
  if (!id) return;
  await prisma.assignment.deleteMany({ where: { videoId: id } });
  await prisma.video.delete({ where: { id } }).catch(() => {});
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

// Remove a whole module ("folder") and every video/quiz under it. Same
// SharePoint caveat as above.
async function deleteModuleAction(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) return;
  const id = String(formData.get("id"));
  if (!id) return;
  const vids = await prisma.video.findMany({
    where: { moduleId: id },
    select: { id: true },
  });
  await prisma.assignment.deleteMany({
    where: { OR: [{ moduleId: id }, { videoId: { in: vids.map((v) => v.id) } }] },
  });
  await prisma.module.delete({ where: { id } }).catch(() => {});
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

// Move a video up/down within its module. Normalises all sibling orders to a
// clean 0..n sequence (they may all be 0 from sync) and swaps with the neighbor.
async function moveVideoAction(formData: FormData): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) return;
  const id = String(formData.get("id"));
  const dir = String(formData.get("dir"));
  const v = await prisma.video.findUnique({
    where: { id },
    select: { moduleId: true },
  });
  if (!v) return;
  const sibs = await prisma.video.findMany({
    where: { moduleId: v.moduleId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const ids = sibs.map((s) => s.id);
  const idx = ids.indexOf(id);
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= ids.length) return;
  [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
  await prisma.$transaction(
    ids.map((vid, i) => prisma.video.update({ where: { id: vid }, data: { order: i } }))
  );
  revalidatePath("/admin");
  revalidatePath("/dashboard");
}

async function syncUsersAction(): Promise<void> {
  "use server";
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) return;
  const cookieStore = await cookies();
  try {
    const r = await syncOrgUsers({ fallbackUserId: session.user.id });
    const parts = [
      `${r.total} active in M365`,
      r.added ? `${r.added} added` : null,
      r.updated ? `${r.updated} updated` : null,
      r.reactivated ? `${r.reactivated} reactivated` : null,
      r.deactivated ? `${r.deactivated} deactivated` : null,
    ].filter(Boolean);
    cookieStore.set("admin_flash", `users:ok:${parts.join(", ")}`, {
      maxAge: 10,
      httpOnly: false,
    });
  } catch (e) {
    cookieStore.set(
      "admin_flash",
      `users:error:${(e as Error).message.slice(0, 240)}`,
      { maxAge: 10, httpOnly: false }
    );
  }
  revalidatePath("/admin");
  revalidatePath("/admin/assignments");
}

export default async function AdminOverview({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const tab = sp.tab;

  const cookieStore = await cookies();
  const flash = cookieStore.get("admin_flash")?.value ?? null;

  const [modules, userCount, assignmentCount, pendingAssignments, pendingApprovals] =
    await Promise.all([
      prisma.module.findMany({
        include: {
          course: true,
          videos: {
            orderBy: { order: "asc" },
            include: {
              quiz: { include: { _count: { select: { questions: true } } } },
            },
          },
        },
        orderBy: [{ courseId: "asc" }, { order: "asc" }],
      }),
      prisma.user.count({ where: { active: true } }),
      prisma.assignment.count(),
      prisma.assignment.count({ where: { status: "PENDING" } }),
      Promise.all([
        prisma.quest.count({ where: { status: "PENDING_APPROVAL" } }),
        prisma.initiative.count({ where: { status: "PITCHED" } }),
      ]).then(([q, i]) => q + i),
    ]);

  const totalVideos = modules.reduce((s, m) => s + m.videos.length, 0);
  const totalQuizzes = modules.reduce(
    (s, m) => s + m.videos.filter((v) => v.quiz).length,
    0
  );
  const totalQuestions = modules.reduce(
    (s, m) =>
      s + m.videos.reduce((vs, v) => vs + (v.quiz?._count.questions ?? 0), 0),
    0
  );

  return (
    <main className="px-6 py-8 max-w-6xl">
      <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1.5">
            {tab === "videos" ? "Content library" : "Welcome back"}
          </p>
          <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">
            {tab === "videos" ? "Videos & Quizzes" : "Overview"}
          </h1>
          <p className="text-ink-mute mt-1 text-sm">
            {tab === "videos"
              ? "Manage the videos pulled from SharePoint and the quiz attached to each."
              : "What's happening across your learning portal."}
          </p>
        </div>
      </div>

      {flash && <FlashBanner flash={flash} />}

      {!tab && (
        <>
          {/* Stat tiles */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <StatTile
              icon={Users}
              label="Active users"
              value={userCount}
              tint="brand"
              href="/admin/assignments"
            />
            <StatTile
              icon={Layers}
              label="Modules"
              value={modules.length}
              tint="violet"
              href="/admin/courses"
            />
            <StatTile
              icon={Video}
              label="Videos"
              value={totalVideos}
              sub={`${totalQuizzes} with quizzes`}
              tint="sky"
              href="/admin?tab=videos"
            />
            <StatTile
              icon={CheckCircle2}
              label="Pending approvals"
              value={pendingApprovals}
              sub={`${pendingAssignments} pending tasks · ${assignmentCount} total`}
              tint="gold"
              href="/admin/approvals"
            />
          </div>

          {/* Sync cards */}
          <div className="grid sm:grid-cols-2 gap-4 mb-8">
            <SyncCard
              icon={Video}
              title="Sync videos"
              description={
                <>
                  Pull the latest videos from{" "}
                  <code className="text-ink font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded">
                    L&D
                  </code>{" "}
                  on SharePoint. Each subfolder becomes a module.
                </>
              }
              action={syncAction}
              actionLabel="Sync videos"
              tint="brand"
            />
            <SyncCard
              icon={Users}
              title="Sync users from M365"
              description="Imports every active user in the SRCA tenant so you can assign work to them — even if they haven't signed in yet."
              action={syncUsersAction}
              actionLabel="Sync users"
              tint="violet"
            />
          </div>

          {/* Quick actions */}
          <div>
            <h2 className="font-display text-sm uppercase tracking-wider font-semibold text-ink-faint mb-3">
              Quick actions
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <QuickLink
                icon={Building2}
                href="/admin/branches"
                title="Branches"
                sub="Cities, codes, scores"
                tint="sky"
              />
              <QuickLink
                icon={Sparkles}
                href="/admin/trajectory"
                title="Trajectory framework"
                sub="Tracks, weights, tiers"
                tint="violet"
              />
              <QuickLink
                icon={Target}
                href="/admin/assignments"
                title="Create assignment"
                sub="Assign videos or tasks"
                tint="violet"
              />
              <QuickLink
                icon={CalendarClock}
                href="/admin/courses"
                title="Set deadlines"
                sub="Monthly / quarterly / yearly"
                tint="rose"
              />
              <QuickLink
                icon={BarChart3}
                href="/admin/kra"
                title="KRA report"
                sub="Export for appraisals"
                tint="sky"
              />
              <QuickLink
                icon={HelpCircle}
                href="/admin?tab=videos"
                title="Manage quizzes"
                sub={`${totalQuestions} questions`}
                tint="gold"
              />
            </div>
          </div>
        </>
      )}

      {tab === "videos" && (
        <VideosTab modules={modules} totalVideos={totalVideos} totalQuizzes={totalQuizzes} />
      )}
    </main>
  );
}

function VideosTab({
  modules,
  totalVideos,
  totalQuizzes,
}: {
  modules: Awaited<ReturnType<typeof loadModules>>;
  totalVideos: number;
  totalQuizzes: number;
}) {
  return (
    <>
      <div className="rounded-2xl bg-white border border-border p-5 mb-6 shadow-soft">
        <p className="text-sm text-ink-mute">
          {totalVideos} videos imported across {modules.filter((m) => m.videos.length > 0).length} module
          {modules.filter((m) => m.videos.length > 0).length === 1 ? "" : "s"}.{" "}
          {totalQuizzes} of them have a quiz attached.{" "}
          <strong className="text-ink">Click "Add quiz"</strong> on any video to create
          its MCQ quiz, or <strong className="text-ink">"Edit quiz"</strong> to update
          an existing one.
        </p>
      </div>

      {modules.length === 0 && (
        <div className="rounded-2xl bg-white border border-dashed border-border p-12 text-center shadow-soft">
          <Video className="w-12 h-12 text-ink-faint mx-auto mb-3" />
          <p className="text-ink-mute">
            No videos yet. Go back to Overview and click <strong>Sync videos</strong>.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {(() => {
          const withVideos = modules.filter((m) => m.videos.length > 0);
          const ungrouped = withVideos.filter((m) => !m.groupName);
          const groupNames = Array.from(
            new Set(withVideos.filter((m) => m.groupName).map((m) => m.groupName as string))
          ).sort((a, b) => a.localeCompare(b));
          return (
            <>
              {ungrouped.length > 0 && (
                <div className="space-y-5">
                  {ungrouped.map((m) => (
                    <ModuleCard key={m.id} m={m} />
                  ))}
                </div>
              )}
              {groupNames.map((g) => {
                const mods = withVideos.filter((m) => m.groupName === g);
                return (
                  <div key={g}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <Folder className="w-4 h-4 text-brand-500" />
                      <h3 className="font-display font-bold">{g}</h3>
                      <span className="text-xs text-ink-faint">
                        {mods.length} folder{mods.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="ml-1.5 pl-4 border-l-2 border-brand-100 space-y-3">
                      {mods.map((m) => (
                        <ModuleCard key={m.id} m={m} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </>
          );
        })()}
      </div>
    </>
  );
}

type ModuleRow = Awaited<ReturnType<typeof loadModules>>[number];

function ModuleCard({ m }: { m: ModuleRow }) {
  return (
    <details
      className="rounded-2xl bg-white border border-border overflow-hidden shadow-soft group"
    >
      <summary className="px-5 py-4 bg-muted/40 flex items-center justify-between gap-3 cursor-pointer list-none select-none hover:bg-muted/60 transition [&::-webkit-details-marker]:hidden">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">
            {m.course.title}
          </p>
          <h3 className="font-display font-bold mt-0.5">{m.title}</h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-xs text-ink-mute text-right">
            <span className="font-semibold text-ink">{m.videos.length}</span>{" "}
            videos ·{" "}
            <span className="font-semibold text-ink">
              {m.videos.filter((v) => v.quiz).length}
            </span>{" "}
            with quizzes
          </div>
          <form action={deleteModuleAction}>
            <input type="hidden" name="id" value={m.id} />
            <ConfirmButton
              message={`Delete the folder "${m.title}" and all ${m.videos.length} of its videos + quizzes? This can't be undone.`}
              title="Delete this folder and its videos"
              className="p-1.5 rounded-lg text-ink-faint hover:text-rose-600 hover:bg-rose-50 transition"
            >
              <Trash2 className="w-4 h-4" />
            </ConfirmButton>
          </form>
          <ChevronDown className="w-4 h-4 text-ink-faint transition group-open:rotate-180" />
        </div>
      </summary>
      <div className="divide-y divide-border border-t border-border">
        {m.videos.map((v, i) => {
          const qCount = v.quiz?._count.questions ?? 0;
          const hasQuiz = !!v.quiz;
          return (
            <div
              key={v.id}
              className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-muted/30 transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex flex-col">
                  <form action={moveVideoAction}>
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="dir" value="up" />
                    <button
                      disabled={i === 0}
                      className="p-0.5 rounded text-ink-faint hover:text-brand-600 hover:bg-muted disabled:opacity-25 disabled:pointer-events-none transition"
                      title="Move up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                  </form>
                  <form action={moveVideoAction}>
                    <input type="hidden" name="id" value={v.id} />
                    <input type="hidden" name="dir" value="down" />
                    <button
                      disabled={i === m.videos.length - 1}
                      className="p-0.5 rounded text-ink-faint hover:text-brand-600 hover:bg-muted disabled:opacity-25 disabled:pointer-events-none transition"
                      title="Move down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </form>
                </div>
                <span className="text-xs text-ink-faint tabular-nums w-6 text-right font-mono">
                  {i + 1}.
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {prettifyName(v.title)}
                  </p>
                  <p className="text-xs text-ink-mute mt-0.5">
                    {hasQuiz ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 inline text-emerald-600 mr-1" />
                        {qCount} question{qCount === 1 ? "" : "s"}
                      </>
                    ) : (
                      <span className="text-ink-faint">No quiz yet</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/admin/video/${v.id}`}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${
                    hasQuiz
                      ? "bg-muted hover:bg-border text-ink"
                      : "bg-brand-500 hover:bg-brand-600 text-white shadow-pop"
                  }`}
                >
                  {hasQuiz ? "Edit quiz" : "Add quiz"}
                </Link>
                <form action={deleteVideoAction}>
                  <input type="hidden" name="id" value={v.id} />
                  <ConfirmButton
                    message={`Remove the video "${prettifyName(v.title)}"${hasQuiz ? " and its quiz" : ""}? This can't be undone.`}
                    title="Remove this video"
                    className="p-1.5 rounded-lg text-ink-faint hover:text-rose-600 hover:bg-rose-50 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </ConfirmButton>
                </form>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

async function loadModules() {
  return prisma.module.findMany({
    include: {
      course: true,
      videos: {
        orderBy: { order: "asc" },
        include: {
          quiz: { include: { _count: { select: { questions: true } } } },
        },
      },
    },
    orderBy: [{ courseId: "asc" }, { order: "asc" }],
  });
}

function FlashBanner({ flash }: { flash: string }) {
  const [topic, level, ...rest] = flash.split(":");
  const message = rest.join(":");
  const isError = level === "error";
  const label = topic === "videos" ? "Video sync" : "User sync";

  return (
    <div
      className={`mb-6 rounded-xl p-4 border shadow-soft flex items-start gap-3 ${
        isError
          ? "bg-rose-50 border-rose-200"
          : "bg-emerald-50 border-emerald-200"
      }`}
    >
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
          isError ? "bg-rose-100 text-rose-600" : "bg-emerald-100 text-emerald-600"
        }`}
      >
        {isError ? (
          <AlertCircle className="w-5 h-5" />
        ) : (
          <CheckCircle2 className="w-5 h-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {label} {isError ? "failed" : "succeeded"}
        </p>
        {isError ? (
          <>
            <p className="text-sm text-ink-mute mt-1 font-mono break-all">
              {message || "Unknown error"}
            </p>
            {topic === "users" &&
              /403|Forbidden|Authorization_RequestDenied/i.test(message) && (
                <div className="mt-3 text-xs text-ink-soft space-y-1">
                  <p className="font-semibold">Likely fix:</p>
                  <ol className="list-decimal list-inside space-y-0.5 text-ink-mute">
                    <li>Entra → App registrations → Indefine LMS → API permissions</li>
                    <li>+ Add a permission → Microsoft Graph → Application permissions</li>
                    <li>
                      Tick <code className="font-mono">User.Read.All</code> → Add permissions
                    </li>
                    <li>
                      Click <strong>Grant admin consent for SRCA</strong>
                    </li>
                    <li>Wait ~30 seconds, then click Sync users again</li>
                  </ol>
                </div>
              )}
          </>
        ) : (
          <p className="text-sm text-ink-mute mt-1">{message}</p>
        )}
      </div>
    </div>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  sub,
  tint,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
  sub?: string;
  tint: "brand" | "violet" | "sky" | "gold";
  href: string;
}) {
  const tints = {
    brand: "bg-brand-50 text-brand-600",
    violet: "bg-violet-50 text-violet-600",
    sky: "bg-sky-50 text-sky-600",
    gold: "bg-amber-50 text-amber-600",
  };
  return (
    <Link
      href={href}
      className="rounded-2xl bg-white border border-border p-4 hover:border-brand-200 hover:shadow-lift shadow-soft transition group"
    >
      <div
        className={`w-9 h-9 rounded-lg ${tints[tint]} flex items-center justify-center mb-3`}
      >
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint">
        {label}
      </p>
      <p className="font-display text-2xl font-extrabold mt-0.5">{value}</p>
      {sub && <p className="text-xs text-ink-mute mt-0.5">{sub}</p>}
    </Link>
  );
}

function SyncCard({
  icon: Icon,
  title,
  description,
  action,
  actionLabel,
  tint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: React.ReactNode;
  action: () => Promise<void>;
  actionLabel: string;
  tint: "brand" | "violet";
}) {
  const tints = {
    brand: "bg-brand-50 text-brand-600",
    violet: "bg-violet-50 text-violet-600",
  };
  return (
    <section className="rounded-2xl bg-white border border-border p-5 shadow-soft">
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`w-10 h-10 rounded-xl ${tints[tint]} flex items-center justify-center shrink-0`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-display font-bold">{title}</h2>
          <p className="text-ink-mute text-xs mt-0.5 leading-relaxed">{description}</p>
        </div>
      </div>
      <form action={action}>
        <button className="text-sm px-4 py-2 rounded-lg bg-ink hover:bg-ink-soft text-white font-medium inline-flex items-center gap-2 transition">
          <RefreshCw className="w-3.5 h-3.5" />
          {actionLabel}
        </button>
      </form>
    </section>
  );
}

function QuickLink({
  icon: Icon,
  href,
  title,
  sub,
  tint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  title: string;
  sub: string;
  tint: "violet" | "rose" | "sky" | "gold";
}) {
  const tints = {
    violet: "bg-violet-50 text-violet-600",
    rose: "bg-rose-50 text-rose-600",
    sky: "bg-sky-50 text-sky-600",
    gold: "bg-amber-50 text-amber-600",
  };
  return (
    <Link
      href={href}
      className="rounded-xl bg-white border border-border p-4 hover:border-brand-200 hover:shadow-lift shadow-soft transition flex items-center gap-3 group"
    >
      <div
        className={`w-10 h-10 rounded-lg ${tints[tint]} flex items-center justify-center shrink-0`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-ink-mute mt-0.5 truncate">{sub}</p>
      </div>
      <ArrowRight className="w-4 h-4 text-ink-faint group-hover:text-brand-500 group-hover:translate-x-0.5 transition" />
    </Link>
  );
}

function prettifyName(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
