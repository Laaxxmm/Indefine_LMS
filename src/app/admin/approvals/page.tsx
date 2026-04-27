import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  Check,
  X,
  Sparkles,
  Target,
  Rocket,
  CircleDollarSign,
} from "lucide-react";

export const dynamic = "force-dynamic";

async function approveQuest(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return;
  const id = String(formData.get("id"));
  await prisma.quest.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedById: session.user.id,
      approvedAt: new Date(),
    },
  });
  revalidatePath("/admin/approvals");
  revalidatePath("/dashboard");
}

async function rejectQuest(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return;
  const id = String(formData.get("id"));
  await prisma.quest.update({
    where: { id },
    data: { status: "DRAFT" },
  });
  revalidatePath("/admin/approvals");
}

async function fundInitiative(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return;
  const id = String(formData.get("id"));
  await prisma.initiative.update({
    where: { id },
    data: {
      status: "FUNDED",
      fundedById: session.user.id,
      fundedAt: new Date(),
    },
  });
  revalidatePath("/admin/approvals");
  revalidatePath("/dashboard");
}

async function archiveInitiative(formData: FormData) {
  "use server";
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return;
  const id = String(formData.get("id"));
  await prisma.initiative.update({
    where: { id },
    data: { status: "ARCHIVED" },
  });
  revalidatePath("/admin/approvals");
}

export default async function ApprovalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  const [pendingQuests, pitchedInitiatives] = await Promise.all([
    prisma.quest.findMany({
      where: { status: "PENDING_APPROVAL" },
      include: {
        user: true,
        cycle: true,
        milestones: { orderBy: { quarter: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.initiative.findMany({
      where: { status: "PITCHED" },
      include: { user: true, cycle: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <main className="px-6 py-8 max-w-5xl">
      <div className="mb-8">
        <p className="text-xs uppercase tracking-wider font-semibold text-ink-faint mb-1">
          Admin · Approvals
        </p>
        <h1 className="font-display text-3xl font-bold tracking-tight">
          Approvals
        </h1>
        <p className="text-ink-mute mt-1 text-sm">
          Quests and initiatives waiting on you. Approving a quest activates
          progress tracking for that employee. Funding an initiative makes it
          public on the Initiatives Board.
        </p>
      </div>

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-emerald-600" />
          <h2 className="font-display font-bold">
            Pending quests{" "}
            <span className="text-ink-faint font-normal text-sm">
              ({pendingQuests.length})
            </span>
          </h2>
        </div>
        {pendingQuests.length === 0 ? (
          <div className="rounded-2xl bg-white border border-dashed border-border p-8 text-center text-ink-mute text-sm shadow-soft">
            <Sparkles className="w-8 h-8 mx-auto mb-2 text-ink-faint" />
            All caught up — no quests need approval.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingQuests.map((q) => (
              <div
                key={q.id}
                className="rounded-2xl bg-white border border-border shadow-soft p-5"
              >
                <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
                  <div>
                    <p className="text-xs uppercase tracking-wider font-bold text-ink-faint">
                      {q.user.name ?? q.user.email} · {q.cycle.name}
                    </p>
                    <h3 className="font-display font-bold text-lg mt-0.5">
                      {q.title}
                    </h3>
                    {q.why && (
                      <p className="text-xs text-ink-mute italic mt-1">
                        Because: {q.why}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <form action={rejectQuest}>
                      <input type="hidden" name="id" value={q.id} />
                      <button className="text-xs px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft inline-flex items-center gap-1.5 text-ink-mute transition">
                        <X className="w-3.5 h-3.5" />
                        Send back
                      </button>
                    </form>
                    <form action={approveQuest}>
                      <input type="hidden" name="id" value={q.id} />
                      <button className="text-xs px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium inline-flex items-center gap-1.5 shadow-pop transition">
                        <Check className="w-3.5 h-3.5" />
                        Approve
                      </button>
                    </form>
                  </div>
                </div>
                {q.milestones.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5 pt-3 border-t border-border">
                    {q.milestones.map((m) => (
                      <div
                        key={m.id}
                        className="text-xs flex items-center gap-1.5"
                      >
                        <span className="w-5 h-5 rounded bg-emerald-50 text-emerald-700 font-bold flex items-center justify-center text-[10px]">
                          Q{m.quarter}
                        </span>
                        <span className="text-ink-soft truncate">{m.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <Rocket className="w-4 h-4 text-rose-600" />
          <h2 className="font-display font-bold">
            Initiatives waiting for funding{" "}
            <span className="text-ink-faint font-normal text-sm">
              ({pitchedInitiatives.length})
            </span>
          </h2>
        </div>
        {pitchedInitiatives.length === 0 ? (
          <div className="rounded-2xl bg-white border border-dashed border-border p-8 text-center text-ink-mute text-sm shadow-soft">
            No new initiatives pitched.
          </div>
        ) : (
          <div className="space-y-3">
            {pitchedInitiatives.map((i) => (
              <div
                key={i.id}
                className="rounded-2xl bg-white border border-border shadow-soft p-5"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-wider font-bold text-ink-faint">
                      {i.user.name ?? i.user.email} · {i.cycle.name}
                    </p>
                    <h3 className="font-display font-bold text-lg mt-0.5">
                      {i.title}
                    </h3>
                    {i.description && (
                      <p className="text-sm text-ink-soft mt-1">
                        {i.description}
                      </p>
                    )}
                    {i.impact && (
                      <p className="text-xs text-ink-mute italic mt-2">
                        Impact: {i.impact}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <form action={archiveInitiative}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="text-xs px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft inline-flex items-center gap-1.5 text-ink-mute transition">
                        <X className="w-3.5 h-3.5" />
                        Archive
                      </button>
                    </form>
                    <form action={fundInitiative}>
                      <input type="hidden" name="id" value={i.id} />
                      <button className="text-xs px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-600 text-white font-medium inline-flex items-center gap-1.5 shadow-pop transition">
                        <CircleDollarSign className="w-3.5 h-3.5" />
                        Fund it
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
