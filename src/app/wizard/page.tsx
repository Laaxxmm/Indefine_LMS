import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ensureDefaultCycle } from "@/lib/trajectory";
import { ArrowRight, Sparkles, Compass, Rocket, Target } from "lucide-react";

export default async function WizardIntro() {
  const session = await auth();
  if (!session?.user) redirect("/");

  await ensureDefaultCycle();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      level: true,
      strengths: true,
      aspiration: true,
      wizardSubmittedAt: true,
    },
  });

  const hasSubmitted = !!user?.wizardSubmittedAt;

  return (
    <div className="text-center animate-slide-up">
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-border shadow-soft text-xs font-semibold text-ink-soft mb-6">
        <Sparkles className="w-3.5 h-3.5 text-accent-gold" />
        Trajectory · Growth Wizard
      </div>

      <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tight mb-4">
        {hasSubmitted ? (
          <>
            Update your <span className="text-gradient">trajectory</span>
          </>
        ) : (
          <>
            Set your <span className="text-gradient">trajectory</span>
            <br />
            for the year ahead
          </>
        )}
      </h1>
      <p className="text-ink-mute text-lg max-w-xl mx-auto mb-10">
        A 5-minute, no-pressure walkthrough where you reflect on your strengths,
        pick your goals, and pitch one bold idea you&apos;d love to lead this
        cycle.
      </p>

      <div className="grid sm:grid-cols-2 gap-3 mb-10 max-w-2xl mx-auto text-left">
        <Bullet
          icon={Sparkles}
          tint="brand"
          title="Pick 5 strengths"
          sub="Drag your top cards from a deck of 26"
        />
        <Bullet
          icon={Compass}
          tint="violet"
          title="Map your aspiration"
          sub="Where do you see yourself in 12 months?"
        />
        <Bullet
          icon={Target}
          tint="emerald"
          title="Set 3 quarterly quests"
          sub="With milestones for Q1 to Q4"
        />
        <Bullet
          icon={Rocket}
          tint="rose"
          title="Pitch your big idea"
          sub="Optional — share an initiative you&apos;d love to lead"
        />
      </div>

      <div className="flex items-center justify-center gap-3 flex-wrap">
        <Link
          href="/wizard/strengths"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-accent-violet text-white font-semibold shadow-pop hover:opacity-95 transition"
        >
          {hasSubmitted ? "Edit my trajectory" : "Begin"}
          <ArrowRight className="w-4 h-4" />
        </Link>
        <Link
          href="/dashboard"
          className="px-5 py-3 rounded-xl bg-white hover:bg-muted border border-border shadow-soft text-sm font-medium transition"
        >
          Maybe later
        </Link>
      </div>

      {hasSubmitted && (
        <p className="text-xs text-ink-faint mt-6">
          You submitted your trajectory on{" "}
          {user!.wizardSubmittedAt!.toLocaleDateString()} · editing creates a
          new revision
        </p>
      )}
    </div>
  );
}

function Bullet({
  icon: Icon,
  tint,
  title,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: "brand" | "violet" | "emerald" | "rose";
  title: string;
  sub: string;
}) {
  const tints = {
    brand: "bg-brand-50 text-brand-600",
    violet: "bg-violet-50 text-violet-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
  };
  return (
    <div className="rounded-xl bg-white border border-border shadow-soft p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${tints[tint]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-ink-mute mt-0.5">{sub}</p>
      </div>
    </div>
  );
}
