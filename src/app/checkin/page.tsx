import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import {
  currentWeekStart,
  previousWeekStart,
  weekLabel,
  computeCheckinStreak,
} from "@/lib/checkins";
import { ensureDefaultCycle } from "@/lib/trajectory";
import {
  ArrowLeft,
  Sparkles,
  Flame,
  History,
  CheckCircle2,
  Lightbulb,
  AlertCircle,
  Compass,
} from "lucide-react";

export const dynamic = "force-dynamic";

async function saveCheckin(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) return;
  const cycle = await ensureDefaultCycle();
  const ws = currentWeekStart();

  const whatWorked = String(formData.get("whatWorked") || "").trim() || null;
  const whatBlocked = String(formData.get("whatBlocked") || "").trim() || null;
  const nextFocus = String(formData.get("nextFocus") || "").trim() || null;

  await prisma.weeklyCheckin.upsert({
    where: { userId_weekStart: { userId: session.user.id, weekStart: ws } },
    create: {
      userId: session.user.id,
      cycleId: cycle.id,
      weekStart: ws,
      whatWorked,
      whatBlocked,
      nextFocus,
    },
    update: { whatWorked, whatBlocked, nextFocus },
  });

  revalidatePath("/checkin");
  revalidatePath("/dashboard");
  redirect("/checkin?saved=1");
}

export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const userId = session.user.id;
  const sp = await searchParams;
  const justSaved = sp.saved === "1";

  const ws = currentWeekStart();
  const lastWs = previousWeekStart();

  const [thisWeek, lastWeek, streak] = await Promise.all([
    prisma.weeklyCheckin.findUnique({
      where: { userId_weekStart: { userId, weekStart: ws } },
    }),
    prisma.weeklyCheckin.findUnique({
      where: { userId_weekStart: { userId, weekStart: lastWs } },
    }),
    computeCheckinStreak(userId),
  ]);

  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <Link
          href="/dashboard"
          className="text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <Link
          href="/checkin/history"
          className="text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white hover:bg-muted border border-border shadow-soft transition"
        >
          <History className="w-4 h-4" />
          History
        </Link>
      </div>

      {/* Hero */}
      <div className="rounded-3xl bg-gradient-to-br from-amber-100 to-rose-50 border border-amber-200 p-6 sm:p-8 mb-6 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-44 h-44 bg-amber-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="relative grid lg:grid-cols-[1fr_auto] gap-4 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-amber-200 text-xs font-bold text-amber-700 mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              Weekly check-in · {weekLabel(ws)}
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight mb-2">
              {thisWeek ? "Update your reflection" : "How was your week?"}
            </h1>
            <p className="text-ink-soft max-w-xl">
              90 seconds. Three short answers. Your manager sees them and
              nothing leaves your tier — this is how we coach, not grade.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-white border border-amber-200 px-4 py-3 text-center min-w-[110px]">
              <div className="flex items-center gap-1.5 justify-center text-amber-600 mb-0.5">
                <Flame className="w-4 h-4" />
                <span className="text-[10px] uppercase tracking-wider font-bold">
                  Check-in streak
                </span>
              </div>
              <p className="font-display text-2xl font-extrabold tabular-nums leading-none">
                {streak.current}w
              </p>
              <p className="text-[10px] text-ink-mute mt-0.5">
                Best {streak.best}w
              </p>
            </div>
          </div>
        </div>
      </div>

      {justSaved && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 mb-6 flex items-start gap-3 animate-fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-emerald-700">
              Check-in saved · streak now {streak.current} week
              {streak.current === 1 ? "" : "s"}
            </p>
            <p className="text-sm text-emerald-700/80 mt-0.5">
              Nice — see you next week. You can keep editing this answer until
              Sunday night.
            </p>
          </div>
        </div>
      )}

      {/* Last week's "next focus" — gentle nudge to look back */}
      {lastWeek?.nextFocus && (
        <div className="rounded-xl bg-violet-50 border border-violet-200 p-4 mb-6 flex items-start gap-3">
          <Compass className="w-5 h-5 text-violet-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-bold text-violet-700 mb-1">
              Last week you said your focus was
            </p>
            <p className="text-sm text-ink-soft italic">
              &ldquo;{lastWeek.nextFocus}&rdquo;
            </p>
            <p className="text-xs text-violet-700/80 mt-2">
              Did you make progress? Mention it in &quot;What worked&quot; below.
            </p>
          </div>
        </div>
      )}

      {/* Form */}
      <form action={saveCheckin} className="space-y-4 mb-8">
        <Question
          icon={Lightbulb}
          tint="emerald"
          label="What worked this week?"
          hint="A win, a moment of progress, anything you're proud of."
          name="whatWorked"
          defaultValue={thisWeek?.whatWorked ?? ""}
        />
        <Question
          icon={AlertCircle}
          tint="rose"
          label="What blocked you?"
          hint="Anything slowing you down. Be honest — this is how your manager can help."
          name="whatBlocked"
          defaultValue={thisWeek?.whatBlocked ?? ""}
        />
        <Question
          icon={Compass}
          tint="violet"
          label="Top focus next week?"
          hint="One thing you most want to move forward."
          name="nextFocus"
          defaultValue={thisWeek?.nextFocus ?? ""}
        />

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-accent-violet text-white font-semibold shadow-pop hover:opacity-95 transition"
          >
            <CheckCircle2 className="w-4 h-4" />
            {thisWeek ? "Update check-in" : "Submit check-in"}
          </button>
        </div>
      </form>
    </main>
  );
}

function Question({
  icon: Icon,
  tint,
  label,
  hint,
  name,
  defaultValue,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: "emerald" | "rose" | "violet";
  label: string;
  hint: string;
  name: string;
  defaultValue: string;
}) {
  const tints = {
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    violet: "bg-violet-50 text-violet-600",
  };
  return (
    <div className="rounded-2xl bg-white border border-border shadow-soft p-5">
      <div className="flex items-start gap-3 mb-3">
        <div
          className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tints[tint]}`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display font-bold">{label}</p>
          <p className="text-xs text-ink-mute mt-0.5">{hint}</p>
        </div>
      </div>
      <textarea
        name={name}
        defaultValue={defaultValue}
        rows={3}
        placeholder="Take a sec to think..."
        className="w-full bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:bg-white focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
      />
    </div>
  );
}
