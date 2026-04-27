import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCycle } from "@/lib/trajectory";
import WizardProgress from "../WizardProgress";
import QuestBuilder from "./QuestBuilder";
import { Target } from "lucide-react";

export const dynamic = "force-dynamic";

interface QuestPayload {
  id?: string;
  title: string;
  why: string;
  description: string;
  weight: number;
  milestones: { quarter: number; title: string }[];
}

async function saveQuests(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const cycle = await ensureDefaultCycle();
  const raw = String(formData.get("quests") || "[]");
  let parsed: QuestPayload[] = [];
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  // Wipe existing DRAFT/PENDING quests for this cycle and recreate from scratch.
  // APPROVED/ACTIVE/COMPLETED quests are preserved (they're already locked in).
  await prisma.quest.deleteMany({
    where: {
      userId: session.user.id,
      cycleId: cycle.id,
      status: { in: ["DRAFT", "PENDING_APPROVAL"] },
    },
  });

  for (const q of parsed.slice(0, 5)) {
    if (!q.title.trim()) continue;
    await prisma.quest.create({
      data: {
        userId: session.user.id,
        cycleId: cycle.id,
        title: q.title.trim(),
        why: q.why.trim() || null,
        description: q.description.trim() || null,
        weight: Math.max(1, Math.min(100, q.weight || 10)),
        status: "DRAFT",
        milestones: {
          create: q.milestones
            .filter((m) => m.title.trim())
            .map((m) => ({
              quarter: Math.max(1, Math.min(4, m.quarter)),
              title: m.title.trim(),
            })),
        },
      },
    });
  }

  redirect("/wizard/initiative");
}

export default async function QuestsStep() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const cycle = await ensureDefaultCycle();

  const existing = await prisma.quest.findMany({
    where: {
      userId: session.user.id,
      cycleId: cycle.id,
      status: { in: ["DRAFT", "PENDING_APPROVAL"] },
    },
    include: { milestones: { orderBy: { quarter: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  const initial: QuestPayload[] = existing.map((q) => ({
    id: q.id,
    title: q.title,
    why: q.why ?? "",
    description: q.description ?? "",
    weight: q.weight,
    milestones: q.milestones.map((m) => ({
      quarter: m.quarter,
      title: m.title,
    })),
  }));

  return (
    <div className="animate-slide-up">
      <WizardProgress active="quests" />
      <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
        <Target className="w-6 h-6" />
      </div>
      <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
        Pick your quarterly quests
      </h1>
      <p className="text-ink-mute mb-6">
        3 quests work best — concrete things you want to ship this year. Each
        quest can have a milestone per quarter so progress is easy to track.
      </p>
      <QuestBuilder initial={initial} action={saveQuests} />
    </div>
  );
}
