import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Info } from "lucide-react";
import { ApprovalsBoard } from "@/components/ApprovalsBoard";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (session.user.role !== "ADMIN") redirect("/dashboard");

  // Approvals route to each employee's direct manager. As an admin you see
  // your own reports plus anyone who has no manager assigned (the fallback).
  const scope = { OR: [{ managerId: session.user.id }, { managerId: null }] };

  const [pendingQuests, pitchedInitiatives] = await Promise.all([
    prisma.quest.findMany({
      where: { status: "PENDING_APPROVAL", user: scope },
      include: {
        user: true,
        cycle: true,
        milestones: { orderBy: { quarter: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.initiative.findMany({
      where: { status: "PITCHED", user: scope },
      include: { user: true, cycle: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <main className="px-6 py-8 max-w-5xl">
      <div className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral mb-1.5">
          Admin · Approvals
        </p>
        <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">
          Approvals
        </h1>
        <p className="text-ink-mute mt-1 text-sm">
          Quests and initiatives waiting on you. Approving a quest activates
          progress tracking for that employee. Funding an initiative makes it
          public on the Initiatives Board.
        </p>
      </div>

      <div className="mb-6 rounded-xl bg-muted/50 border border-border p-3 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-ink-faint shrink-0 mt-0.5" />
        <p className="text-xs text-ink-mute leading-relaxed">
          Approvals go to each employee&apos;s <strong className="text-ink">direct manager</strong>{" "}
          (set in Team &amp; hierarchy). You&apos;re seeing your own reports plus anyone
          without a manager. Managers approve their team from{" "}
          <strong className="text-ink">My team → Approvals</strong>.
        </p>
      </div>

      <ApprovalsBoard quests={pendingQuests} initiatives={pitchedInitiatives} />
    </main>
  );
}
