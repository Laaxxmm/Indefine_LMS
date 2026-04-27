import { auth, signOut } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCycle } from "@/lib/trajectory";
import { revalidatePath } from "next/cache";
import {
  Rocket,
  ArrowLeft,
  LogOut,
  Plus,
  PartyPopper,
  Sparkles,
  CircleCheck,
  Hand,
} from "lucide-react";

export const dynamic = "force-dynamic";

async function toggleReaction(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const initiativeId = String(formData.get("initiativeId"));
  const kind = String(formData.get("kind") || "UPVOTE") as
    | "UPVOTE"
    | "INTERESTED";

  const existing = await prisma.initiativeReaction.findUnique({
    where: {
      initiativeId_userId_kind: {
        initiativeId,
        userId: session.user.id,
        kind,
      },
    },
  });

  if (existing) {
    await prisma.initiativeReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.initiativeReaction.create({
      data: { initiativeId, userId: session.user.id, kind },
    });
  }

  // Recompute the upvote cache on the initiative
  if (kind === "UPVOTE") {
    const upvotes = await prisma.initiativeReaction.count({
      where: { initiativeId, kind: "UPVOTE" },
    });
    await prisma.initiative.update({
      where: { id: initiativeId },
      data: { upvotes },
    });
  }
  revalidatePath("/initiatives");
}

async function pitchInitiative(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const cycle = await ensureDefaultCycle();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const impact = String(formData.get("impact") || "").trim();
  if (!title) return;

  await prisma.initiative.create({
    data: {
      userId: session.user.id,
      cycleId: cycle.id,
      title,
      description: description || null,
      impact: impact || null,
      status: "PITCHED",
    },
  });
  revalidatePath("/initiatives");
}

async function setStatus(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const id = String(formData.get("id"));
  const next = String(formData.get("status")) as
    | "ACTIVE"
    | "SHIPPED"
    | "ARCHIVED";
  const owner = await prisma.initiative.findUnique({
    where: { id },
    select: { userId: true, status: true },
  });
  if (!owner) return;
  // Only the owner can transition; admin uses /admin/approvals.
  if (owner.userId !== session.user.id) return;

  await prisma.initiative.update({
    where: { id },
    data: {
      status: next,
      shippedAt: next === "SHIPPED" ? new Date() : undefined,
    },
  });
  revalidatePath("/initiatives");
}

const STATUS_META: Record<
  string,
  { label: string; bg: string; fg: string; emoji: string }
> = {
  PITCHED: {
    label: "Pitched",
    bg: "bg-amber-50 border-amber-200",
    fg: "text-amber-700",
    emoji: "💡",
  },
  FUNDED: {
    label: "Funded",
    bg: "bg-brand-50 border-brand-200",
    fg: "text-brand-700",
    emoji: "💰",
  },
  ACTIVE: {
    label: "In progress",
    bg: "bg-violet-50 border-violet-200",
    fg: "text-violet-700",
    emoji: "🚧",
  },
  SHIPPED: {
    label: "Shipped",
    bg: "bg-emerald-50 border-emerald-200",
    fg: "text-emerald-700",
    emoji: "🚀",
  },
  ARCHIVED: {
    label: "Archived",
    bg: "bg-muted border-border",
    fg: "text-ink-mute",
    emoji: "📁",
  },
};

