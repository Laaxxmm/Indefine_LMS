import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCycle } from "@/lib/trajectory";
import WizardProgress from "../WizardProgress";
import { ArrowLeft, ArrowRight, Rocket, SkipForward } from "lucide-react";

export const dynamic = "force-dynamic";

async function saveInitiative(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const cycle = await ensureDefaultCycle();
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const impact = String(formData.get("impact") || "").trim();

  if (title) {
    // Replace any existing PITCHED initiative for this cycle by this user
    await prisma.initiative.deleteMany({
      where: {
        userId: session.user.id,
        cycleId: cycle.id,
        status: "PITCHED",
      },
    });
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
  }
  redirect("/wizard/review");
}

export default async function InitiativeStep() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const cycle = await ensureDefaultCycle();

  const existing = await prisma.initiative.findFirst({
    where: {
      userId: session.user.id,
      cycleId: cycle.id,
      status: "PITCHED",
    },
  });

  return (
    <div className="animate-slide-up">
      <WizardProgress active="initiative" />
      <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
        <Rocket className="w-6 h-6" />
      </div>
      <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
        Pitch one bold idea
      </h1>
      <p className="text-ink-mute mb-6">
        Optional but recommended. What&apos;s one initiative you&apos;d love to
        own this year? Goes on the public Initiatives Board for peers to react
        and your manager to fund.
      </p>

      <form action={saveInitiative} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider font-bold text-ink-faint mb-1.5">
            Title
          </label>
          <input
            name="title"
            defaultValue={existing?.title ?? ""}
            placeholder="e.g. Build an internal IFRS knowledge wiki"
            className="w-full bg-white border border-border shadow-soft rounded-xl px-4 py-3 font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider font-bold text-ink-faint mb-1.5">
            What is it?
          </label>
          <textarea
            name="description"
            defaultValue={existing?.description ?? ""}
            rows={3}
            placeholder="A short description of the initiative..."
            className="w-full bg-white border border-border shadow-soft rounded-xl p-4 resize-none focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider font-bold text-ink-faint mb-1.5">
            Why it matters / expected impact
          </label>
          <textarea
            name="impact"
            defaultValue={existing?.impact ?? ""}
            rows={3}
            placeholder="The change you'd love to see..."
            className="w-full bg-white border border-border shadow-soft rounded-xl p-4 resize-none focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
          />
        </div>

        <div className="flex justify-between items-center pt-4 flex-wrap gap-3">
          <Link
            href="/wizard/quests"
            className="px-4 py-2.5 rounded-xl bg-white hover:bg-muted border border-border shadow-soft text-sm font-medium inline-flex items-center gap-2 transition"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/wizard/review"
              className="px-4 py-2.5 rounded-xl bg-white hover:bg-muted border border-border shadow-soft text-sm font-medium inline-flex items-center gap-2 transition"
            >
              <SkipForward className="w-4 h-4" />
              Skip
            </Link>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-accent-violet text-white font-semibold shadow-pop hover:opacity-95 transition"
            >
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
