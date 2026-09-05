import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  currentWeekStart,
  previousWeekStart,
  weekLabel,
} from "@/lib/checkins";
import {
  MessageCircle,
  Lightbulb,
  AlertCircle,
  Compass,
  MessageSquareReply,
  Send,
} from "lucide-react";
import { isAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

async function reply(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) return;
  const id = String(formData.get("id"));
  const text = String(formData.get("reply") || "").trim();
  await prisma.weeklyCheckin.update({
    where: { id },
    data: { managerReply: text || null },
  });
  revalidatePath("/admin/checkins");
}

export default async function AdminCheckinsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const week = sp.week === "previous" ? previousWeekStart() : currentWeekStart();
  const isCurrent = sp.week !== "previous";

  const [checkins, activeUsersList] = await Promise.all([
    prisma.weeklyCheckin.findMany({
      where: { weekStart: week },
      include: { user: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const activeUsers = activeUsersList.length;
  const submittedUserIds = new Set(checkins.map((c) => c.userId));
  const pendingUsers = activeUsersList.filter((u) => !submittedUserIds.has(u.id));
  const missing = pendingUsers.length;
  const blockedCount = checkins.filter(
    (c) => c.whatBlocked && c.whatBlocked.trim().length > 0
  ).length;

  return (
    <main className="px-6 py-8 max-w-5xl">
      <div className="mb-8 flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1.5">
            Admin · Check-ins
          </p>
          <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">
            Weekly check-ins
          </h1>
          <p className="text-ink-mute mt-1 text-sm">
            What your team is reflecting on. Use replies to coach — not to
            grade. {weekLabel(week)}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={isCurrent ? "/admin/checkins?week=previous" : "/admin/checkins"}
            className="text-sm px-3 py-1.5 rounded-lg bg-white hover:bg-muted border border-border shadow-soft transition"
          >
            {isCurrent ? "← Last week" : "This week →"}
          </a>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        <Stat
          icon={MessageCircle}
          tint="brand"
          label="Submitted"
          value={`${checkins.length} / ${activeUsers}`}
          sub={`${missing} pending`}
        />
        <Stat
          icon={AlertCircle}
          tint="rose"
          label="People blocked"
          value={blockedCount}
          sub="have something flagged"
        />
        <Stat
          icon={MessageSquareReply}
          tint="emerald"
          label="Replied to"
          value={checkins.filter((c) => c.managerReply).length}
          sub="of submitted"
        />
      </div>

      {/* List */}
      {checkins.length === 0 ? (
        <div className="rounded-2xl bg-white border border-dashed border-border p-12 text-center shadow-soft">
          <p className="text-ink-mute">No check-ins for this week yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {checkins.map((c) => (
            <article
              key={c.id}
              className="rounded-2xl bg-white border border-border shadow-soft p-5"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-accent-violet text-white flex items-center justify-center text-sm font-bold">
                  {(c.user.name ?? c.user.email).slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold truncate">
                    {c.user.name ?? c.user.email}
                  </p>
                  <p className="text-xs text-ink-faint">
                    Submitted {timeAgo(c.createdAt)}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {c.whatWorked && (
                  <Row icon={Lightbulb} tint="emerald" label="Worked" text={c.whatWorked} />
                )}
                {c.whatBlocked && (
                  <Row icon={AlertCircle} tint="rose" label="Blocked" text={c.whatBlocked} />
                )}
                {c.nextFocus && (
                  <Row icon={Compass} tint="violet" label="Next focus" text={c.nextFocus} />
                )}
              </div>

              {/* Reply form */}
              <form action={reply} className="mt-4 pt-4 border-t border-border">
                <input type="hidden" name="id" value={c.id} />
                <label className="text-[10px] uppercase tracking-wider font-bold text-ink-faint">
                  Your reply (visible to {c.user.name?.split(" ")[0] ?? "them"})
                </label>
                <div className="flex items-start gap-2 mt-1">
                  <textarea
                    name="reply"
                    defaultValue={c.managerReply ?? ""}
                    placeholder="Coach, encourage, ask a follow-up..."
                    rows={2}
                    className="flex-1 bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:bg-white focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
                  />
                  <button className="px-3 py-2 rounded-lg bg-brand-500 hover:bg-brand-600 text-white shadow-pop inline-flex items-center gap-1.5 text-sm font-medium transition">
                    <Send className="w-3.5 h-3.5" />
                    Reply
                  </button>
                </div>
              </form>
            </article>
          ))}
        </div>
      )}

      {/* Who hasn't submitted yet */}
      {pendingUsers.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-sm uppercase tracking-wider font-semibold text-ink-faint mb-3">
            Not submitted yet ({pendingUsers.length})
          </h2>
          <div className="rounded-2xl bg-white border border-border shadow-soft p-4 flex flex-wrap gap-2">
            {pendingUsers.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-2 rounded-full bg-muted/60 border border-border px-3 py-1.5 text-xs font-semibold text-ink-soft"
                title={u.email}
              >
                <span className="w-5 h-5 rounded-full bg-brand-50 text-brand-600 grid place-items-center text-[10px] font-bold">
                  {(u.name ?? u.email).slice(0, 1).toUpperCase()}
                </span>
                {u.name ?? u.email}
              </span>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-2">
            Employees see the check-in nudge on their dashboard from Wednesday,
            and can submit anytime from the Check-in tab in their top nav.
          </p>
        </section>
      )}
    </main>
  );
}

function Stat({
  icon: Icon,
  tint,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: "brand" | "rose" | "emerald";
  label: string;
  value: number | string;
  sub: string;
}) {
  const tints = {
    brand: "bg-brand-50 text-brand-600",
    rose: "bg-rose-50 text-rose-600",
    emerald: "bg-emerald-50 text-emerald-600",
  };
  return (
    <div className="rounded-2xl bg-white border border-border shadow-soft p-4">
      <div className={`w-9 h-9 rounded-lg ${tints[tint]} flex items-center justify-center mb-3`}>
        <Icon className="w-4 h-4" />
      </div>
      <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint">{label}</p>
      <p className="font-display text-2xl font-extrabold mt-0.5">{value}</p>
      <p className="text-xs text-ink-mute mt-0.5">{sub}</p>
    </div>
  );
}

function Row({
  icon: Icon,
  tint,
  label,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: "emerald" | "rose" | "violet";
  label: string;
  text: string;
}) {
  const tints = {
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    violet: "bg-violet-50 text-violet-600",
  };
  return (
    <div className="flex items-start gap-3">
      <div className={`w-7 h-7 rounded-lg ${tints[tint]} flex items-center justify-center shrink-0`}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider font-bold text-ink-faint">{label}</p>
        <p className="text-sm text-ink-soft mt-0.5">{text}</p>
      </div>
    </div>
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
  return `${days}d ago`;
}