export default async function InitiativesBoard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const userId = session.user.id;
  const sp = await searchParams;
  const filter = sp.filter ?? "all";

  const cycle = await ensureDefaultCycle();

  const where: {
    cycleId: string;
    userId?: string;
    status?: { in: ("PITCHED" | "FUNDED" | "ACTIVE" | "SHIPPED" | "ARCHIVED")[] };
  } = { cycleId: cycle.id };
  if (filter === "mine") where.userId = userId;
  if (filter === "shipped") where.status = { in: ["SHIPPED"] };
  if (filter === "funded") where.status = { in: ["FUNDED", "ACTIVE"] };
  if (filter === "pitched") where.status = { in: ["PITCHED"] };

  const initiatives = await prisma.initiative.findMany({
    where,
    include: {
      user: true,
      reactions: { include: { user: true } },
    },
    orderBy: [{ status: "asc" }, { upvotes: "desc" }, { createdAt: "desc" }],
  });

  const counts = await prisma.initiative.groupBy({
    by: ["status"],
    where: { cycleId: cycle.id },
    _count: true,
  });
  const countByStatus = Object.fromEntries(
    counts.map((c) => [c.status, c._count])
  );
  const totals = {
    all: counts.reduce((s, c) => s + c._count, 0),
    pitched: countByStatus.PITCHED ?? 0,
    funded: (countByStatus.FUNDED ?? 0) + (countByStatus.ACTIVE ?? 0),
    shipped: countByStatus.SHIPPED ?? 0,
    mine: await prisma.initiative.count({
      where: { cycleId: cycle.id, userId },
    }),
  };

  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-6xl mx-auto">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 mb-8 flex-wrap">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="w-10 h-10 rounded-xl bg-white border border-border shadow-soft flex items-center justify-center hover:bg-muted transition"
            title="Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-ink-faint font-bold">
              Trajectory · {cycle.name}
            </p>
            <p className="font-display text-sm font-bold mt-0.5">
              Initiatives Board
            </p>
          </div>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button className="px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft text-sm flex items-center gap-2 transition">
            <LogOut className="w-4 h-4 text-ink-mute" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </form>
      </header>

      {/* Hero */}
      <section className="rounded-3xl bg-gradient-to-br from-rose-500 via-rose-400 to-amber-400 p-6 sm:p-8 mb-6 text-white relative overflow-hidden">
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative grid lg:grid-cols-[1fr_auto] gap-4 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/20 backdrop-blur text-xs font-bold mb-3">
              <Rocket className="w-3.5 h-3.5" />
              Bold ideas, shipped together
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-2">
              Initiatives Board
            </h1>
            <p className="text-white/90 max-w-xl">
              Pitch a bold idea, react to what your peers are working on, and
              push the firm forward together. Your initiatives feed into the
              Initiative track on your trajectory.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 lg:min-w-[260px]">
            <HeroStat label="Pitched" value={totals.pitched} />
            <HeroStat label="Funded" value={totals.funded} />
            <HeroStat label="Shipped" value={totals.shipped} />
          </div>
        </div>
      </section>

      {/* Pitch + filters */}
      <details className="rounded-2xl bg-white border border-border shadow-soft p-5 mb-6 group">
        <summary className="flex items-center justify-between cursor-pointer list-none">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-accent-violet flex items-center justify-center text-white">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <p className="font-display font-bold">Pitch a new initiative</p>
              <p className="text-xs text-ink-mute mt-0.5">
                Share a bold idea — peers can react, manager can fund it
              </p>
            </div>
          </div>
          <span className="text-xs text-ink-faint group-open:hidden">Click to expand</span>
          <span className="text-xs text-ink-faint hidden group-open:inline">Hide</span>
        </summary>
        <form action={pitchInitiative} className="mt-5 space-y-3">
          <input
            name="title"
            placeholder="Title — what's the idea?"
            required
            className="w-full bg-white border border-border rounded-lg px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
          />
          <textarea
            name="description"
            placeholder="A short description..."
            rows={2}
            className="w-full bg-white border border-border rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
          />
          <textarea
            name="impact"
            placeholder="What impact do you expect?"
            rows={2}
            className="w-full bg-white border border-border rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
          />
          <button className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-brand-500 to-accent-violet text-white font-semibold shadow-pop inline-flex items-center gap-2 hover:opacity-95 transition">
            <Rocket className="w-4 h-4" />
            Pitch it
          </button>
        </form>
      </details>

      {/* Filter pills */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
        <FilterPill href="/initiatives" label="All" count={totals.all} active={filter === "all"} />
        <FilterPill href="/initiatives?filter=pitched" label="Pitched" count={totals.pitched} active={filter === "pitched"} />
        <FilterPill href="/initiatives?filter=funded" label="Funded" count={totals.funded} active={filter === "funded"} />
        <FilterPill href="/initiatives?filter=shipped" label="Shipped" count={totals.shipped} active={filter === "shipped"} />
        <FilterPill href="/initiatives?filter=mine" label="Mine" count={totals.mine} active={filter === "mine"} />
      </div>

      {/* Cards grid */}
      {initiatives.length === 0 ? (
        <div className="rounded-2xl bg-white border border-dashed border-border p-12 text-center shadow-soft">
          <Sparkles className="w-12 h-12 text-ink-faint mx-auto mb-3" />
          <p className="font-display font-bold mb-1">No initiatives here yet</p>
          <p className="text-ink-mute text-sm">
            Be the first to pitch a bold idea.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {initiatives.map((i) => {
            const meta = STATUS_META[i.status];
            const isOwner = i.userId === userId;
            const myUpvote = i.reactions.some(
              (r) => r.userId === userId && r.kind === "UPVOTE"
            );
            const myInterest = i.reactions.some(
              (r) => r.userId === userId && r.kind === "INTERESTED"
            );
            const interestedCount = i.reactions.filter(
              (r) => r.kind === "INTERESTED"
            ).length;
            return (
              <article
                key={i.id}
                className="rounded-2xl bg-white border border-border shadow-soft p-5 flex flex-col"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-violet text-white flex items-center justify-center text-xs font-bold shrink-0">
                      {(i.user.name ?? i.user.email).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">
                        {i.user.name ?? i.user.email}
                      </p>
                      <p className="text-[10px] text-ink-faint">
                        {timeAgo(i.createdAt)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded-full border ${meta.bg} ${meta.fg} shrink-0`}
                  >
                    {meta.emoji} {meta.label}
                  </span>
                </div>

                <h3 className="font-display text-lg font-bold leading-tight mb-2">
                  {i.title}
                </h3>
                {i.description && (
                  <p className="text-sm text-ink-soft mb-3 line-clamp-3">
                    {i.description}
                  </p>
                )}
                {i.impact && (
                  <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 mb-3">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-amber-700 mb-0.5">
                      Expected impact
                    </p>
                    <p className="text-xs text-amber-900">{i.impact}</p>
                  </div>
                )}

                {/* Reactions */}
                <div className="mt-auto pt-3 border-t border-border flex items-center gap-2 flex-wrap">
                  <form action={toggleReaction}>
                    <input type="hidden" name="initiativeId" value={i.id} />
                    <input type="hidden" name="kind" value="UPVOTE" />
                    <button
                      type="submit"
                      className={`text-xs px-3 py-1.5 rounded-lg font-bold inline-flex items-center gap-1.5 transition ${
                        myUpvote
                          ? "bg-rose-500 text-white shadow-pop"
                          : "bg-white border border-border hover:border-rose-200 hover:bg-rose-50 text-ink-soft"
                      }`}
                    >
                      🚀 {i.upvotes}
                    </button>
                  </form>
                  <form action={toggleReaction}>
                    <input type="hidden" name="initiativeId" value={i.id} />
                    <input type="hidden" name="kind" value="INTERESTED" />
                    <button
                      type="submit"
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1.5 transition ${
                        myInterest
                          ? "bg-violet-500 text-white shadow-pop"
                          : "bg-white border border-border hover:border-violet-200 hover:bg-violet-50 text-ink-soft"
                      }`}
                    >
                      <Hand className="w-3.5 h-3.5" />
                      Count me in {interestedCount > 0 && `(${interestedCount})`}
                    </button>
                  </form>

                  {/* Owner controls */}
                  {isOwner && (
                    <div className="ml-auto flex items-center gap-1.5">
                      {i.status === "FUNDED" && (
                        <form action={setStatus}>
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="status" value="ACTIVE" />
                          <button
                            type="submit"
                            className="text-xs px-3 py-1.5 rounded-lg bg-violet-500 hover:bg-violet-600 text-white font-medium inline-flex items-center gap-1.5 transition"
                          >
                            🚧 Begin
                          </button>
                        </form>
                      )}
                      {i.status === "ACTIVE" && (
                        <form action={setStatus}>
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="status" value="SHIPPED" />
                          <button
                            type="submit"
                            className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-medium inline-flex items-center gap-1.5 transition"
                          >
                            <PartyPopper className="w-3.5 h-3.5" />
                            Mark shipped
                          </button>
                        </form>
                      )}
                      {i.status !== "ARCHIVED" && i.status !== "SHIPPED" && (
                        <form action={setStatus}>
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="status" value="ARCHIVED" />
                          <button
                            type="submit"
                            className="text-xs px-2 py-1.5 rounded-lg text-ink-faint hover:text-rose-600 transition"
                            title="Archive"
                          >
                            <CircleCheck className="w-3.5 h-3.5" />
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/15 backdrop-blur border border-white/20 p-3 text-center">
      <p className="font-display text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="text-[10px] uppercase tracking-wider font-bold text-white/80">
        {label}
      </p>
    </div>
  );
}

function FilterPill({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`text-sm px-4 py-2 rounded-full inline-flex items-center gap-2 shrink-0 transition ${
        active
          ? "bg-ink text-white shadow-pop"
          : "bg-white border border-border hover:bg-muted text-ink-soft"
      }`}
    >
      {label}
      <span
        className={`text-[10px] tabular-nums px-1.5 py-0.5 rounded-full ${
          active ? "bg-white/20" : "bg-muted text-ink-mute"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

