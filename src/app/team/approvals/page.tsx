// Manager-facing approvals — quests and initiatives pitched by YOUR direct
// reports. Accessible to anyone with reports (no admin role needed); admins
// additionally see employees who have no manager assigned.

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ArrowLeft } from "lucide-react";
import { ApprovalsBoard } from "@/components/ApprovalsBoard";
import { isAdmin } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function TeamApprovalsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const admin = isAdmin(session.user);

  const reportCount = await prisma.user.count({
    where: { managerId: session.user.id, active: true },
  });
  if (!admin && reportCount === 0) redirect("/dashboard");

  const scope = admin
    ? { OR: [{ managerId: session.user.id }, { managerId: null }] }
    : { managerId: session.user.id };

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
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <header className="flex items-center gap-3 mb-8">
        <Link
          href="/team"
          className="w-10 h-10 rounded-xl bg-white border border-border shadow-soft flex items-center justify-center hover:bg-muted transition"
          title="My team"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] font-extrabold text-accent-coral">
            My team · Approvals
          </p>
          <h1 className="font-display text-[28px] font-extrabold tracking-[-0.02em] leading-tight">
            Approvals
          </h1>
        </div>
      </header>

      <p className="text-ink-mute text-sm mb-6 -mt-4">
        Quests and initiatives from your direct reports. Approving a quest
        activates progress tracking; funding an initiative makes it public on
        the Initiatives Board.
      </p>

      <ApprovalsBoard quests={pendingQuests} initiatives={pitchedInitiatives} />
    </main>
  );
}
