import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCycle } from "@/lib/trajectory";
import WizardProgress from "../WizardProgress";
import { STRENGTHS } from "@/lib/wizard";
import {
  ArrowLeft,
  Check,
  Sparkles,
  Compass,
  Target,
  Rocket,
  Lock,
} from "lucide-react";

export const dynamic = "force-dynamic";

async function lockIn() {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const cycle = await ensureDefaultCycle();

  // Promote any DRAFT quests to PENDING_APPROVAL
  await prisma.quest.updateMany({
    where: {
      userId: session.user.id,
      cycleId: cycle.id,
      status: "DRAFT",
    },
    data: { status: "PENDING_APPROVAL" },
  });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { wizardSubmittedAt: new Date() },
  });

  redirect("/dashboard");
}

export default async function ReviewStep() {
  const session = await auth();
  if (!session?.user) redirect("/");
  const cycle = await ensureDefaultCycle();

  const [user, quests, initiative] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { strengths: true, aspiration: true, level: true },
    }),
    prisma.quest.findMany({
      where: {
        userId: session.user.id,
        cycleId: cycle.id,
        status: { in: ["DRAFT", "PENDING_APPROVAL"] },
      },
      include: { milestones: { orderBy: { quarter: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.initiative.findFirst({
      where: {
        userId: session.user.id,
        cycleId: cycle.id,
        status: { in: ["PITCHED", "FUNDED", "ACTIVE"] },
      },
    }),
  ]);

  const strengthIds = (user?.strengths as string[] | null) ?? [];
  const strengths = STRENGTHS.filter((s) => strengthIds.includes(s.id));

  return (
    <div className="animate-slide-up">
      <WizardProgress active="review" />
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-700 mb-4">
          <Check className="w-3.5 h-3.5" />
          Almost there
        </div>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-2">
          Lock in your trajectory
        </h1>
        <p className="text-ink-mute">
          Review what you&apos;ve set. Once locked in, your manager gets a copy
          to approve and your trajectory rings start tracking.
        </p>
      </div>

      <div className="space-y-4 mb-8">
        {/* Strengths */}
        <Section icon={Sparkles} title="Your strengths" tint="brand">
          {strengths.length === 0 ? (
            <Empty href="/wizard/strengths" label="Pick your strengths" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {strengths.map((s) => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full bg-brand-50 border border-brand-100 text-brand-700 font-medium"
                >
                  <span>{s.emoji}</span>
                  {s.label}
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* Aspiration */}
        <Section icon={Compass} title="Where you're headed" tint="violet">
          {!user?.aspiration ? (
            <Empty href="/wizard/aspiration" label="Add your aspiration" />
          ) : (
            <p className="text-ink-soft leading-relaxed">
              {user.aspiration}
            </p>
          )}
        </Section>

        {/* Quests */}
        <Section icon={Target} title={`Quests (${quests.length})`} tint="emerald">
          {quests.length === 0 ? (
            <Empty href="/wizard/quests" label="Add your quests" />
          ) : (
            <div className="space-y-3">
              {quests.map((q, i) => (
                <div
                  key={q.id}
                  className="rounded-xl bg-white border border-border p-4"
                >
                  <p className="font-semibold mb-1">
                    <span className="text-emerald-700 mr-2">{i + 1}.</span>
                    {q.title}
                  </p>
                  {q.why && (
                    <p className="text-xs text-ink-mute italic mb-2">
                      Because: {q.why}
                    </p>
                  )}
                  {q.milestones.length > 0 && (
                    <div className="grid grid-cols-2 gap-1.5 mt-2">
                      {q.milestones.map((m) => (
                        <div key={m.id} className="text-xs flex items-center gap-1.5">
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
        </Section>

        {/* Initiative */}
        <Section icon={Rocket} title="Your bold initiative" tint="rose">
          {!initiative ? (
            <Empty
              href="/wizard/initiative"
              label="Pitch an initiative (optional)"
            />
          ) : (
            <div>
              <p className="font-semibold mb-1">{initiative.title}</p>
              {initiative.description && (
                <p className="text-sm text-ink-soft mb-2">{initiative.description}</p>
              )}
              {initiative.impact && (
                <p className="text-xs text-ink-mute italic">
                  Impact: {initiative.impact}
                </p>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* Lock-in actions */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-500 to-accent-violet p-6 text-white text-center">
        <Lock className="w-8 h-8 mx-auto mb-3" />
        <p className="font-display text-xl font-bold mb-2">
          Ready to lock it in?
        </p>
        <p className="text-white/80 text-sm mb-5 max-w-md mx-auto">
          Quests go to your manager for approval. Your trajectory rings start
          tracking immediately. You can always come back to update.
        </p>
        <form action={lockIn}>
          <button
            type="submit"
            className="px-8 py-3 rounded-xl bg-white text-brand-700 font-bold hover:bg-white/95 shadow-pop transition inline-flex items-center gap-2"
          >
            <Lock className="w-4 h-4" />
            Lock in my trajectory
          </button>
        </form>
      </div>

      <div className="flex justify-start mt-6">
        <Link
          href="/wizard/initiative"
          className="px-4 py-2.5 rounded-xl bg-white hover:bg-muted border border-border shadow-soft text-sm font-medium inline-flex items-center gap-2 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  tint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tint: "brand" | "violet" | "emerald" | "rose";
  children: React.ReactNode;
}) {
  const tints = {
    brand: "bg-brand-50 text-brand-600",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
  };
  return (
    <section className="rounded-2xl bg-white border border-border shadow-soft p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${tints[tint]}`}>
          <Icon className="w-4 h-4" />
        </div>
        <h3 className="font-display font-bold">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Empty({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 font-medium"
    >
      {label} →
    </Link>
  );
}
